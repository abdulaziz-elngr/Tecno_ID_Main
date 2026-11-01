import { db } from "./db";
import { validateSessionRow, verifySessionCookie } from "./session";
import { TtlCache } from "./ttl-cache";

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

/** Logins that work with their own groups only; they never get the "no branch = all branches" fallback. */
const TEACHING_ROLES: ReadonlySet<string> = new Set(["TEACHER", "TEACHER_ASSISTANT"]);

/**
 * Building the context walks user → roles → permissions (a deep join) and, for
 * staff, the branch list: several queries on EVERY API call. Cache the result
 * briefly; role/permission edits show up within AUTH_CACHE_MS. Call
 * `clearAuthContextCache()` after changing users, roles or permissions to apply
 * them immediately.
 */
const AUTH_CACHE_MS = 20 * 1000;
const authContextCache = new TtlCache<AuthContext>(AUTH_CACHE_MS, 500);

export function clearAuthContextCache(): void {
  authContextCache.clear();
}

export async function getAuthContext(): Promise<AuthContext | null> {
  // The JWT is verified locally (no database), so its `sub` can be trusted to start
  // loading the user's permissions at the same time as the session row is checked.
  // On a cold instance that is ONE database round trip of waiting instead of two.
  const payload = await verifySessionCookie();
  if (!payload) return null;

  const cached = authContextCache.get(payload.sub);
  const [sessionOk, ctx] = await Promise.all([
    validateSessionRow(payload),
    cached ? Promise.resolve(cached) : loadAuthContext(payload.sub)
  ]);

  // A revoked / expired session never gets (or caches) a context.
  if (!sessionOk || !ctx) return null;
  if (!cached) authContextCache.set(payload.sub, ctx);
  return ctx;
}

async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
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

  let branchIds = user.userBranches.map((ub) => ub.branchId);
  // The Users screen promises "leave the branch empty = every branch", so a staff login
  // (accountant, manager, receptionist...) with NO branch assigned sees all branches of
  // the organization — instead of an empty list everywhere. Teaching logins are the
  // exception: they stay limited to what is explicitly assigned to them.
  if (!isOrgWide && branchIds.length === 0 && !roleNames.some((r) => TEACHING_ROLES.has(r))) {
    const all = await db.branch.findMany({
      where: { deletedAt: null, center: { organizationId: user.organizationId } },
      select: { id: true }
    });
    branchIds = all.map((b) => b.id);
  }

  return {
    userId: user.id,
    organizationId: user.organizationId,
    fullName: user.fullName,
    permissions,
    roleNames,
    branchIds,
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
