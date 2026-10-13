import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "stages.detail";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  order: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
  addGrade: z.string().trim().min(1).max(100).optional()
});

async function loadStage(organizationId: string, id: string) {
  const stage = await db.stage.findFirst({
    where: { id, organizationId },
    include: { grades: { orderBy: { order: "asc" } }, _count: { select: { students: true } } }
  });
  if (!stage) throw new NotFoundError("Stage not found.");
  return stage;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.stages.manage");
    return ok(await loadStage(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.stages.manage");
    const stage = await loadStage(ctx.organizationId, params.id);
    const input = await readJson(request, updateSchema);

    if (input.addGrade) {
      const duplicate = stage.grades.some((g) => g.name === input.addGrade);
      if (duplicate) throw new BusinessRuleError("This grade already exists in the stage.", { status: 409 });
      await db.grade.create({
        data: { stageId: stage.id, name: input.addGrade, order: stage.grades.length }
      });
    }

    // Deactivating a stage cascades to deactivating its grades — a
    // group can never sit under an inactive stage/grade (spec §2, §36).
    if (input.isActive === false) {
      await db.grade.updateMany({ where: { stageId: stage.id }, data: { isActive: false } });
    }

    await db.stage.update({
      where: { id: stage.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_STAGE",
      entityType: "Stage",
      entityId: stage.id,
      beforeValue: { name: stage.name, order: stage.order, isActive: stage.isActive },
      afterValue: input
    });

    return ok(await loadStage(ctx.organizationId, params.id));
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.stages.manage");
    const stage = await loadStage(ctx.organizationId, params.id);

    if (stage._count.students > 0) {
      throw new BusinessRuleError(
        "This stage still has students enrolled and cannot be removed. Deactivate it instead."
      );
    }
    const groupCount = await db.group.count({ where: { grade: { stageId: stage.id } }, });
    if (groupCount > 0) {
      throw new BusinessRuleError(
        "This stage still has groups under it and cannot be removed. Deactivate it instead."
      );
    }

    await db.grade.deleteMany({ where: { stageId: stage.id } });
    await db.stage.delete({ where: { id: stage.id } });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "DELETE_STAGE",
      entityType: "Stage",
      entityId: stage.id,
      beforeValue: { name: stage.name }
    });

    return ok({ id: stage.id, deleted: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
