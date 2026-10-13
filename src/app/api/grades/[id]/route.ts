import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "grades.detail";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  order: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional()
});

async function loadGrade(organizationId: string, id: string) {
  const grade = await db.grade.findFirst({
    where: { id, stage: { organizationId } },
    include: { stage: true, _count: { select: { students: true, groups: true } } }
  });
  if (!grade) throw new NotFoundError("Grade not found.");
  return grade;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.grades.manage");
    return ok(await loadGrade(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.grades.manage");
    const grade = await loadGrade(ctx.organizationId, params.id);
    const input = await readJson(request, updateSchema);

    // A grade cannot be reactivated under an inactive stage (spec §2).
    if (input.isActive === true && !grade.stage.isActive) {
      throw new BusinessRuleError("Cannot activate a grade whose stage is inactive.");
    }
    if (input.isActive === false) {
      await db.group.updateMany({ where: { gradeId: grade.id }, data: { isActive: false } });
    }

    const updated = await db.grade.update({
      where: { id: grade.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_GRADE",
      entityType: "Grade",
      entityId: grade.id,
      beforeValue: { name: grade.name, order: grade.order, isActive: grade.isActive },
      afterValue: updated
    });

    return ok(await loadGrade(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.grades.manage");
    const grade = await loadGrade(ctx.organizationId, params.id);

    if (grade._count.students > 0 || grade._count.groups > 0) {
      throw new BusinessRuleError(
        "This grade still has students or groups and cannot be removed. Deactivate it instead."
      );
    }

    await db.grade.delete({ where: { id: grade.id } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_GRADE",
      entityType: "Grade",
      entityId: grade.id,
      beforeValue: { name: grade.name }
    });

    return ok({ id: grade.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
