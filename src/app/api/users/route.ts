import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { assertCanAssign } from "@/lib/scope";
import { hashPassword } from "@/lib/password";
import {
  BusinessRuleError,
  created,
  handleApiError,
  paginated,
  paginationSchema,
  readJson,
  readQuery
} from "@/lib/api";

const SCOPE = "users";

const listSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  roleId: z.string().uuid().optional(),
  isActive: z.enum(["true", "false"]).optional()
});

const createSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(180).optional(),
    phone: z.string().trim().min(6).max(30).optional(),
    password: z.string().min(10).max(200),
    roleIds: z.array(z.string().uuid()).min(1).max(10),
    branchIds: z.array(z.string().uuid()).max(50).default([]),
    isActive: z.boolean().default(true)
  })
  .refine((v) => v.email || v.phone, { message: "Either an email or a phone number is required." });

/** Never expose passwordHash / mfaSecret (§42). */
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

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("users.manage");
    const query = readQuery(request, listSchema);

    const where = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(query.isActive ? { isActive: query.isActive === "true" } : {}),
      ...(query.roleId ? { userRoles: { some: { roleId: query.roleId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: "insensitive" as const } },
              { email: { contains: query.search, mode: "insensitive" as const } },
              { phone: { contains: query.search } }
            ]
          }
        : {})
    };

    const [rows, total] = await Promise.all([
      db.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.user.count({ where })
    ]);

    return paginated(rows, { page: query.page, pageSize: query.pageSize, total });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("users.manage");
    const input = await readJson(request, createSchema);

    if (input.email) {
      const clash = await db.user.findUnique({ where: { email: input.email } });
      if (clash) throw new BusinessRuleError("This email is already in use.", { status: 409 });
    }
    if (input.phone) {
      const clash = await db.user.findUnique({ where: { phone: input.phone } });
      if (clash) throw new BusinessRuleError("This phone number is already in use.", { status: 409 });
    }

    // Roles must belong to the caller's organization — never trust the ids.
    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: ctx.organizationId }
    });
    if (roles.length !== input.roleIds.length) {
      throw new BusinessRuleError("One or more roles are invalid for this organization.");
    }

    if (input.branchIds.length > 0) {
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

    const passwordHash = await hashPassword(input.password);

    const user = await db.user.create({
      data: {
        organizationId: ctx.organizationId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        isActive: input.isActive,
        userRoles: { create: input.roleIds.map((roleId) => ({ roleId })) },
        userBranches: { create: input.branchIds.map((branchId) => ({ branchId })) }
      },
      select: SAFE_SELECT
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_USER",
      entityType: "User",
      entityId: user.id,
      afterValue: { fullName: user.fullName, email: user.email, roles: roles.map((r) => r.name) }
    });

    return created(user);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
