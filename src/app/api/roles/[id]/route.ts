import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { assertCanEditRole } from "@/lib/scope";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "roles.detail";

const updateSchema = z.object({
  description: z.string().trim().max(300).optional(),
  permissionKeys: z.array(z.string()).optional(),
  reason: z.string().trim().min(3).max(500)
});

async function loadRole(organizationId: string, id: string) {
  const role = await db.role.findFirst({
    where: { id, organizationId },
    include: {
      rolePermissions: { select: { permission: { select: { id: true, key: true } } } },
      _count: { select: { userRoles: true } }
    }
  });
  if (!role) throw new NotFoundError("Role not found.");
  return role;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("roles.manage");
    const role = await loadRole(ctx.organizationId, params.id);
    return ok({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount: role._count.userRoles,
      permissionKeys: role.rolePermissions.map((rp) => rp.permission.key)
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("roles.manage");
    const role = await loadRole(ctx.organizationId, params.id);
    const input = await readJson(request, updateSchema);
    assertCanEditRole(ctx, role, input.permissionKeys);

    if (input.permissionKeys) {
      const unknown = input.permissionKeys.filter((k) => !ALL_PERMISSION_KEYS.includes(k));
      if (unknown.length > 0) {
        throw new BusinessRuleError(`Unknown permission key(s): ${unknown.join(", ")}`);
      }

      // Escalation guard: never let the last "users.manage" holder disappear.
      if (role.name === "SUPER_ADMIN" && !input.permissionKeys.includes("users.manage")) {
        throw new BusinessRuleError("SUPER_ADMIN must retain user management permission.");
      }

      const permissions = await db.permission.findMany({ where: { key: { in: input.permissionKeys } } });
      await db.$transaction([
        db.rolePermission.deleteMany({ where: { roleId: role.id } }),
        db.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id }))
        })
      ]);
    }

    if (input.description !== undefined) {
      await db.role.update({ where: { id: role.id }, data: { description: input.description } });
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_ROLE_PERMISSIONS",
      entityType: "Role",
      entityId: role.id,
      beforeValue: { permissions: role.rolePermissions.map((rp) => rp.permission.key) },
      afterValue: { permissions: input.permissionKeys ?? "unchanged" },
      reason: input.reason
    });

    const after = await loadRole(ctx.organizationId, params.id);
    return ok({
      id: after.id,
      name: after.name,
      description: after.description,
      isSystem: after.isSystem,
      permissionKeys: after.rolePermissions.map((rp) => rp.permission.key)
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("roles.manage");
    const role = await loadRole(ctx.organizationId, params.id);
    const { reason } = await readJson(request, z.object({ reason: z.string().trim().min(3).max(500) }));
    assertCanEditRole(ctx, role);

    if (role.isSystem) throw new BusinessRuleError("System roles cannot be deleted.");
    if (role._count.userRoles > 0) {
      throw new BusinessRuleError(
        `This role is assigned to ${role._count.userRoles} user(s). Reassign them first.`
      );
    }

    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId: role.id } }),
      db.role.delete({ where: { id: role.id } })
    ]);

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_ROLE",
      entityType: "Role",
      entityId: role.id,
      beforeValue: { name: role.name },
      reason
    });

    return ok({ id: role.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
