import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { NotFoundError, handleApiError, ok } from "@/lib/api";
import { getCenterProfile } from "@/lib/settings";
import { bookRemaining } from "@/lib/books";

/** Data for the printable book receipt. Read-only. */
export async function GET(_request: NextRequest, { params }: { params: { paymentId: string } }) {
  try {
    const ctx = await requirePermission("books.view");
    const p = await db.bookPayment.findFirst({
      where: { id: params.paymentId, organizationId: ctx.organizationId },
      include: { item: { include: { reservation: true, student: { select: { fullName: true, studentCode: true } } } } }
    });
    if (!p) throw new NotFoundError("Receipt not found.");
    resolveBranchScope(ctx, p.branchId);

    const [center, cashier] = await Promise.all([
      getCenterProfile(ctx.organizationId),
      p.recordedById ? db.user.findUnique({ where: { id: p.recordedById }, select: { fullName: true } }) : null
    ]);
    const price = Number(p.item.price);
    const discount = Number(p.item.discount);
    return ok({
      center: { name: center.name, phone: center.phone, address: center.address, logoUrl: center.logoUrl, currency: center.currency || "EGP" },
      receiptNumber: p.receiptNumber,
      status: p.status,
      voidReason: p.voidReason,
      amount: Number(p.amount),
      method: p.method,
      paidAt: p.paidAt,
      notes: p.notes,
      cashier: cashier?.fullName ?? null,
      student: p.item.student,
      book: { title: p.item.reservation.title, kind: p.item.reservation.kind, price, discount },
      paidTotal: Number(p.item.paidAmount),
      remaining: bookRemaining(price, discount, Number(p.item.paidAmount))
    });
  } catch (err) {
    return handleApiError("books.payment.get", err);
  }
}
