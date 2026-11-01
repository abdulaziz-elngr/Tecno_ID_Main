import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireAnyPermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { computeBookStatus } from "@/lib/books";

const schema = z
  .object({
    discount: z.number().min(0).max(1_000_000).optional(),
    delivered: z.boolean().optional(),
    notes: z.string().trim().max(500).nullable().optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

/** Per-student changes: a discount (books.update) or marking the book as handed over (collect/update). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  try {
    const ctx = await requireAnyPermission(["books.update", "books.collect"]);
    const input = await readJson(request, schema);
    if ((input.discount !== undefined || input.notes !== undefined) && !ctx.permissions.has("books.update")) {
      throw new ForbiddenError("Missing permission: books.update");
    }

    const item = await db.bookReservationItem.findFirst({
      where: { id: params.itemId, reservationId: params.id, reservation: { organizationId: ctx.organizationId } },
      include: { reservation: true }
    });
    if (!item) throw new NotFoundError("Reservation row not found.");
    resolveBranchScope(ctx, item.reservation.branchId);

    const price = Number(item.price);
    const discount = input.discount ?? Number(item.discount);
    if (discount > price) throw new BusinessRuleError("Discount cannot exceed the price.", { status: 400, code: "DISCOUNT_ABOVE_PRICE" });

    const updated = await db.bookReservationItem.update({
      where: { id: item.id },
      data: {
        ...(input.discount !== undefined
          ? {
              discount,
              status: computeBookStatus({ price, discount, paid: Number(item.paidAmount), reservationFee: Number(item.reservation.reservationFee) })
            }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.delivered !== undefined ? { deliveredAt: input.delivered ? new Date() : null } : {})
      }
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.delivered !== undefined ? "BOOK_DELIVERY" : "UPDATE_BOOK_ITEM",
      entityType: "BookReservationItem",
      entityId: item.id,
      beforeValue: { discount: Number(item.discount), deliveredAt: item.deliveredAt },
      afterValue: input
    });
    return ok({ id: updated.id, status: updated.status });
  } catch (err) {
    return handleApiError("books.item.update", err);
  }
}
