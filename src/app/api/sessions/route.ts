import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { toDateOnly } from "@/lib/sessions";
import { findScheduleConflicts } from "@/lib/scheduling";

const listSchema = paginationSchema.extend({
  branchId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "OPEN", "COMPLETED", "CANCELLED"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  // Lessons page: a whole calendar month, and/or one monthly plan.
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  planId: z.string().uuid().optional()
});

const createSchema = z.object({
  groupId: z.string().uuid(),
  date: z.string().date(),
  startTimeMinutes: z.number().int().min(0).max(1439),
  endTimeMinutes: z.number().int().min(1).max(1440),
  notes: z.string().trim().max(500).optional()
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("sessions.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const where = {
      organizationId: ctx.organizationId,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.teacherId ? { teacherId: query.teacherId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              ...(query.to ? { lte: toDateOnly(query.to) } : {})
            }
          }
        : {}),
      ...(query.year && query.month
        ? {
            date: {
              gte: new Date(Date.UTC(query.year, query.month - 1, 1)),
              lt: new Date(Date.UTC(query.year, query.month, 1))
            }
          }
        : {})
    };

    const [total, sessions] = await Promise.all([
      db.classSession.count({ where }),
      db.classSession.findMany({
        where,
        orderBy:
          query.year && query.month
            ? [{ date: "asc" }, { startMinutes: "asc" }]
            : [{ date: "desc" }, { startMinutes: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          date: true,
          startMinutes: true,
          endMinutes: true,
          status: true,
          lessonNumber: true,
          planId: true,
          group: {
            select: {
              id: true,
              name: true,
              capacity: true,
              grade: { select: { id: true, name: true, stage: { select: { id: true, name: true } } } },
              subject: { select: { id: true, name: true } },
              teacher: { select: { id: true, fullName: true } }
            }
          },
          _count: { select: { attendances: true } }
        }
      })
    ]);

    return ok({
      sessions,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("sessions.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("sessions.create");
    const input = await readJson(request, createSchema);

    if (input.endTimeMinutes <= input.startTimeMinutes) {
      throw new BusinessRuleError("The end time must be after the start time.");
    }

    // Verify the group is inside this user's org + branch scope. Never
    // trust the client's idea of which branch this belongs to.
    const group = await db.group.findFirst({
      where: {
        id: input.groupId,
        deletedAt: null,
        branch: { deletedAt: null, center: { organizationId: ctx.organizationId } }
      },
      select: { id: true, branchId: true, teacherId: true, assistantId: true }
    });
    if (!group) throw new BusinessRuleError("Invalid group.", { status: 400 });
    resolveBranchScope(ctx, group.branchId);

    const date = toDateOnly(input.date);

    // Ad-hoc sessions must respect the same group/teacher conflict
    // rules as the weekly timetable (spec §4 — no rooms involved).
    const sameDay = await db.classSession.findMany({
      where: {
        organizationId: ctx.organizationId,
        date,
        status: { not: "CANCELLED" },
        OR: [
          { groupId: group.id },
          ...(group.teacherId ? [{ teacherId: group.teacherId }] : [])
        ]
      },
      select: { id: true, startMinutes: true, endMinutes: true, groupId: true, teacherId: true }
    });

    const overlapping = sameDay.find(
      (s) => input.startTimeMinutes < s.endMinutes && s.startMinutes < input.endTimeMinutes
    );
    if (overlapping) {
      throw new BusinessRuleError(
        "This time slot conflicts with another session for the same group or teacher.",
        { code: "SESSION_CONFLICT", details: { conflictingSessionId: overlapping.id } }
      );
    }

    const session = await db.classSession.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: group.branchId,
        groupId: group.id,
        teacherId: group.teacherId,
        assistantId: group.assistantId,
        date,
        startMinutes: input.startTimeMinutes,
        endMinutes: input.endTimeMinutes,
        notes: input.notes
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_SESSION",
      entityType: "ClassSession",
      entityId: session.id,
      afterValue: session
    });

    return created(session);
  } catch (err) {
    return handleApiError("sessions.create", err);
  }
}
