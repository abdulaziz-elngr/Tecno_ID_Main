import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { assertCanManageUser } from "@/lib/scope";
import { revokeAllSessionsForUser } from "@/lib/session";
import { deleteReasonSchema, teacherUpdateSchema } from "@/lib/staff";
import { applyStaffGroupPlan, planStaffGroupSync, releaseStaffGroups, staffGroupField } from "@/lib/staff-groups";
import { linkTeacherToSubjectsOfGroups } from "@/lib/teacher-subjects";

const SCOPE = "teachers.detail";

/** Roles that exist only to log a teacher/assistant in; any other role means the User is a real admin too. */
const TEACHER_ONLY_ROLES: ReadonlySet<string> = new Set(["TEACHER", "TEACHER_ASSISTANT"]);

const GROUP_BRIEF = {
  where: { deletedAt: null },
  orderBy: { name: "asc" },
  select: { id: true, name: true, grade: { select: { name: true } }, subject: { select: { id: true, name: true } } }
} as const;

async function findScopedTeacher(organizationId: string, branchIds: string[] | undefined, id: string) {
  return db.teacher.findFirst({
    where: {
      id,
      organizationId,
      deletedAt: null,
      ...(branchIds ? { branchId: { in: branchIds } } : {})
    },
    include: {
      branch: { select: { id: true, name: true } },
      groupsAsTeacher: GROUP_BRIEF,
      groupsAsAssistant: GROUP_BRIEF
    }
  });
}

type ScopedTeacher = NonNullable<Awaited<ReturnType<typeof findScopedTeacher>>>;

function assignedGroupIds(teacher: ScopedTeacher): string[] {
  return (teacher.isAssistant ? teacher.groupsAsAssistant : teacher.groupsAsTeacher).map((g) => g.id);
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("teachers.view");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const teacher = await findScopedTeacher(ctx.organizationId, branchIds, params.id);
    if (!teacher) throw new NotFoundError("Teacher not found.");
    return ok({ ...teacher, groupIds: assignedGroupIds(teacher) });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("teachers.update");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const existing = await findScopedTeacher(ctx.organizationId, branchIds, params.id);
    if (!existing) throw new NotFoundError("Teacher not found.");

    const input = await readJson(request, teacherUpdateSchema);
    const { groupIds, allowReassign, ...fields } = input;

    // Details and group assignments change together or not at all.
    const { updated, plan } = await db.$transaction(async (tx) => {
      const hasFieldChange = Object.values(fields).some((v) => v !== undefined);
      const row = hasFieldChange
        ? await tx.teacher.update({
            where: { id: existing.id },
            data: {
              ...(fields.fullName !== undefined ? { fullName: fields.fullName } : {}),
              ...(fields.phone !== undefined ? { phone: fields.phone } : {}),
              ...(fields.email !== undefined ? { email: fields.email } : {}),
              ...(fields.isActive !== undefined ? { isActive: fields.isActive } : {})
            }
          })
        : existing;

      let groupPlan = null;
      if (groupIds !== undefined) {
        groupPlan = await planStaffGroupSync(tx, {
          organizationId: ctx.organizationId,
          staff: { id: existing.id, branchId: existing.branchId, isAssistant: existing.isAssistant },
          groupIds,
          allowReassign: allowReassign ?? false
        });
        await applyStaffGroupPlan(tx, existing.id, groupPlan);
        if (!existing.isAssistant) await linkTeacherToSubjectsOfGroups(tx, existing.id, groupPlan.toAdd);
      }
      return { updated: row, plan: groupPlan };
    });

    const beforeGroupIds = assignedGroupIds(existing);
    const afterGroupIds = groupIds ?? beforeGroupIds;

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_TEACHER",
      entityType: "Teacher",
      entityId: existing.id,
      beforeValue: {
        fullName: existing.fullName,
        phone: existing.phone,
        email: existing.email,
        isActive: existing.isActive,
        groupIds: beforeGroupIds
      },
      afterValue: {
        fullName: updated.fullName,
        phone: updated.phone,
        email: updated.email,
        isActive: updated.isActive,
        groupIds: afterGroupIds,
        ...(plan ? { groupsAdded: plan.toAdd, groupsRemoved: plan.toRemove, reassignedFrom: plan.takeovers } : {})
      }
    });

    return ok({ ...updated, groupIds: afterGroupIds });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

/**
 * DELETE is a SOFT delete (same convention as students).
 *
 * Sessions, recitations and exams only keep the teacher's id as plain text
 * and attendance never points at a teacher, so history is untouched; the row
 * itself stays so names resolve in old records. In one transaction we:
 *   - stamp `deletedAt` / `isActive = false` (every list already filters `deletedAt: null`);
 *   - free the groups they were responsible for (`Group.teacherId` /
 *     `assistantId` -> NULL) so no live group points at a deleted person;
 *   - deactivate the linked login User when it exists only for this teacher
 *     (users with any other role are left alone and reported), then revoke
 *     that user's sessions so an open browser is signed out immediately.
 * A reason is mandatory and goes to the audit log.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("teachers.delete");
    const branchIds = ctx.isOrgWide ? undefined : ctx.branchIds;
    const existing = await findScopedTeacher(ctx.organizationId, branchIds, params.id);
    if (!existing) throw new NotFoundError("Teacher not found.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const reason = deleteReasonSchema.safeParse(body);
    if (!reason.success) {
      throw new BusinessRuleError("A reason is required to delete a teacher record.", { status: 400 });
    }

    let linkedUser: { id: string; roleNames: string[] } | null = null;
    if (existing.userId) {
      if (existing.userId === ctx.userId) {
        throw new BusinessRuleError("You cannot delete the teacher record linked to your own account.", {
          status: 409
        });
      }
      await assertCanManageUser(ctx, existing.userId);
      const user = await db.user.findFirst({
        where: { id: existing.userId, organizationId: ctx.organizationId, deletedAt: null },
        select: { id: true, userRoles: { select: { role: { select: { name: true } } } } }
      });
      if (user) linkedUser = { id: user.id, roleNames: user.userRoles.map((ur) => ur.role.name) };
    }
    const deactivateUser = linkedUser !== null && linkedUser.roleNames.every((name) => TEACHER_ONLY_ROLES.has(name));

    const { deleted, releasedGroupIds } = await db.$transaction(async (tx) => {
      const freed = await releaseStaffGroups(tx, { id: existing.id, isAssistant: existing.isAssistant });
      const row = await tx.teacher.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), isActive: false }
      });
      if (deactivateUser && linkedUser) {
        await tx.user.update({ where: { id: linkedUser.id }, data: { isActive: false } });
      }
      return { deleted: row, releasedGroupIds: freed };
    });

    if (deactivateUser && linkedUser) {
      await revokeAllSessionsForUser(linkedUser.id);
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: existing.isAssistant ? "DELETE_TEACHER_ASSISTANT" : "DELETE_TEACHER",
      entityType: "Teacher",
      entityId: existing.id,
      beforeValue: { ...existing, groupColumn: staffGroupField(existing.isAssistant) },
      afterValue: {
        deletedAt: deleted.deletedAt,
        releasedGroupIds,
        linkedUserId: linkedUser?.id ?? null,
        linkedUserDeactivated: deactivateUser
      },
      reason: reason.data.reason
    });

    return ok({
      id: existing.id,
      deleted: true,
      releasedGroups: releasedGroupIds.length,
      linkedUserDeactivated: deactivateUser,
      linkedUserKept: linkedUser !== null && !deactivateUser
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
