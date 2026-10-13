import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { assertCanEditRole } from "@/lib/scope";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions";
import { BusinessRuleError, created, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "roles";

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers and underscores only."),
  description: z.string().trim().max(300).optional(),
  permissionKeys: z.array(z.string()).max(ALL_PERMISSION_KEYS.length).default([])
});

export async function GET() {
  try {
    const ctx = await requirePermission("roles.manage");
    const roles = await db.role.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: {
        rolePermissions: { select: { permission: { select: { key: true, module: true } } } },
        _count: { select: { userRoles: true } }
      }
    });

    return ok(
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        userCount: r._count.userRoles,
        permissionKeys: r.rolePermissions.map((rp) => rp.permission.key)
      }))
    );
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("roles.manage");
    const input = await readJson(request, createSchema);

    const unknown = input.permissionKeys.filter((k) => !ALL_PERMISSION_KEYS.includes(k));
    if (unknown.length > 0) {
      throw new BusinessRuleError(`Unknown permission key(s): ${unknown.join(", ")}`);
    }
    assertCanEditRole(ctx, null, input.permissionKeys);

    const existing = await db.role.findFirst({
      where: { organizationId: ctx.organizationId, name: input.name }
    });
    if (existing) throw new BusinessRuleError("A role with this name already exists.", { status: 409 });

    const permissions = await db.permission.findMany({ where: { key: { in: input.permissionKeys } } });

    const role = await db.role.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description,
        isSystem: false,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) }
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_ROLE",
      entityType: "Role",
      entityId: role.id,
      afterValue: { name: role.name, permissions: input.permissionKeys }
    });

    return created(role);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
