import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission, resolveBranchScope } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { isAssignableTeacher } from "@/lib/scope";
import { BusinessRuleError, created, handleApiError, ok, readJson, readQuery } from "@/lib/api";
import { linkTeacherToSubject } from "@/lib/teacher-subjects";

const SCOPE = "groups";

const listQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional()
});

const createGroupSchema = z.object({
  branchId: z.string().uuid(),
  gradeId: z.string().uuid(),
  // Stage 1: every NEW group belongs to exactly one subject. (Groups created
  // before this release have no subject and are completed via PATCH.)
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid().optional(),
  assistantId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().min(1).max(2000),
  notes: z.string().trim().max(2000).optional()
});

/**
 * Listing groups is read-only and every page that filters or assigns by group
 * (students, parents, teachers) needs it, so it is open to the roles that can
 * view those people — a receptionist no longer gets a 403 / empty dropdown. Writing
 * (POST here, PATCH/DELETE on /groups/:id) still requires
 * `academic.groups.manage`.
 */
const GROUP_LIST_PERMISSIONS = [
  "academic.groups.manage",
  "students.view",
  "parents.view",
  "teachers.view"
] as const;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAnyPermission(GROUP_LIST_PERMISSIONS);
    const query = readQuery(request, listQuerySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);

    const groups = await db.group.findMany({
      where: {
        deletedAt: null,
        branch: { center: { organizationId: ctx.organizationId } },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(query.gradeId ? { gradeId: query.gradeId } : {}),
        ...(query.stageId ? { grade: { stageId: query.stageId } } : {}),
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        ...(query.teacherId ? { teacherId: query.teacherId } : {})
      },
      orderBy: [
        { grade: { stage: { order: "asc" } } },
        { grade: { order: "asc" } },
        { subject: { name: "asc" } },
        { name: "asc" }
      ],
      include: {
        grade: { select: { id: true, name: true, stage: { select: { id: true, name: true } } } },
        subject: { select: { id: true, name: true, code: true } },
        teacher: { select: { id: true, fullName: true } },
        assistant: { select: { id: true, fullName: true } },
        schedules: { where: { isActive: true }, orderBy: { dayOfWeek: "asc" } },
        _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } }
      }
    });

    const data = groups.map((g) => ({
      ...g,
      currentCount: g._count.students,
      remaining: Math.max(0, g.capacity - g._count.students),
      capacityPercent: g.capacity > 0 ? Math.round((g._count.students / g.capacity) * 1000) / 10 : 0,
      isFull: g._count.students >= g.capacity
    }));

    return ok(data);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const input = await readJson(request, createGroupSchema);

    resolveBranchScope(ctx, input.branchId);
    const branch = await db.branch.findFirst({
      where: { id: input.branchId, deletedAt: null, center: { organizationId: ctx.organizationId } }
    });
    if (!branch) throw new BusinessRuleError("Invalid branch.", { status: 400 });

    // Enforce the Stage -> Grade -> Subject -> Group hierarchy: the grade must
    // be a real, active grade of this organization...
    const grade = await db.grade.findFirst({
      where: { id: input.gradeId, stage: { organizationId: ctx.organizationId } },
      include: { stage: true }
    });
    if (!grade) throw new BusinessRuleError("Invalid grade.", { status: 400 });
    if (!grade.isActive || !grade.stage.isActive) {
      throw new BusinessRuleError("Cannot create a group under an inactive stage/grade.", { status: 400 });
    }

    // ...and the subject a real, non-deleted subject of this organization.
    const subject = await db.subject.findFirst({
      where: { id: input.subjectId, organizationId: ctx.organizationId, deletedAt: null }
    });
    if (!subject) throw new BusinessRuleError("Invalid subject.", { status: 400 });

    // teacherId / assistantId come from the client: verify they belong to
    // this organization and to a branch the caller may manage.
    if (input.teacherId && !(await isAssignableTeacher(ctx, input.teacherId))) {
      throw new BusinessRuleError("Invalid teacher.", { status: 400 });
    }
    if (input.assistantId && !(await isAssignableTeacher(ctx, input.assistantId))) {
      throw new BusinessRuleError("Invalid assistant.", { status: 400 });
    }

    // Same name only once per (grade, subject). Soft-deleted groups still
    // occupy the DB unique index, so they are included in this check.
    const clash = await db.group.findFirst({
      where: {
        gradeId: input.gradeId,
        subjectId: input.subjectId,
        name: { equals: input.name, mode: "insensitive" }
      },
      select: { deletedAt: true }
    });
    if (clash) {
      throw new BusinessRuleError(
        clash.deletedAt
          ? "A deleted group with this name already exists for this grade and subject. Choose a different name."
          : "A group with this name already exists for this grade and subject.",
        { status: 409, code: "GROUP_NAME_TAKEN" }
      );
    }

    const group = await db.$transaction(async (tx) => {
      const row = await tx.group.create({
        data: {
          branchId: input.branchId,
          gradeId: input.gradeId,
          subjectId: input.subjectId,
          teacherId: input.teacherId,
          assistantId: input.assistantId,
          name: input.name,
          capacity: input.capacity,
          notes: input.notes
        }
      });
      if (input.teacherId) await linkTeacherToSubject(tx, input.teacherId, input.subjectId);
      return row;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_GROUP",
      entityType: "Group",
      entityId: group.id,
      afterValue: group
    });

    return created(group);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
