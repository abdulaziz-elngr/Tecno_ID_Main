import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { computeSubscriptionStatus, round2 } from "@/lib/billing";
import { getCenterProfile } from "@/lib/settings";

/**
 * Financial correction workflows (spec §30, Rule 6).
 *
 * There is NO DELETE here on purpose. A payment can only be:
 *   VOID   — the whole payment was a mistake (wrong student, wrong day)
 *   REFUND — money was genuinely returned, fully or partially
 * Both require a reason, both reverse the subscription balances inside
 * the same transaction, and both are audited.
 */

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("VOID"),
    reason: z.string().trim().min(3).max(500)
  }),
  z.object({
    action: z.literal("REFUND"),
    amount: z.number().positive().max(1000000),
    reason: z.string().trim().min(3).max(500)
  })
]);

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("payments.view");
    const payment = await db.payment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            studentCode: true,
            stage: { select: { name: true } },
            grade: { select: { name: true } },
            group: { select: { name: true } }
          }
        },
        invoice: true,
        allocations: {
          include: {
            subscription: {
              select: { id: true, periodYear: true, periodMonth: true, amount: true }
            }
          }
        }
      }
    });
    if (!payment) throw new NotFoundError("Payment not found.");

    const [cashier, refunder, center] = await Promise.all([
      payment.recordedById
        ? db.user.findUnique({ where: { id: payment.recordedById }, select: { fullName: true } })
        : null,
      payment.refundedById
        ? db.user.findUnique({ where: { id: payment.refundedById }, select: { fullName: true } })
        : null,
      getCenterProfile(ctx.organizationId)
    ]);

    return ok({
      ...payment,
      cashierName: cashier?.fullName ?? null,
      refundedByName: refunder?.fullName ?? null,
      center: {
        name: center.name,
        logoUrl: center.logoUrl,
        address: center.address,
        phone: center.phone,
        currency: center.currency
      },
      amount: Number(payment.amount),
      refundedAmount: Number(payment.refundedAmount),
      allocations: payment.allocations.map((a) => ({
        id: a.id,
        amount: Number(a.amount),
        subscription: {
          ...a.subscription,
          amount: Number(a.subscription.amount)
        }
      })),
      invoice: payment.invoice
        ? {
            ...payment.invoice,
            totalAmount: Number(payment.invoice.totalAmount),
            paidAmount: Number(payment.invoice.paidAmount),
            remainingAmount: Number(payment.invoice.remainingAmount)
          }
        : null
    });
  } catch (err) {
    return handleApiError("payments.get", err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const input = await readJson(request, actionSchema);
    const ctx = await requirePermission(
      input.action === "VOID" ? "payments.void" : "payments.refund"
    );

    const payment = await db.payment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: { allocations: true, invoice: true }
    });
    if (!payment) throw new NotFoundError("Payment not found.");
    if (payment.status === "VOIDED") {
      throw new BusinessRuleError("This payment has already been voided.", { status: 409, code: "ALREADY_VOIDED" });
    }
    if (payment.status === "REFUNDED") {
      throw new BusinessRuleError("This payment has already been fully refunded.", { status: 409, code: "ALREADY_REFUNDED" });
    }

    const amount = Number(payment.amount);
    const alreadyRefunded = Number(payment.refundedAmount);

    if (input.action === "REFUND") {
      const maxRefundable = round2(amount - alreadyRefunded);
      if (input.amount > maxRefundable) {
        throw new BusinessRuleError(
          `The refund cannot exceed the remaining refundable amount (${maxRefundable}).`
        );
      }
    }

    const reversalTotal =
      input.action === "VOID" ? round2(amount - alreadyRefunded) : round2(input.amount);

    const updated = await db.$transaction(async (tx) => {
      // Optimistic guard: if another cashier refunded/voided this payment after we
      // read it, nothing matches and we abort, so the same money can never be
      // refunded twice.
      const guard = await tx.payment.updateMany({
        where: { id: payment.id, status: payment.status, refundedAmount: payment.refundedAmount },
        data: { updatedAt: new Date() }
      });
      if (guard.count !== 1) {
        throw new BusinessRuleError("This payment was just changed by someone else. Reload and try again.", { status: 409, code: "CONCURRENT_CHANGE" });
      }

      // Reverse allocations proportionally, newest subscription first.
      let left = reversalTotal;
      for (const allocation of [...payment.allocations].reverse()) {
        if (left <= 0) break;
        const take = round2(Math.min(left, Number(allocation.amount)));
        const subscription = await tx.subscription.findUnique({
          where: { id: allocation.subscriptionId }
        });
        if (!subscription) continue;

        const newPaid = round2(Math.max(0, Number(subscription.paidAmount) - take));
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
        left = round2(left - take);
      }

      const nextRefunded =
        input.action === "VOID" ? amount : round2(alreadyRefunded + input.amount);
      const nextStatus =
        input.action === "VOID"
          ? "VOIDED"
          : nextRefunded >= amount
            ? "REFUNDED"
            : "PARTIALLY_REFUNDED";

      const next = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: nextStatus,
          refundedAmount: nextRefunded,
          voidedById: input.action === "VOID" ? ctx.userId : payment.voidedById,
          voidedAt: input.action === "VOID" ? new Date() : payment.voidedAt,
          voidReason: input.action === "VOID" ? input.reason : payment.voidReason,
          ...(input.action === "REFUND"
            ? { refundedById: ctx.userId, refundedAt: new Date(), refundReason: input.reason }
            : {})
        }
      });

      if (payment.invoice) {
        await tx.invoice.update({
          where: { id: payment.invoice.id },
          data:
            input.action === "VOID"
              ? { status: "VOID", voidReason: input.reason, paidAmount: 0, remainingAmount: amount }
              : {
                  paidAmount: round2(amount - nextRefunded),
                  remainingAmount: nextRefunded
                }
        });
      }

      return next;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.action === "VOID" ? "VOID_PAYMENT" : "REFUND_PAYMENT",
      entityType: "Payment",
      entityId: payment.id,
      beforeValue: { status: payment.status, refundedAmount: alreadyRefunded, amount },
      afterValue: { status: updated.status, refundedAmount: Number(updated.refundedAmount) },
      reason: input.reason
    });

    return ok({
      id: updated.id,
      status: updated.status,
      refundedAmount: Number(updated.refundedAmount)
    });
  } catch (err) {
    return handleApiError("payments.adjust", err);
  }
}
