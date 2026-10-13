import { db } from "./db";
import { BusinessRuleError } from "./api";
import { canAccessBranch } from "./scope";
import type { AuthContext } from "./rbac";

/**
 * Validates a list of teacher ids supplied by the client for a subject.
 * Each must be a real, non-deleted TEACHER (not an assistant) of the caller's
 * organization inside a branch the caller may manage. Returns the de-duplicated ids.
 */
export async function assertSubjectTeachers(ctx: AuthContext, teacherIds: readonly string[]): Promise<string[]> {
  const unique = Array.from(new Set(teacherIds));
  if (unique.length === 0) return [];
  const teachers = await db.teacher.findMany({
    where: { id: { in: unique }, organizationId: ctx.organizationId, deletedAt: null, isAssistant: false },
    select: { id: true, branchId: true }
  });
  const valid = new Set(teachers.filter((t) => canAccessBranch(ctx, t.branchId)).map((t) => t.id));
  if (unique.some((id) => !valid.has(id))) {
    throw new BusinessRuleError("One or more selected teachers are invalid.", { status: 400 });
  }
  return unique;
}
