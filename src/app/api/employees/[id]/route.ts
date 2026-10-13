import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { deleteReasonSchema, fullNameSchema, hireDateSchema, optionalPhoneSchema } from "@/lib/staff";
import { positionSchema } from "@/lib/positions";

const SCOPE = "employees.detail";

const updateSchema = z.object({
  fullName: fullNameSchema.optional(),
  phone: optionalPhoneSchema,
  position: positionSchema,
  hireDate: hireDateSchema,
  isActive: z.boolean().optional()
});

const SELECT = {
  id: true,
  fullName: true,
  phone: true,
  position: true,
  hireDate: true,
  photoUrl: true,
  isActive: true,
  branchId: true,
  branch: { select: { id: true, name: true } }
} as const;

async function findScopedEmployee(organizationId: string, branchIds: string[] | undefined, id: string) {
  return db.employee.findFirst({
    where: { id, organizationId, deletedAt: null, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    select: SELECT
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("employees.view");
    const employee = await findScopedEmployee(ctx.organizationId, ctx.isOrgWide ? undefined : ctx.branchIds, params.id);
    if (!employee) throw new NotFoundError("Employee not found.");
    return ok(employee);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("employees.update");
    const existing = await findScopedEmployee(ctx.organizationId, ctx.isOrgWide ? undefined : ctx.branchIds, params.id);
    if (!existing) throw new NotFoundError("Employee not found.");

    const input = await readJson(request, updateSchema);

    const updated = await db.employee.update({
      where: { id: existing.id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.hireDate !== undefined ? { hireDate: input.hireDate } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      },
      select: SELECT
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_EMPLOYEE",
      entityType: "Employee",
      entityId: existing.id,
      beforeValue: existing,
      afterValue: updated
    });

    return ok(updated);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

/**
 * DELETE is a SOFT delete. EmployeeAttendance rows reference the employee by
 * foreign key and are payroll-relevant history, so the row is only stamped
 * with `deletedAt` (and deactivated) — never removed. The employee list and
 * the attendance recorder (which looks employees up with `deletedAt: null`)
 * stop offering them, while past attendance records keep resolving the name.
 * The Employee model has no login User link, so there is no account to
 * deactivate. A reason is mandatory and goes to the audit log.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("employees.delete");
    const existing = await findScopedEmployee(ctx.organizationId, ctx.isOrgWide ? undefined : ctx.branchIds, params.id);
    if (!existing) throw new NotFoundError("Employee not found.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const reason = deleteReasonSchema.safeParse(body);
    if (!reason.success) {
      throw new BusinessRuleError("A reason is required to delete an employee record.", { status: 400 });
    }

    const deleted = await db.employee.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
      select: { id: true, deletedAt: true }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_EMPLOYEE",
      entityType: "Employee",
      entityId: existing.id,
      beforeValue: existing,
      afterValue: deleted,
      reason: reason.data.reason
    });

    return ok({ id: existing.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
