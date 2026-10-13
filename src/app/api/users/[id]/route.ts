import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { assertCanAssign, assertCanManageUser } from "@/lib/scope";
import { hashPassword, isPasswordStrongEnough } from "@/lib/password";
import { revokeAllSessionsForUser } from "@/lib/session";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "users.detail";

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(180).nullable().optional(),
  phone: z.string().trim().min(6).max(30).nullable().optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).min(1).max(10).optional(),
  branchIds: z.array(z.string().uuid()).max(50).optional(),
  newPassword: z.string().min(10).max(200).optional(),
  unlock: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500)
});

const SAFE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  isActive: true,
  mfaEnabled: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  userRoles: { select: { role: { select: { id: true, name: true } } } },
  userBranches: { select: { branch: { select: { id: true, name: true } } } }
} as const;

async function loadUser(organizationId: string, id: string) {
  const user = await db.user.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: SAFE_SELECT
  });
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("users.manage");
    return ok(await loadUser(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("users.manage");
    const before = await loadUser(ctx.organizationId, params.id);
    await assertCanManageUser(ctx, before.id);
    const input = await readJson(request, updateSchema);

    if (input.roleIds) {
      const roles = await db.role.findMany({
        where: { id: { in: input.roleIds }, organizationId: ctx.organizationId }
      });
      if (roles.length !== input.roleIds.length) {
        throw new BusinessRuleError("One or more roles are invalid for this organization.");
      }
      // Rule 11 + privilege-escalation guard: a user can never strip their
      // own administrative roles by accident and lock the org out.
      if (before.id === ctx.userId) {
        const keepsUserManagement = await db.rolePermission.count({
          where: { roleId: { in: input.roleIds }, permission: { key: "users.manage" } }
        });
        if (keepsUserManagement === 0) {
          throw new BusinessRuleError(
            "You cannot remove your own user-management permission. Ask another administrator."
          );
        }
      }
    }

    if (input.branchIds) {
      const branches = await db.branch.findMany({
        where: {
          id: { in: input.branchIds },
          deletedAt: null,
          center: { organizationId: ctx.organizationId }
        }
      });
      if (branches.length !== input.branchIds.length) {
        throw new BusinessRuleError("One or more branches are invalid for this organization.");
      }
    }

    // Privilege-escalation guard (see src/lib/scope.ts).
    await assertCanAssign(ctx, { roleIds: input.roleIds, branchIds: input.branchIds });

    if (input.newPassword && !isPasswordStrongEnough(input.newPassword)) {
      throw new BusinessRuleError(
        "Password must be at least 10 characters and contain letters and numbers."
      );
    }

    await db.$transaction(async (tx) => {
      if (input.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: before.id } });
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({ userId: before.id, roleId }))
        });
      }
      if (input.branchIds) {
        await tx.userBranch.deleteMany({ where: { userId: before.id } });
        if (input.branchIds.length > 0) {
          await tx.userBranch.createMany({
            data: input.branchIds.map((branchId) => ({ userId: before.id, branchId }))
          });
        }
      }
      await tx.user.update({
        where: { id: before.id },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.unlock ? { lockedUntil: null, failedLoginCount: 0 } : {}),
          ...(input.newPassword ? { passwordHash: await hashPassword(input.newPassword) } : {})
        }
      });
    });

    // Changing credentials, roles or activation invalidates every live session.
    if (input.newPassword || input.roleIds || input.branchIds || input.isActive === false) {
      await revokeAllSessionsForUser(before.id);
    }

    const after = await loadUser(ctx.organizationId, params.id);

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_USER",
      entityType: "User",
      entityId: before.id,
      beforeValue: {
        fullName: before.fullName,
        isActive: before.isActive,
        roles: before.userRoles.map((r) => r.role.name)
      },
      afterValue: {
        fullName: after.fullName,
        isActive: after.isActive,
        roles: after.userRoles.map((r) => r.role.name),
        passwordChanged: Boolean(input.newPassword)
      },
      reason: input.reason
    });

    return ok(after);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("users.manage");
    const user = await loadUser(ctx.organizationId, params.id);
    await assertCanManageUser(ctx, user.id);
    const { reason } = await readJson(request, z.object({ reason: z.string().trim().min(3).max(500) }));

    if (user.id === ctx.userId) {
      throw new BusinessRuleError("You cannot deactivate your own account.");
    }

    // Soft delete + full session revocation. Audit history is preserved.
    await db.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date(), isActive: false }
    });
    await revokeAllSessionsForUser(user.id);

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_USER",
      entityType: "User",
      entityId: user.id,
      beforeValue: { fullName: user.fullName, email: user.email },
      reason
    });

    return ok({ id: user.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
