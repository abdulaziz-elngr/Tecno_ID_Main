import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/rbac";
import { groupIdFilter, resolveOwnGroupIds } from "@/lib/group-access";
import { handleApiError, ok, readJson, NotFoundError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/**
 * Attendance modification (spec §18, Rule 7).
 *
 * Every change writes BOTH an AttendanceAdjustment row (previous value,
 * new value, who, why, when) and an AuditLog entry, inside one
 * transaction — so the history cannot exist without its justification.
 * Deletion is soft; attendance history is never physically removed.
 */

const patchSchema = z.object({
  type: z.enum(["REGULAR", "MAKE_UP", "LATE", "EXCUSED", "ABSENT"]).optional(),
  notes: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(3).max(500)
});

const deleteSchema = z.object({ reason: z.string().trim().min(3).max(500) });

async function findScoped(
  ctx: AuthContext,
  id: string
) {
  const ownGroupIds = await resolveOwnGroupIds(ctx);
  return db.attendance.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } }),
      ...groupIdFilter(ownGroupIds)
    }
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("attendance.update");
    const existing = await findScoped(ctx, params.id);
    if (!existing) throw new NotFoundError("Attendance record not found.");

    const input = await readJson(request, patchSchema);

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.attendance.update({
        where: { id: existing.id },
        data: { type: input.type ?? existing.type, notes: input.notes ?? existing.notes }
      });

      await tx.attendanceAdjustment.create({
        data: {
          attendanceId: existing.id,
          actorUserId: ctx.userId,
          action: "UPDATE",
          previousValue: { type: existing.type, notes: existing.notes },
          newValue: { type: next.type, notes: next.notes },
          reason: input.reason
        }
      });

      return next;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_ATTENDANCE",
      entityType: "Attendance",
      entityId: updated.id,
      beforeValue: { type: existing.type, notes: existing.notes },
      afterValue: { type: updated.type, notes: updated.notes },
      reason: input.reason
    });

    return ok(updated);
  } catch (err) {
    return handleApiError("attendance.update", err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("attendance.delete");
    const existing = await findScoped(ctx, params.id);
    if (!existing) throw new NotFoundError("Attendance record not found.");

    const input = await readJson(request, deleteSchema);

    const removed = await db.$transaction(async (tx) => {
      const next = await tx.attendance.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() }
      });
      await tx.attendanceAdjustment.create({
        data: {
          attendanceId: existing.id,
          actorUserId: ctx.userId,
          action: "DELETE",
          previousValue: { type: existing.type, deletedAt: null },
          newValue: { deletedAt: next.deletedAt },
          reason: input.reason
        }
      });
      return next;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_ATTENDANCE",
      entityType: "Attendance",
      entityId: removed.id,
      beforeValue: existing,
      afterValue: removed,
      reason: input.reason
    });

    return ok({ id: removed.id, deletedAt: removed.deletedAt });
  } catch (err) {
    return handleApiError("attendance.delete", err);
  }
}

/** Full adjustment history for one record — shown in the audit drawer. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("attendance.view");
    const record = await db.attendance.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        adjustments: { orderBy: { createdAt: "desc" } },
        student: { select: { id: true, fullName: true, studentCode: true } },
        session: { select: { id: true, date: true, group: { select: { name: true } } } }
      }
    });
    if (!record) throw new NotFoundError("Attendance record not found.");
    return ok(record);
  } catch (err) {
    return handleApiError("attendance.get", err);
  }
}
