import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ForbiddenError, ORG_WIDE_ROLES, type AuthContext } from "./rbac";

/**
 * Server-side ownership checks for IDs supplied by the client.
 *
 * An ID in a request body/query is only a *claim*. Before it is used to
 * link records or mutate data, it must be re-verified against the
 * caller's organization and branch scope derived from the session.
 */

type Client = Prisma.TransactionClient | typeof db;

/** True when the caller may act on this branch (org-wide roles: any branch of their org). */
export function canAccessBranch(ctx: AuthContext, branchId: string): boolean {
  return ctx.isOrgWide || ctx.branchIds.includes(branchId);
}

/**
 * A teacher/assistant can be attached to a group only if they belong to
 * the caller's organization, are not deleted, and sit in a branch the
 * caller is allowed to manage.
 */
export async function isAssignableTeacher(
  ctx: AuthContext,
  teacherId: string,
  client: Client = db
): Promise<boolean> {
  const teacher = await client.teacher.findFirst({
    where: { id: teacherId, organizationId: ctx.organizationId, deletedAt: null },
    select: { branchId: true }
  });
  return !!teacher && canAccessBranch(ctx, teacher.branchId);
}

/**
 * Parent rows are global (unique phone, no organizationId) by design.
 * A parent is "shared" when it is linked to a student of ANOTHER
 * organization. Shared parents must never be modified from here: the
 * change would silently rewrite another tenant's contact data.
 */
export async function isParentSharedWithOtherOrg(
  parentId: string,
  organizationId: string,
  client: Client = db
): Promise<boolean> {
  const foreign = await client.studentParent.count({
    where: { parentId, student: { organizationId: { not: organizationId } } }
  });
  return foreign > 0;
}

export interface ParentInput {
  phone: string;
  /** Omit to leave an existing parent's name untouched (a placeholder is used only on create). */
  fullName?: string;
  whatsappNumber?: string;
  preferredLanguage?: "ar" | "en";
}

/**
 * Finds or creates a parent by phone for `organizationId`.
 *  - new phone            -> created
 *  - existing, own-org only -> updated with the supplied fields
 *  - existing, shared with another org -> returned UNCHANGED (link only)
 */
export async function upsertParentForOrg(
  client: Client,
  organizationId: string,
  input: ParentInput
) {
  const existing = await client.parent.findUnique({ where: { phone: input.phone } });
  if (!existing) {
    return client.parent.create({
      data: {
        fullName: input.fullName ?? "Parent/Guardian",
        phone: input.phone,
        whatsappNumber: input.whatsappNumber,
        preferredLanguage: input.preferredLanguage
      }
    });
  }
  if (await isParentSharedWithOtherOrg(existing.id, organizationId, client)) {
    return existing;
  }
  return client.parent.update({
    where: { id: existing.id },
    data: {
      fullName: input.fullName,
      whatsappNumber: input.whatsappNumber,
      preferredLanguage: input.preferredLanguage
    }
  });
}

/**
 * Privilege-escalation guard for user management.
 *
 * Organization-wide administrators may assign any role/branch inside their
 * organization. Everyone else holding `users.manage` may only hand out
 * roles/branches that are not broader than their own:
 *   - never an organization-wide role (SUPER_ADMIN / CENTER_OWNER);
 *   - never a role carrying a permission they do not hold themselves;
 *   - never a branch outside their own branch scope.
 * Role and branch ids must already have been verified to belong to the
 * caller's organization.
 */
export async function assertCanAssign(
  ctx: AuthContext,
  input: { roleIds?: string[]; branchIds?: string[] },
  client: Client = db
): Promise<void> {
  if (ctx.isOrgWide) return;

  if (input.roleIds && input.roleIds.length > 0) {
    const roles = await client.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: ctx.organizationId },
      include: { rolePermissions: { include: { permission: { select: { key: true } } } } }
    });
    for (const role of roles) {
      if (ORG_WIDE_ROLES.has(role.name)) {
        throw new ForbiddenError("Only organization-wide administrators can grant this role.");
      }
      if (role.rolePermissions.some((rp) => !ctx.permissions.has(rp.permission.key))) {
        throw new ForbiddenError("You cannot grant a role with permissions you do not hold.");
      }
    }
  }

  if (input.branchIds && input.branchIds.some((id) => !ctx.branchIds.includes(id))) {
    throw new ForbiddenError("You cannot assign branches outside your own access.");
  }
}

/**
 * A non-organization-wide manager may only modify users who are neither
 * organization-wide administrators nor attached to branches outside the
 * manager's own scope.
 */
export async function assertCanManageUser(
  ctx: AuthContext,
  targetUserId: string,
  client: Client = db
): Promise<void> {
  if (ctx.isOrgWide) return;
  const target = await client.user.findFirst({
    where: { id: targetUserId, organizationId: ctx.organizationId },
    select: {
      userRoles: { select: { role: { select: { name: true } } } },
      userBranches: { select: { branchId: true } }
    }
  });
  if (!target) return; // caller reports 404 itself
  if (target.userRoles.some((ur) => ORG_WIDE_ROLES.has(ur.role.name))) {
    throw new ForbiddenError("Only organization-wide administrators can manage this user.");
  }
  if (target.userBranches.some((ub) => !ctx.branchIds.includes(ub.branchId))) {
    throw new ForbiddenError("This user belongs to a branch outside your access.");
  }
}

/**
 * Role-management escalation guard. Organization-wide administrators are
 * unrestricted; anyone else may neither edit an organization-wide role
 * nor put a permission into a role that they do not hold themselves.
 */
export function assertCanEditRole(
  ctx: AuthContext,
  role: { name: string } | null,
  permissionKeys?: string[]
): void {
  if (ctx.isOrgWide) return;
  if (role && ORG_WIDE_ROLES.has(role.name)) {
    throw new ForbiddenError("Only organization-wide administrators can modify this role.");
  }
  if (permissionKeys && permissionKeys.some((key) => !ctx.permissions.has(key))) {
    throw new ForbiddenError("You cannot grant permissions you do not hold.");
  }
}
