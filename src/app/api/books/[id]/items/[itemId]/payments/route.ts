import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, created, handleApiError, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/billing";
import { bookRemaining, computeBookStatus, nextBookReceiptNumber } from "@/lib/books";

const schema = z.object({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]).default("CASH"),
  notes: z.string().trim().max(500).optional()
});

/** Collects money for one student's book. The payment, the paid total and the status change in ONE transaction. */
export async function POST(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const ctx = await requirePermission("books.collect");
    const input = await readJson(request, schema);

    const item = await db.bookReservationItem.findFirst({
      where: { id: params.itemId, reservationId: params.id, reservation: { organizationId: ctx.organizationId } },
      include: { reservation: true, student: { select: { id: true, branchId: true } } }
    });
    if (!item) throw new NotFoundError("Reservation row not found.");
    resolveBranchScope(ctx, item.reservation.branchId);
    if (item.reservation.status !== "OPEN") {
      throw new BusinessRuleError("This reservation is closed. Re-open it to collect payments.", { status: 409, code: "RESERVATION_CLOSED" });
    }

    const receiptNumber = await nextBookReceiptNumber(ctx.organizationId);
    const result = await db.$transaction(async (tx) => {
      // Re-read inside the transaction so two cashiers can never over-collect.
      const fresh = await tx.bookReservationItem.findUniqueOrThrow({ where: { id: item.id } });
      const price = Number(fresh.price);
      const discount = Number(fresh.discount);
      const remaining = bookRemaining(price, discount, Number(fresh.paidAmount));
      if (remaining <= 0) throw new BusinessRuleError("This book is already fully paid.", { status: 409, code: "ALREADY_PAID" });
      if (input.amount > remaining + 0.001) {
        throw new BusinessRuleError(`Amount is more than the remaining ${remaining}.`, { status: 409, code: "OVERPAYMENT", details: { remaining } });
      }
      const payment = await tx.bookPayment.create({
        data: {
          organizationId: ctx.organizationId,
          branchId: item.reservation.branchId,
          itemId: item.id,
          studentId: item.studentId,
          amount: input.amount,
          method: input.method,
          receiptNumber,
          notes: input.notes || null,
          recordedById: ctx.userId
        }
      });
      const paid = round2(Number(fresh.paidAmount) + input.amount);
      const status = computeBookStatus({ price, discount, paid, reservationFee: Number(item.reservation.reservationFee) });
      await tx.bookReservationItem.update({ where: { id: item.id }, data: { paidAmount: paid, status } });
      return { payment, paid, status, remaining: bookRemaining(price, discount, paid) };
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_BOOK_PAYMENT",
      entityType: "BookPayment",
      entityId: result.payment.id,
      afterValue: { receiptNumber, amount: input.amount, method: input.method, studentId: item.studentId, reservationId: item.reservationId }
    });
    return created({ paymentId: result.payment.id, receiptNumber, status: result.status, remaining: result.remaining });
  } catch (err) {
    return handleApiError("books.payment.create", err);
  }
}
