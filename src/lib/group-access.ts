import { db } from "./db";
import { NotFoundError } from "./api";
import { ForbiddenError, resolveBranchScope, type AuthContext } from "./rbac";

/**
 * Group / student access rules shared by the performance routes (exams grading,
 * recitation, homework, student performance).
 *
 *  1. The record must belong to the caller's organization and a branch in scope.
 *  2. Teachers and teaching assistants (without `academic.groups.manage`) may only
 *     work with the groups they are assigned to — the same rule exams.create has
 *     always applied, now enforced for every read and write of these pages.
 */

const OWN_GROUP_ROLES = ["TEACHER", "TEACHER_ASSISTANT"];

/** True when the caller is limited to the groups they teach. */
export function isOwnGroupScoped(ctx: AuthContext): boolean {
  return (
    !ctx.isOrgWide &&
    !ctx.permissions.has("academic.groups.manage") &&
    ctx.roleNames.some((r) => OWN_GROUP_ROLES.includes(r))
  );
}

/**
 * undefined → not scoped (sees every group in their branches)
 * null      → scoped, but the login has no Teacher profile (sees nothing)
 * string    → scoped to groups where this Teacher is teacher or assistant
 */
export async function resolveOwnTeacherId(ctx: AuthContext): Promise<string | null | undefined> {
  if (!isOwnGroupScoped(ctx)) return undefined;
  const teacher = await db.teacher.findFirst({
    where: { userId: ctx.userId, deletedAt: null },
    select: { id: true }
  });
  return teacher?.id ?? null;
}

/** Prisma `Group` filter for a resolved teacher id (see resolveOwnTeacherId). */
export function ownGroupFilter(teacherId: string | null | undefined) {
  if (teacherId === undefined) return {};
  if (teacherId === null) return { id: "__no_access__" };
  return { OR: [{ teacherId }, { assistantId: teacherId }] };
}

export function assertOwnGroup(
  teacherId: string | null | undefined,
  group: { teacherId: string | null; assistantId: string | null }
): void {
  if (teacherId === undefined) return;
  if (teacherId === null || (group.teacherId !== teacherId && group.assistantId !== teacherId)) {
    throw new ForbiddenError("You can only access the groups you teach.");
  }
}

export interface AccessibleGroup {
  id: string;
  branchId: string;
  name: string;
  subjectId: string | null;
  subject: { id: string; name: string } | null;
  teacherId: string | null;
  assistantId: string | null;
  grade: { id: string; name: string; stage: { id: string; name: string } };
}

/** Loads a group the caller may use, or throws NotFound / Forbidden. */
export async function loadAccessibleGroup(ctx: AuthContext, groupId: string): Promise<AccessibleGroup> {
  const group = await db.group.findFirst({
    where: { id: groupId, deletedAt: null, branch: { deletedAt: null, center: { organizationId: ctx.organizationId } } },
    select: {
      id: true,
      branchId: true,
      name: true,
      subjectId: true,
      teacherId: true,
      assistantId: true,
      subject: { select: { id: true, name: true } },
      grade: { select: { id: true, name: true, stage: { select: { id: true, name: true } } } }
    }
  });
  if (!group) throw new NotFoundError("Group not found.");
  resolveBranchScope(ctx, group.branchId);
  assertOwnGroup(await resolveOwnTeacherId(ctx), group);
  return group;
}

export interface AccessibleStudent {
  id: string;
  fullName: string;
  studentCode: string;
  gender: "MALE" | "FEMALE";
  branchId: string;
  groupId: string;
}

/** Loads a student of an accessible group, or throws NotFound / Forbidden. */
export async function loadAccessibleStudent(ctx: AuthContext, studentId: string): Promise<AccessibleStudent> {
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      studentCode: true,
      gender: true,
      branchId: true,
      groupId: true,
      group: { select: { teacherId: true, assistantId: true } }
    }
  });
  if (!student) throw new NotFoundError("Student not found.");
  resolveBranchScope(ctx, student.branchId);
  assertOwnGroup(await resolveOwnTeacherId(ctx), student.group);
  return {
    id: student.id,
    fullName: student.fullName,
    studentCode: student.studentCode,
    gender: student.gender,
    branchId: student.branchId,
    groupId: student.groupId
  };
}
