import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/rbac";
import { resolveOwnGroupIds } from "@/lib/group-access";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "stages";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  order: z.number().int().min(0).max(999).default(0),
  grades: z.array(z.string().trim().min(1).max(100)).max(30).default([])
});

/**
 * Stage -> Grade -> Group -> Student (spec §2).
 * A Stage never links directly to Group/Student — only through Grade.
 */
export async function GET() {
  try {
    // Read-only list used by every stage/grade/group picker, so it is open to
    // the roles that work with groups. Writing still needs academic.stages.manage.
    const ctx = await requireAnyPermission([
      "academic.stages.manage",
      "students.view",
      "sessions.view",
      "attendance.view",
      "payments.view"
    ]);
    // Teaching logins only see the stages/grades that contain their own groups.
    const ownGroupIds = await resolveOwnGroupIds(ctx);
    const ownGradeFilter = ownGroupIds ? { groups: { some: { id: { in: ownGroupIds }, deletedAt: null } } } : {};
    const stages = await db.stage.findMany({
      where: { organizationId: ctx.organizationId, ...(ownGroupIds ? { grades: { some: ownGradeFilter } } : {}) },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: {
        grades: {
          where: ownGradeFilter,
          orderBy: { order: "asc" },
          include: { _count: { select: { students: true, groups: true } } }
        }
      }
    });
    return ok(stages);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.stages.manage");
    const input = await readJson(request, createSchema);

    const existing = await db.stage.findFirst({
      where: { organizationId: ctx.organizationId, name: input.name }
    });
    if (existing) throw new BusinessRuleError("This stage already exists.", { status: 409 });

    const stage = await db.stage.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        order: input.order,
        grades: {
          create: input.grades.map((name, index) => ({ name, order: index }))
        }
      },
      include: { grades: true }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_STAGE",
      entityType: "Stage",
      entityId: stage.id,
      afterValue: { name: stage.name, grades: stage.grades.map((g) => g.name) }
    });

    return created(stage);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
