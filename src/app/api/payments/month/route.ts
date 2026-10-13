import { type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, created, readJson, BusinessRuleError, NotFoundError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { allocatePayment, computeSubscriptionStatus, nextInvoiceNumber, nextReceiptNumber, round2 } from "@/lib/billing";
import { loadLedgerEnv, loadLedgers, serializeEntry, summarize } from "@/lib/payment-ledger";
import { checkPayable, dueDateFor, feeForMonth, monthLabel } from "@/lib/subscription-months";
import { dispatchEvent } from "@/lib/notifications";

const schema = z.object({
  studentId: z.string().uuid(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  /** Defaults to the full remaining amount. */
  amount: z.number().positive().max(1_000_000).optional(),
  /** Discount on the month; needs payments.update and is only allowed before anything was paid on it. */
  discount: z.number().min(0).max(1_000_000).optional(),
  notes: z.string().trim().max(500).optional()
});

/**
 * Records the payment of ONE specific month.
 *
 * Financial rules enforced here (never only in the UI):
 *  - the student row is locked for the duration of the transaction, so two
 *    employees can never pay the same month twice at the same time;
 *  - a month cannot be paid while an EARLIER month is still owing
 *    (409 OUT_OF_ORDER, with the month that must be paid first);
 *  - an already-paid month is refused (409 ALREADY_PAID);
 *  - the amount charged is frozen on the Subscription row at this moment,
 *    using the grade price in force for that month;
 *  - the payment, allocation, subscription update and invoice are one
 *    transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("payments.create");
    const input = await readJson(request, schema);
    if (input.discount && input.discount > 0 && !ctx.permissions.has("payments.update")) {
      throw new BusinessRuleError("You do not have permission to apply discounts.", { status: 403, code: "DISCOUNT_FORBIDDEN" });
    }

    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, fullName: true, branchId: true, groupId: true, gradeId: true, enrollmentDate: true }
    });
    if (!student) throw new NotFoundError("Student not found.");
    resolveBranchScope(ctx, student.branchId);

    const env = await loadLedgerEnv(ctx.organizationId);
    const target = { year: input.periodYear, month: input.periodMonth };
    const paidAt = new Date();

    let result: Awaited<ReturnType<typeof attempt>> | undefined;
    for (let tries = 0; tries < 3; tries++) {
      try {
        result = await attempt();
        break;
      } catch (err) {
        // Receipt/invoice number collision between two concurrent cashiers: take a fresh number.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && tries < 2) continue;
        throw err;
      }
    }
    if (!result) throw new BusinessRuleError("Could not record the payment. Please try again.");

    async function attempt() {
      const receiptNumber = await nextReceiptNumber(ctx.organizationId);
      const invoiceNumber = await nextInvoiceNumber(ctx.organizationId);

      return db.$transaction(
        async (tx) => {
          // Serialise all payments of this student.
          await tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${student!.id} FOR UPDATE`;

          const ledger = (await loadLedgers(ctx.organizationId, [student!], env, tx)).get(student!.id) ?? [];
          const check = checkPayable(ledger, target);
          if (!check.ok) {
            if (check.reason === "OUT_OF_ORDER" && check.oldest) {
              throw new BusinessRuleError("A previous month is still unpaid.", {
                status: 409,
                code: "OUT_OF_ORDER",
                details: { oldest: serializeEntry(check.oldest) }
              });
            }
            if (check.reason === "ALREADY_PAID") {
              throw new BusinessRuleError("This month is already paid.", { status: 409, code: "ALREADY_PAID" });
            }
            if (check.reason === "NO_PRICE") {
              throw new BusinessRuleError("No subscription price is configured for this grade.", { status: 422, code: "NO_PRICE" });
            }
            throw new BusinessRuleError("This month is not billable for the student.", { status: 422, code: "NOT_IN_LEDGER" });
          }

          // Materialise the month (price frozen now) if it only existed virtually.
          let rows = await tx.subscription.findMany({
            where: { studentId: student!.id, periodYear: target.year, periodMonth: target.month },
            orderBy: { createdAt: "asc" }
          });
          if (rows.length === 0) {
            const fees = await tx.gradeFee.findMany({ where: { gradeId: student!.gradeId }, select: { amount: true, effectiveFrom: true } });
            const price = feeForMonth(fees.map((f) => ({ amount: Number(f.amount), effectiveFrom: f.effectiveFrom })), target);
            if (price === null || price <= 0) {
              throw new BusinessRuleError("No subscription price is configured for this grade.", { status: 422, code: "NO_PRICE" });
            }
            const dueDate = dueDateFor(target, env.dueDay);
            const row = await tx.subscription.create({
              data: {
                organizationId: ctx.organizationId,
                branchId: student!.branchId,
                studentId: student!.id,
                groupId: student!.groupId,
                periodYear: target.year,
                periodMonth: target.month,
                amount: price,
                dueDate,
                status: computeSubscriptionStatus({ amount: price, discount: 0, paidAmount: 0, dueDate })
              }
            });
            rows = [row];
          }

          // Optional discount, only while nothing has been paid on the month.
          if (input.discount && input.discount > 0) {
            const first = rows[0]!;
            if (rows.some((r) => Number(r.paidAmount) > 0)) {
              throw new BusinessRuleError("A discount cannot be applied after a payment was made on this month.", { status: 422, code: "DISCOUNT_AFTER_PAYMENT" });
            }
            if (input.discount > Number(first.amount)) {
              throw new BusinessRuleError("The discount cannot exceed the subscription amount.", { status: 422, code: "DISCOUNT_TOO_LARGE" });
            }
            rows[0] = await tx.subscription.update({ where: { id: first.id }, data: { discount: input.discount } });
          }

          const targets = rows
            .map((r) => ({
              subscriptionId: r.id,
              remaining: round2(Math.max(0, Number(r.amount) - Number(r.discount) - Number(r.paidAmount)))
            }))
            .filter((t) => t.remaining > 0);
          const remainingTotal = round2(targets.reduce((s, t) => s + t.remaining, 0));
          const amount = input.amount ?? remainingTotal;

          if (amount > remainingTotal) {
            throw new BusinessRuleError(`The amount exceeds the amount due (${remainingTotal}).`, { status: 422, code: "OVERPAYMENT" });
          }
          if (!env.allowPartial && amount < remainingTotal) {
            throw new BusinessRuleError("Partial payments are not allowed. Pay the full amount due.", { status: 422, code: "PARTIAL_NOT_ALLOWED" });
          }

          const { allocations } = allocatePayment(amount, targets);

          const payment = await tx.payment.create({
            data: {
              organizationId: ctx.organizationId,
              branchId: student!.branchId,
              studentId: student!.id,
              amount,
              method: input.method,
              receiptNumber,
              paidAt,
              notes: input.notes,
              recordedById: ctx.userId
            }
          });

          for (const a of allocations) {
            await tx.paymentAllocation.create({ data: { paymentId: payment.id, subscriptionId: a.subscriptionId, amount: a.amount } });
            const row = rows.find((r) => r.id === a.subscriptionId)!;
            const newPaid = round2(Number(row.paidAmount) + a.amount);
            await tx.subscription.update({
              where: { id: row.id },
              data: {
                paidAmount: newPaid,
                status: computeSubscriptionStatus({
                  amount: Number(row.amount),
                  discount: Number(row.discount),
                  paidAmount: newPaid,
                  dueDate: row.dueDate,
                  waived: row.status === "WAIVED"
                })
              }
            });
          }

          const invoice = await tx.invoice.create({
            data: {
              organizationId: ctx.organizationId,
              invoiceNumber,
              paymentId: payment.id,
              studentId: student!.id,
              totalAmount: amount,
              paidAmount: amount,
              remainingAmount: 0,
              description: `Subscription ${monthLabel(target, "en")}`
            }
          });

          const after = (await loadLedgers(ctx.organizationId, [student!], env, tx)).get(student!.id) ?? [];
          return { payment, invoice, amount, rows, after, discount: input.discount ?? 0 };
        },
        { timeout: 15_000 }
      );
    }

    const sum = summarize(result.after);
    const entry = result.after.find((e) => e.year === target.year && e.month === target.month);

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_PAYMENT",
      entityType: "Payment",
      entityId: result.payment.id,
      afterValue: {
        month: `${target.year}-${String(target.month).padStart(2, "0")}`,
        amount: result.amount,
        discount: result.discount,
        method: input.method,
        receiptNumber: result.payment.receiptNumber,
        studentId: student.id
      }
    });

    await dispatchEvent({
      organizationId: ctx.organizationId,
      event: "PAYMENT_RECEIVED",
      studentId: student.id,
      title: "Payment received",
      actorUserId: ctx.userId,
      variables: { student_name: student.fullName, amount: result.amount, receipt_number: result.payment.receiptNumber }
    }).catch((err) => console.error("[payments.month] notify failed", err));

    return created({
      paymentId: result.payment.id,
      receiptNumber: result.payment.receiptNumber,
      invoiceNumber: result.invoice.invoiceNumber,
      amount: result.amount,
      monthStatus: entry?.status ?? null,
      monthRemaining: entry?.remaining ?? 0,
      nextEligible: sum.oldest ? serializeEntry(sum.oldest) : null,
      totalDue: sum.totalDue
    });
  } catch (err) {
    return handleApiError("payments.month", err);
  }
}
