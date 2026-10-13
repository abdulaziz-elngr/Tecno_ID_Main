import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, paginationSchema, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { loadAccessibleGroup, loadAccessibleStudent, ownGroupFilter, resolveOwnTeacherId } from "@/lib/group-access";
import { toDateOnly } from "@/lib/sessions";
import { DEFAULT_TIME_ZONE } from "@/lib/tz";

/** Recognition ("تكريم") history of students — insert-only. */

const listSchema = paginationSchema.extend({
  studentId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional()
});

const createSchema = z.object({
  studentId: z.string().uuid(),
  reason: z.string().trim().min(2).max(300),
  date: z.string().date().optional(),
  notes: z.string().trim().max(1000).optional()
});

/** Today's calendar date at the centre's time zone, as a UTC-midnight Date. */
function centreToday(): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIME_ZONE }).format(new Date());
  return toDateOnly(ymd);
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("performance.view");
    const query = readQuery(request, listSchema);
    const branchIds = resolveBranchScope(ctx, undefined);

    if (query.studentId) await loadAccessibleStudent(ctx, query.studentId);
    if (query.groupId) await loadAccessibleGroup(ctx, query.groupId);
    const teacherScope = query.studentId || query.groupId ? undefined : await resolveOwnTeacherId(ctx);

    const where = {
      organizationId: ctx.organizationId,
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      student: {
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(teacherScope !== undefined ? { group: ownGroupFilter(teacherScope) } : {})
      }
    };

    const [total, rows] = await Promise.all([
      db.studentRecognition.count({ where }),
      db.studentRecognition.findMany({
        where,
        orderBy: [{ recognizedAt: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          reason: true,
          recognizedAt: true,
          notes: true,
          createdById: true,
          student: {
            select: { id: true, fullName: true, studentCode: true, grade: { select: { name: true } }, group: { select: { name: true } } }
          }
        }
      })
    ]);

    const userIds = Array.from(new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v)));
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds }, organizationId: ctx.organizationId }, select: { id: true, fullName: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.fullName]));

    return ok({
      recognitions: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        date: r.recognizedAt,
        notes: r.notes,
        recordedBy: r.createdById ? (userName.get(r.createdById) ?? null) : null,
        student: {
          id: r.student.id,
          fullName: r.student.fullName,
          studentCode: r.student.studentCode,
          gradeName: r.student.grade.name,
          groupName: r.student.group.name
        }
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize))
      }
    });
  } catch (err) {
    return handleApiError("student-recognitions.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("performance.recognize");
    const input = await readJson(request, createSchema);
    const student = await loadAccessibleStudent(ctx, input.studentId);

    const today = centreToday();
    const date = input.date ? toDateOnly(input.date) : today;
    if (date.getTime() > today.getTime()) {
      throw new BusinessRuleError("The recognition date cannot be in the future.", { status: 400 });
    }

    const row = await db.studentRecognition.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: student.branchId,
        studentId: student.id,
        reason: input.reason,
        recognizedAt: date,
        notes: input.notes || null,
        createdById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "RECOGNIZE_STUDENT",
      entityType: "StudentRecognition",
      entityId: row.id,
      afterValue: row
    });

    return created({ id: row.id });
  } catch (err) {
    return handleApiError("student-recognitions.create", err);
  }
}
