import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, created, handleApiError, ok, readJson, readQuery } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/billing";
import { bookPayable, ensureReservationItems } from "@/lib/books";

const listSchema = z.object({
  branchId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "CLOSED", "CANCELLED"]).optional(),
  q: z.string().trim().max(100).optional()
});

const createSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    kind: z.enum(["BOOK", "NOTES"]).default("BOOK"),
    groupId: z.string().uuid(),
    bookPrice: z.number().positive().max(1_000_000),
    reservationFee: z.number().min(0).max(1_000_000).default(0),
    dueDate: z.string().date().optional(),
    notes: z.string().trim().max(1000).optional()
  })
  .refine((v) => v.reservationFee <= v.bookPrice, { message: "Reservation fee cannot exceed the book price.", path: ["reservationFee"] });

/** All reservations with per-reservation counts and money. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("books.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const rows = await db.bookReservation.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(query.stageId ? { stageId: query.stageId } : {}),
        ...(query.gradeId ? { gradeId: query.gradeId } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
        status: query.status ?? { not: "CANCELLED" },
        ...(query.q ? { title: { contains: query.q, mode: "insensitive" as const } } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 300
    });
    const ids = rows.map((r) => r.id);
    const [items, groups, grades, stages] = await Promise.all([
      ids.length
        ? db.bookReservationItem.findMany({
            where: { reservationId: { in: ids }, student: { deletedAt: null } },
            select: { reservationId: true, price: true, discount: true, paidAmount: true, status: true }
          })
        : [],
      db.group.findMany({ where: { id: { in: rows.map((r) => r.groupId) } }, select: { id: true, name: true, subject: { select: { name: true } } } }),
      db.grade.findMany({ where: { id: { in: rows.map((r) => r.gradeId) } }, select: { id: true, name: true } }),
      db.stage.findMany({ where: { id: { in: rows.map((r) => r.stageId) } }, select: { id: true, name: true } })
    ]);
    const groupBy = new Map(groups.map((g) => [g.id, g]));
    const gradeName = new Map(grades.map((g) => [g.id, g.name]));
    const stageName = new Map(stages.map((s) => [s.id, s.name]));

    const agg = new Map<string, { students: number; paid: number; reserved: number; unpaid: number; collected: number; expected: number }>();
    for (const it of items) {
      const a = agg.get(it.reservationId) ?? { students: 0, paid: 0, reserved: 0, unpaid: 0, collected: 0, expected: 0 };
      a.students++;
      if (it.status === "PAID") a.paid++;
      else if (it.status === "RESERVED") a.reserved++;
      else a.unpaid++;
      a.collected = round2(a.collected + Number(it.paidAmount));
      a.expected = round2(a.expected + bookPayable(Number(it.price), Number(it.discount)));
      agg.set(it.reservationId, a);
    }

    return ok({
      reservations: rows.map((r) => {
        const a = agg.get(r.id) ?? { students: 0, paid: 0, reserved: 0, unpaid: 0, collected: 0, expected: 0 };
        const g = groupBy.get(r.groupId);
        return {
          id: r.id,
          title: r.title,
          kind: r.kind,
          status: r.status,
          stage: stageName.get(r.stageId) ?? "—",
          grade: gradeName.get(r.gradeId) ?? "—",
          group: g ? (g.subject ? `${g.name} · ${g.subject.name}` : g.name) : "—",
          bookPrice: Number(r.bookPrice),
          reservationFee: Number(r.reservationFee),
          dueDate: r.dueDate,
          createdAt: r.createdAt,
          ...a,
          remaining: round2(Math.max(0, a.expected - a.collected))
        };
      }),
      canCreate: ctx.permissions.has("books.create")
    });
  } catch (err) {
    return handleApiError("books.list", err);
  }
}

/** Creates a reservation for a group and a row for every active student of that group. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("books.create");
    const input = await readJson(request, createSchema);

    const group = await db.group.findFirst({
      where: { id: input.groupId, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } },
      select: { id: true, branchId: true, gradeId: true, grade: { select: { stageId: true } } }
    });
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    const duplicate = await db.bookReservation.findFirst({
      where: { organizationId: ctx.organizationId, groupId: group.id, title: { equals: input.title, mode: "insensitive" }, status: { not: "CANCELLED" } },
      select: { id: true }
    });
    if (duplicate) {
      throw new BusinessRuleError("A reservation with this title already exists for this group.", { status: 409, code: "DUPLICATE_RESERVATION" });
    }

    const reservation = await db.bookReservation.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: group.branchId,
        title: input.title,
        kind: input.kind,
        stageId: group.grade.stageId,
        gradeId: group.gradeId,
        groupId: group.id,
        bookPrice: input.bookPrice,
        reservationFee: input.reservationFee,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        notes: input.notes || null,
        createdById: ctx.userId
      }
    });
    const students = await ensureReservationItems(reservation);

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_BOOK_RESERVATION",
      entityType: "BookReservation",
      entityId: reservation.id,
      afterValue: { title: input.title, groupId: group.id, bookPrice: input.bookPrice, reservationFee: input.reservationFee, students }
    });
    return created({ id: reservation.id, students });
  } catch (err) {
    return handleApiError("books.create", err);
  }
}
