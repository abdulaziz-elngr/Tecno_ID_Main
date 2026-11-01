import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson, reasonSchema } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/billing";
import { computeBookStatus } from "@/lib/books";

/** Voids a book payment (never deleted): the student's paid total and status are rolled back in the same transaction. */
export async function POST(request: NextRequest, { params }: { params: { paymentId: string } }) {
  try {
    const ctx = await requirePermission("books.void");
    const { reason } = await readJson(request, reasonSchema);

    const payment = await db.bookPayment.findFirst({
      where: { id: params.paymentId, organizationId: ctx.organizationId },
      include: { item: { include: { reservation: true } } }
    });
    if (!payment) throw new NotFoundError("Payment not found.");
    resolveBranchScope(ctx, payment.branchId);
    if (payment.status !== "COMPLETED") throw new BusinessRuleError("This payment is already voided.", { status: 409, code: "ALREADY_VOIDED" });

    await db.$transaction(async (tx) => {
      const fresh = await tx.bookReservationItem.findUniqueOrThrow({ where: { id: payment.itemId } });
      const paid = round2(Math.max(0, Number(fresh.paidAmount) - Number(payment.amount)));
      await tx.bookPayment.update({
        where: { id: payment.id },
        data: { status: "VOIDED", voidedAt: new Date(), voidedById: ctx.userId, voidReason: reason }
      });
      await tx.bookReservationItem.update({
        where: { id: fresh.id },
        data: {
          paidAmount: paid,
          status: computeBookStatus({ price: Number(fresh.price), discount: Number(fresh.discount), paid, reservationFee: Number(payment.item.reservation.reservationFee) })
        }
      });
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "VOID_BOOK_PAYMENT",
      entityType: "BookPayment",
      entityId: payment.id,
      beforeValue: { amount: Number(payment.amount), receiptNumber: payment.receiptNumber },
      reason
    });
    return ok({ id: payment.id, status: "VOIDED" });
  } catch (err) {
    return handleApiError("books.payment.void", err);
  }
}
