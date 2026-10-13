import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import {
  handleApiError,
  ok,
  created,
  readJson,
  readQuery,
  paginationSchema,
  BusinessRuleError
} from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import {
  allocatePayment,
  computeSubscriptionStatus,
  nextInvoiceNumber,
  nextReceiptNumber,
  remainingAmount,
  round2
} from "@/lib/billing";
import { dispatchEvent } from "@/lib/notifications";

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]).optional(),
  status: z.enum(["COMPLETED", "VOIDED", "REFUNDED", "PARTIALLY_REFUNDED"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional()
});

const createSchema = z.object({
  studentId: z.string().uuid(),
  amount: z.number().positive().max(1000000),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidAt: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional(),
  /** Explicit targets; when omitted the payment is spread oldest-first. */
  subscriptionIds: z.array(z.string().uuid()).max(24).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("payments.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const where = {
      organizationId: ctx.organizationId,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            paidAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {})
            }
          }
        : {})
    };

    const [total, rows, sum] = await Promise.all([
      db.payment.count({ where }),
      db.payment.findMany({
        where,
        orderBy: { paidAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          student: { select: { id: true, fullName: true, studentCode: true } },
          invoice: { select: { id: true, invoiceNumber: true, status: true } }
        }
      }),
      db.payment.aggregate({
        where: { ...where, status: { in: ["COMPLETED", "PARTIALLY_REFUNDED"] } },
        _sum: { amount: true, refundedAmount: true }
      })
    ]);

    return ok({
      payments: rows.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        student: p.student,
        amount: Number(p.amount),
        refundedAmount: Number(p.refundedAmount),
        method: p.method,
        status: p.status,
        paidAt: p.paidAt,
        notes: p.notes,
        invoice: p.invoice
      })),
      totals: {
        collected: round2(
          Number(sum._sum.amount ?? 0) - Number(sum._sum.refundedAmount ?? 0)
        )
      },
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("payments.list", err);
  }
}

/**
 * Records a payment. Everything — the payment row, its allocations, the
 * updated subscription balances and the invoice — happens inside ONE
 * transaction, so a crash can never leave a receipt without an invoice
 * or a subscription marked paid without money behind it.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("payments.create");
    const input = await readJson(request, createSchema);

    const student = await db.student.findFirst({
      where: { id: input.studentId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, fullName: true, branchId: true }
    });
    if (!student) throw new BusinessRuleError("Student not found.", { status: 404 });
    resolveBranchScope(ctx, student.branchId);

    const outstanding = await db.subscription.findMany({
      where: {
        studentId: student.id,
        organizationId: ctx.organizationId,
        status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
        ...(input.subscriptionIds ? { id: { in: input.subscriptionIds } } : {})
      },
      orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }]
    });

    // Oldest-month-first: an explicit selection must be a prefix of everything
    // still owing (no skipping an earlier unpaid month).
    if (input.subscriptionIds) {
      const allOwing = await db.subscription.findMany({
        where: {
          studentId: student.id,
          organizationId: ctx.organizationId,
          status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] }
        },
        orderBy: [{ periodYear: "asc" }, { periodMonth: "asc" }],
        select: { id: true }
      });
      const chosen = new Set(input.subscriptionIds);
      const prefixLength = allOwing.findIndex((r) => !chosen.has(r.id));
      const firstSkipped = prefixLength === -1 ? allOwing.length : prefixLength;
      if (allOwing.slice(firstSkipped).some((r) => chosen.has(r.id))) {
        throw new BusinessRuleError("A previous month is still unpaid.", { status: 409, code: "OUT_OF_ORDER" });
      }
    }

    const targets = outstanding.map((s) => ({
      subscriptionId: s.id,
      remaining: remainingAmount(Number(s.amount), Number(s.discount), Number(s.paidAmount))
    }));

    const { allocations, unallocated } = allocatePayment(input.amount, targets);

    const receiptNumber = await nextReceiptNumber(ctx.organizationId);
    const invoiceNumber = await nextInvoiceNumber(ctx.organizationId);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

    const result = await db.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          organizationId: ctx.organizationId,
          branchId: student.branchId,
          studentId: student.id,
          amount: input.amount,
          method: input.method,
          receiptNumber,
          paidAt,
          notes: input.notes,
          recordedById: ctx.userId
        }
      });

      for (const allocation of allocations) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            subscriptionId: allocation.subscriptionId,
            amount: allocation.amount
          }
        });

        const subscription = outstanding.find((s) => s.id === allocation.subscriptionId)!;
        const newPaid = round2(Number(subscription.paidAmount) + allocation.amount);
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            paidAmount: newPaid,
            status: computeSubscriptionStatus({
              amount: Number(subscription.amount),
              discount: Number(subscription.discount),
              paidAmount: newPaid,
              dueDate: subscription.dueDate,
              waived: subscription.status === "WAIVED"
            })
          }
        });
      }

      const allocated = round2(input.amount - unallocated);
      const invoice = await tx.invoice.create({
        data: {
          organizationId: ctx.organizationId,
          invoiceNumber,
          paymentId: payment.id,
          studentId: student.id,
          totalAmount: input.amount,
          paidAmount: input.amount,
          remainingAmount: 0,
          description:
            allocations.length > 0
              ? `Tuition payment applied to ${allocations.length} subscription(s).`
              : "Payment recorded as an unallocated credit."
        }
      });

      return { payment, invoice, allocated, unallocated };
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_PAYMENT",
      entityType: "Payment",
      entityId: result.payment.id,
      afterValue: {
        amount: input.amount,
        method: input.method,
        receiptNumber,
        allocations
      }
    });

    await dispatchEvent({
      organizationId: ctx.organizationId,
      event: "PAYMENT_RECEIVED",
      studentId: student.id,
      title: "Payment received",
      actorUserId: ctx.userId,
      variables: {
        student_name: student.fullName,
        amount: input.amount,
        receipt_number: receiptNumber
      }
    }).catch((err) => console.error("[payments.create] notify failed", err));

    return created({
      payment: { ...result.payment, amount: Number(result.payment.amount) },
      invoice: { id: result.invoice.id, invoiceNumber: result.invoice.invoiceNumber },
      allocatedAmount: result.allocated,
      unallocatedCredit: result.unallocated
    });
  } catch (err) {
    return handleApiError("payments.create", err);
  }
}
