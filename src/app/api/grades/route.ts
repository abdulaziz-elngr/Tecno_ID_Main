import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "grades";

const createSchema = z.object({
  stageId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).max(999).default(0)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.grades.manage");
    const url = new URL(request.url);
    const stageId = url.searchParams.get("stageId") ?? undefined;

    const grades = await db.grade.findMany({
      where: {
        stage: { organizationId: ctx.organizationId },
        ...(stageId ? { stageId } : {})
      },
      orderBy: [{ stage: { order: "asc" } }, { order: "asc" }],
      include: {
        stage: { select: { id: true, name: true } },
        _count: { select: { students: true, groups: true } }
      }
    });
    return ok(grades);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.grades.manage");
    const input = await readJson(request, createSchema);

    const stage = await db.stage.findFirst({
      where: { id: input.stageId, organizationId: ctx.organizationId }
    });
    if (!stage) throw new BusinessRuleError("Invalid stage.", { status: 400 });

    const existing = await db.grade.findFirst({ where: { stageId: input.stageId, name: input.name } });
    if (existing) throw new BusinessRuleError("This grade already exists under this stage.", { status: 409 });

    const grade = await db.grade.create({
      data: { stageId: input.stageId, name: input.name, order: input.order }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_GRADE",
      entityType: "Grade",
      entityId: grade.id,
      afterValue: grade
    });

    return created(grade);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
