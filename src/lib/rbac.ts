import { db } from "./db";
import { getSessionPayload } from "./session";

/**
 * RBAC + scope resolution.
 *
 * CRITICAL SECURITY RULE (see spec §44 API SECURITY):
 * Organization ID, branch ID, user ID, and role are NEVER trusted from
 * client input. They are always re-derived here from the authenticated
 * session on the server. Every protected route must call
 * `requirePermission()` and use the returned `AuthContext` — not any
 * org/branch/user id that might appear in the request body or query.
 */

export interface AuthContext {
  userId: string;
  organizationId: string;
  fullName: string;
  permissions: Set<string>;
  roleNames: string[];
  /** Branch IDs this user is scoped to. Empty array = all branches in org
   *  (true for SUPER_ADMIN / CENTER_OWNER, who have no UserBranch rows). */
  branchIds: string[];
  isOrgWide: boolean;
}

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const ORG_WIDE_ROLES: ReadonlySet<string> = new Set(["SUPER_ADMIN", "CENTER_OWNER"]);

export async function getAuthContext(): Promise<AuthContext | null> {
  const payload = await getSessionPayload();
  if (!payload) return null;

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    include: {
      userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
      userBranches: true
    }
  });

  if (!user || !user.isActive || user.deletedAt) return null;

  const permissions = new Set<string>();
  const roleNames: string[] = [];
  for (const ur of user.userRoles) {
    roleNames.push(ur.role.name);
    for (const rp of ur.role.rolePermissions) {
      permissions.add(rp.permission.key);
    }
  }

  const isOrgWide = roleNames.some((r) => ORG_WIDE_ROLES.has(r));

  return {
    userId: user.id,
    organizationId: user.organizationId,
    fullName: user.fullName,
    permissions,
    roleNames,
    branchIds: user.userBranches.map((ub) => ub.branchId),
    isOrgWide
  };
}

/**
 * Throws UnauthorizedError (no valid session) or ForbiddenError
 * (valid session, missing permission). Use in every API route that
 * touches protected data.
 */
export async function requirePermission(permissionKey: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new UnauthorizedError();
  if (!ctx.permissions.has(permissionKey)) {
    throw new ForbiddenError(`Missing permission: ${permissionKey}`);
  }
  return ctx;
}

/**
 * Like `requirePermission`, but passes when the user holds AT LEAST ONE of the
 * given keys. Use for read-only lookups (e.g. the group list) that several
 * different roles legitimately need.
 */
export async function requireAnyPermission(permissionKeys: readonly string[]): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new UnauthorizedError();
  if (!permissionKeys.some((key) => ctx.permissions.has(key))) {
    throw new ForbiddenError(`Missing permission: one of ${permissionKeys.join(", ")}`);
  }
  return ctx;
}

/**
 * Verifies a branchId (e.g. from a query param) both belongs to the
 * user's organization AND is within their assigned branch scope.
 * Returns the safe, verified branchId list to filter queries by.
 */
export function resolveBranchScope(ctx: AuthContext, requestedBranchId?: string | null): string[] | undefined {
  if (ctx.isOrgWide) {
    // Org-wide roles may optionally filter by a specific branch.
    return requestedBranchId ? [requestedBranchId] : undefined;
  }
  if (requestedBranchId) {
    if (!ctx.branchIds.includes(requestedBranchId)) {
      throw new ForbiddenError("You do not have access to this branch");
    }
    return [requestedBranchId];
  }
  return ctx.branchIds;
}
