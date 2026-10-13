import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getAuthContext,
  requirePermission,
  resolveBranchScope,
  ForbiddenError,
  UnauthorizedError
} from "@/lib/rbac";
import { handleApiError, ok, NotFoundError, BusinessRuleError, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { isAssignableTeacher } from "@/lib/scope";
import { countGroupDependencies, describeGroupBlockers, evaluateGroupDeletion } from "@/lib/group-safety";
import { linkTeacherToSubject } from "@/lib/teacher-subjects";

const SCOPE = "groups.detail";

/**
 * Group detail + full enrolled-student roster (spec §16). Used
 * wherever a screen needs the full list of students in a group (exam
 * grading, recitation entry, the Group Details page) rather than only
 * the students who already have a record.
 *
 * Gated on any permission that implies the caller may legitimately see a
 * group's roster (not just `academic.groups.manage`, which teachers never
 * hold — they still need this to grade their own group's exam).
 */
const ROSTER_PERMISSIONS = [
  "academic.groups.manage",
  "exams.view",
  "recitation.view",
  "assignments.view",
  "sessions.view",
  "students.view"
];

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();
    if (!ROSTER_PERMISSIONS.some((key) => ctx.permissions.has(key))) {
      throw new ForbiddenError();
    }

    const group = await db.group.findFirst({
      where: {
        id: params.id,
        deletedAt: null,
        branch: { center: { organizationId: ctx.organizationId } }
      },
      include: {
        grade: { select: { id: true, name: true, stage: { select: { id: true, name: true } } } },
        subject: { select: { id: true, name: true, code: true } },
        teacher: { select: { id: true, fullName: true } },
        assistant: { select: { id: true, fullName: true } },
        schedules: { where: { isActive: true }, orderBy: { dayOfWeek: "asc" } },
        students: {
          where: { deletedAt: null },
          orderBy: { fullName: "asc" },
          select: {
            id: true,
            fullName: true,
            studentCode: true,
            photoUrl: true,
            status: true,
            phone: true,
            enrollmentDate: true,
            parents: {
              where: { isPrimary: true },
              take: 1,
              select: { parent: { select: { fullName: true, phone: true } } }
            }
          }
        }
      }
    });
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    const currentCount = group.students.filter((s) => s.status === "ACTIVE").length;
    const deletion = evaluateGroupDeletion(await countGroupDependencies(group.id));

    return ok({
      id: group.id,
      branchId: group.branchId,
      name: group.name,
      capacity: group.capacity,
      notes: group.notes,
      isActive: group.isActive,
      grade: group.grade,
      stage: group.grade.stage,
      subject: group.subject,
      teacher: group.teacher,
      assistant: group.assistant,
      schedules: group.schedules,
      currentCount,
      remaining: Math.max(0, group.capacity - currentCount),
      capacityPercent: group.capacity > 0 ? Math.round((currentCount / group.capacity) * 1000) / 10 : 0,
      isFull: currentCount >= group.capacity,
      // Why (if at all) this group cannot be deleted — drives Delete vs Archive in the UI.
      deletion: { canDelete: deletion.canDelete, blockers: deletion.blockers },
      students: group.students
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  // Can be (re)assigned but not cleared: a group always belongs to one subject.
  subjectId: z.string().uuid().optional(),
  teacherId: z.string().uuid().nullable().optional(),
  assistantId: z.string().uuid().nullable().optional(),
  capacity: z.number().int().min(1).max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const group = await db.group.findFirst({
      where: { id: params.id, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } },
      include: { _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } } }
    });
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    const input = await readJson(request, updateSchema);

    if (input.capacity !== undefined && input.capacity < group._count.students) {
      throw new BusinessRuleError(
        `Cannot set capacity below the current enrolled count (${group._count.students}).`
      );
    }

    // Only re-verify staff that are actually being (re)assigned.
    if (input.teacherId && input.teacherId !== group.teacherId && !(await isAssignableTeacher(ctx, input.teacherId))) {
      throw new BusinessRuleError("Invalid teacher.");
    }
    if (input.assistantId && input.assistantId !== group.assistantId && !(await isAssignableTeacher(ctx, input.assistantId))) {
      throw new BusinessRuleError("Invalid assistant.");
    }

    if (input.subjectId && input.subjectId !== group.subjectId) {
      const subject = await db.subject.findFirst({
        where: { id: input.subjectId, organizationId: ctx.organizationId, deletedAt: null },
        select: { id: true }
      });
      if (!subject) throw new BusinessRuleError("Invalid subject.");
    }

    // Name must stay unique per (grade, subject) — checked whenever either part changes.
    const nextName = input.name ?? group.name;
    const nextSubjectId = input.subjectId ?? group.subjectId;
    if (input.name !== undefined || input.subjectId !== undefined) {
      const clash = await db.group.findFirst({
        where: {
          id: { not: group.id },
          gradeId: group.gradeId,
          subjectId: nextSubjectId,
          name: { equals: nextName, mode: "insensitive" }
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
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.group.update({
        where: { id: group.id },
        data: input
      });
      // Keep Subject -> Teacher in step with the group's responsible teacher.
      if (row.teacherId && row.subjectId) {
        await linkTeacherToSubject(tx, row.teacherId, row.subjectId);
      }
      return row;
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_GROUP",
      entityType: "Group",
      entityId: group.id,
      beforeValue: group,
      afterValue: updated
    });

    return ok(updated);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.groups.manage");
    const group = await db.group.findFirst({
      where: { id: params.id, deletedAt: null, branch: { center: { organizationId: ctx.organizationId } } }
    });
    if (!group) throw new NotFoundError("Group not found.");
    resolveBranchScope(ctx, group.branchId);

    // A group can only be deleted if nothing depends on it. Students, sessions,
    // attendance, exams, assignments and subscriptions all reference it, so any
    // of them blocks deletion — the group must be archived (isActive = false)
    // instead, which keeps all history intact.
    const verdict = evaluateGroupDeletion(await countGroupDependencies(group.id));
    if (!verdict.canDelete) {
      throw new BusinessRuleError(describeGroupBlockers(verdict), {
        code: "GROUP_HAS_DEPENDENCIES",
        details: { blockers: verdict.blockers }
      });
    }

    const deleted = await db.group.update({
      where: { id: group.id },
      data: { deletedAt: new Date(), isActive: false }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_GROUP",
      entityType: "Group",
      entityId: group.id,
      beforeValue: group,
      afterValue: deleted
    });

    return ok({ id: group.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
