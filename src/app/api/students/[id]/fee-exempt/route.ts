import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readJson, BusinessRuleError, NotFoundError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { computeSubscriptionStatus } from "@/lib/billing";
import { loadLedgerEnv } from "@/lib/payment-ledger";
import { monthBoundary, monthsFromFilter, previousMonth } from "@/lib/fee-exemption";

/**
 * Monthly-fee exemption for ONE student.
 *
 *   POST   → the student stops owing monthly fees (from this month onwards, or
 *            for every month when `includePast` is true).
 *   DELETE → ends the exemption: billing resumes from the CURRENT month. Months
 *            that were exempt in the past stay waived, so removing the
 *            exemption never creates a surprise debt.
 *
 * Why the books can never show a shortfall:
 *  - Unpaid / partly-paid month rows inside the exemption are flipped to WAIVED
 *    (and tagged `exemptWaived` so only those rows are restored on removal).
 *  - Months that have no row yet are covered by the student-level exemption
 *    that the ledger applies (see payment-ledger.ts), and bulk generation skips
 *    exempt students.
 *  - Money that was really collected is never touched: a fully paid month stays
 *    PAID, and refunds/voids keep working on it.
 *
 * Needs `payments.update` (same permission as granting a discount, because an
 * exemption is a financial concession). Every change is audit-logged with a reason.
 */

const bodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /** POST only: also waive earlier months that are still unpaid. */
  includePast: z.boolean().optional().default(false)
});

async function loadStudent(organizationId: string, id: string) {
  const student = await db.student.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: {
      id: true,
      branchId: true,
      feeExempt: true,
      feeExemptFrom: true,
      feeExemptUntil: true,
      feeExemptReason: true
    }
  });
  if (!student) throw new NotFoundError("Student not found.");
  return student;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("payments.update");
    const input = await readJson(request, bodySchema);
    const student = await loadStudent(ctx.organizationId, params.id);
    resolveBranchScope(ctx, student.branchId);

    const env = await loadLedgerEnv(ctx.organizationId);
    const from = input.includePast ? null : env.current;
    const now = new Date();

    const result = await db.$transaction(
      async (tx) => {
        // Serialise with payments on the same student (they lock the same row).
        await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${student.id} FOR UPDATE`;

        const fresh = await tx.student.findUniqueOrThrow({ where: { id: student.id }, select: { feeExempt: true } });
        if (fresh.feeExempt) {
          throw new BusinessRuleError("This student is already exempt from monthly fees.", {
            status: 409,
            code: "ALREADY_EXEMPT"
          });
        }

        await tx.student.update({
          where: { id: student.id },
          data: {
            feeExempt: true,
            feeExemptFrom: from ? monthBoundary(from) : null,
            feeExemptUntil: null,
            feeExemptReason: input.reason,
            feeExemptAt: now,
            feeExemptById: ctx.userId
          }
        });

        // Month rows that still owe something become WAIVED. Paid rows are left alone.
        const waived = await tx.subscription.updateMany({
          where: {
            studentId: student.id,
            status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
            ...monthsFromFilter(from)
          },
          data: { status: "WAIVED", exemptWaived: true }
        });

        return { waivedRows: waived.count };
      },
      { timeout: 15_000 }
    );

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "STUDENT_FEE_EXEMPT_ON",
      entityType: "Student",
      entityId: student.id,
      beforeValue: { feeExempt: false },
      afterValue: {
        feeExempt: true,
        from: from ? `${from.year}-${String(from.month).padStart(2, "0")}` : "all months",
        waivedRows: result.waivedRows
      },
      reason: input.reason
    });

    return ok({
      feeExempt: true,
      from: from ? { year: from.year, month: from.month } : null,
      waivedRows: result.waivedRows
    });
  } catch (err) {
    return handleApiError("students.fee-exempt.on", err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("payments.update");
    const input = await readJson(request, bodySchema.pick({ reason: true }));
    const student = await loadStudent(ctx.organizationId, params.id);
    resolveBranchScope(ctx, student.branchId);

    const env = await loadLedgerEnv(ctx.organizationId);
    const current = env.current;
    const lastExemptMonth = previousMonth(current);

    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${student.id} FOR UPDATE`;

        const fresh = await tx.student.findUniqueOrThrow({ where: { id: student.id }, select: { feeExempt: true } });
        if (!fresh.feeExempt) {
          throw new BusinessRuleError("This student is not exempt from monthly fees.", {
            status: 409,
            code: "NOT_EXEMPT"
          });
        }

        await tx.student.update({
          where: { id: student.id },
          data: {
            feeExempt: false,
            // Past exempt months stay waived; the exemption ends with last month.
            feeExemptUntil: monthBoundary(lastExemptMonth)
          }
        });

        // Restore ONLY the rows this exemption waived, from the current month on.
        const rows = await tx.subscription.findMany({
          where: { studentId: student.id, exemptWaived: true, ...monthsFromFilter(current) }
        });
        for (const row of rows) {
          await tx.subscription.update({
            where: { id: row.id },
            data: {
              exemptWaived: false,
              status: computeSubscriptionStatus({
                amount: Number(row.amount),
                discount: Number(row.discount),
                paidAmount: Number(row.paidAmount),
                dueDate: row.dueDate
              })
            }
          });
        }
        return { restoredRows: rows.length };
      },
      { timeout: 15_000 }
    );

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "STUDENT_FEE_EXEMPT_OFF",
      entityType: "Student",
      entityId: student.id,
      beforeValue: { feeExempt: true, reason: student.feeExemptReason },
      afterValue: {
        feeExempt: false,
        billingResumesFrom: `${current.year}-${String(current.month).padStart(2, "0")}`,
        restoredRows: result.restoredRows
      },
      reason: input.reason
    });

    return ok({ feeExempt: false, billingResumesFrom: current, restoredRows: result.restoredRows });
  } catch (err) {
    return handleApiError("students.fee-exempt.off", err);
  }
}
