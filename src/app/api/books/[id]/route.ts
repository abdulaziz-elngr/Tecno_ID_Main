import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/billing";
import { bookPayable, computeBookStatus, ensureReservationItems, serializeBookItem } from "@/lib/books";

const patchSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    kind: z.enum(["BOOK", "NOTES"]).optional(),
    bookPrice: z.number().positive().max(1_000_000).optional(),
    reservationFee: z.number().min(0).max(1_000_000).optional(),
    dueDate: z.string().date().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["OPEN", "CLOSED", "CANCELLED"]).optional()
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });

async function loadReservation(organizationId: string, id: string) {
  const r = await db.bookReservation.findFirst({ where: { id, organizationId } });
  if (!r) throw new NotFoundError("Reservation not found.");
  return r;
}

/** One reservation with every student of the group, their money state and payment history. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("books.view");
    const reservation = await loadReservation(ctx.organizationId, params.id);
    resolveBranchScope(ctx, reservation.branchId);
    if (reservation.status === "OPEN") await ensureReservationItems(reservation);

    const [group, grade, stage, items] = await Promise.all([
      db.group.findUnique({ where: { id: reservation.groupId }, select: { name: true, subject: { select: { name: true } } } }),
      db.grade.findUnique({ where: { id: reservation.gradeId }, select: { name: true } }),
      db.stage.findUnique({ where: { id: reservation.stageId }, select: { name: true } }),
      db.bookReservationItem.findMany({
        where: { reservationId: reservation.id, student: { deletedAt: null } },
        orderBy: { student: { fullName: "asc" } },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              studentCode: true,
              groupId: true,
              status: true,
              parents: {
                orderBy: { isPrimary: "desc" },
                take: 1,
                select: { parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
              }
            }
          },
          payments: { orderBy: { paidAt: "desc" }, select: { id: true, receiptNumber: true, amount: true, method: true, status: true, paidAt: true, notes: true, voidReason: true } }
        }
      })
    ]);

    let collected = 0;
    let expected = 0;
    const counts = { PAID: 0, RESERVED: 0, PARTIAL: 0, UNPAID: 0 };
    const rows = items.map((it) => {
      const s = serializeBookItem(it, reservation);
      collected += s.paid;
      expected += s.payable;
      counts[it.status] += 1;
      const parent = it.student.parents[0]?.parent;
      return {
        ...s,
        student: {
          id: it.student.id,
          fullName: it.student.fullName,
          studentCode: it.student.studentCode,
          // a student who left the group still shows (he may have paid), flagged
          inGroup: it.student.groupId === reservation.groupId && it.student.status === "ACTIVE",
          parentName: parent?.fullName ?? null,
          whatsapp: parent?.whatsappNumber ?? parent?.phone ?? null
        },
        payments: it.payments.map((p) => ({
          id: p.id,
          receiptNumber: p.receiptNumber,
          amount: Number(p.amount),
          method: p.method,
          status: p.status,
          paidAt: p.paidAt,
          notes: p.notes,
          voidReason: p.voidReason
        }))
      };
    });

    return ok({
      reservation: {
        id: reservation.id,
        title: reservation.title,
        kind: reservation.kind,
        status: reservation.status,
        stage: stage?.name ?? "—",
        grade: grade?.name ?? "—",
        group: group ? (group.subject ? `${group.name} · ${group.subject.name}` : group.name) : "—",
        bookPrice: Number(reservation.bookPrice),
        reservationFee: Number(reservation.reservationFee),
        dueDate: reservation.dueDate,
        notes: reservation.notes
      },
      totals: {
        students: rows.length,
        ...counts,
        collected: round2(collected),
        expected: round2(expected),
        remaining: round2(Math.max(0, expected - collected))
      },
      items: rows,
      can: {
        update: ctx.permissions.has("books.update"),
        collect: ctx.permissions.has("books.collect"),
        void: ctx.permissions.has("books.void")
      }
    });
  } catch (err) {
    return handleApiError("books.detail", err);
  }
}

/** Edit a reservation. A new price is applied to every student row and their statuses are recomputed. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("books.update");
    const input = await readJson(request, patchSchema);
    const reservation = await loadReservation(ctx.organizationId, params.id);
    resolveBranchScope(ctx, reservation.branchId);

    const price = input.bookPrice ?? Number(reservation.bookPrice);
    const fee = input.reservationFee ?? Number(reservation.reservationFee);
    if (fee > price) {
      throw new BusinessRuleError("Reservation fee cannot exceed the book price.", { status: 400, code: "FEE_ABOVE_PRICE" });
    }

    if (input.status === "CANCELLED") {
      const paid = await db.bookPayment.count({ where: { item: { reservationId: reservation.id }, status: "COMPLETED" } });
      if (paid > 0) {
        throw new BusinessRuleError("This reservation has payments. Void them first, or close the reservation instead.", {
          status: 409,
          code: "HAS_PAYMENTS"
        });
      }
    }

    await db.$transaction(async (tx) => {
      await tx.bookReservation.update({
        where: { id: reservation.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.bookPrice !== undefined ? { bookPrice: input.bookPrice } : {}),
          ...(input.reservationFee !== undefined ? { reservationFee: input.reservationFee } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status !== undefined ? { status: input.status } : {})
        }
      });
      if (input.bookPrice !== undefined || input.reservationFee !== undefined) {
        const items = await tx.bookReservationItem.findMany({ where: { reservationId: reservation.id } });
        for (const it of items) {
          const nextPrice = input.bookPrice !== undefined ? input.bookPrice : Number(it.price);
          const status = computeBookStatus({ price: nextPrice, discount: Number(it.discount), paid: Number(it.paidAmount), reservationFee: fee });
          // never let a lower price leave a discount larger than the price
          const discount = Math.min(Number(it.discount), nextPrice);
          await tx.bookReservationItem.update({ where: { id: it.id }, data: { price: nextPrice, discount, status } });
        }
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_BOOK_RESERVATION",
      entityType: "BookReservation",
      entityId: reservation.id,
      beforeValue: { title: reservation.title, bookPrice: Number(reservation.bookPrice), reservationFee: Number(reservation.reservationFee), status: reservation.status },
      afterValue: input
    });
    return ok({ id: reservation.id, payable: bookPayable(price, 0) });
  } catch (err) {
    return handleApiError("books.update", err);
  }
}
