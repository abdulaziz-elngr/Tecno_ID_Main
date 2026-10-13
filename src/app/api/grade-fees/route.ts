import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { getCenterProfile } from "@/lib/settings";
import { currentYearMonth } from "@/lib/subscription-months";

/**
 * Subscription prices: Academic Stage -> Grade -> Monthly price.
 *
 * History is append-only. Setting a price inserts a NEW GradeFee row and
 * deactivates the previous one; nothing is updated in place, and existing
 * Subscription/Payment rows keep the amount they were created with.
 */

const setSchema = z.object({
  gradeId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  /** YYYY-MM-DD; defaults to the first day of the current month (centre time). */
  effectiveFrom: z.string().date().optional(),
  notes: z.string().trim().max(500).optional()
});

export async function GET() {
  try {
    const ctx = await requireAnyPermission(["subscriptions.view", "academic.fees.manage"]);
    const [stages, fees, counts] = await Promise.all([
      db.stage.findMany({
        where: { organizationId: ctx.organizationId, isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, name: true, grades: { where: { isActive: true }, orderBy: { order: "asc" }, select: { id: true, name: true } } }
      }),
      db.gradeFee.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { effectiveFrom: "desc" }
      }),
      db.student.groupBy({
        by: ["gradeId"],
        where: { organizationId: ctx.organizationId, deletedAt: null, status: "ACTIVE" },
        _count: { _all: true }
      })
    ]);

    const userIds = Array.from(new Set(fees.map((f) => f.createdById).filter((x): x is string => !!x)));
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.fullName]));
    const studentCount = new Map(counts.map((c) => [c.gradeId, c._count._all]));

    return ok({
      canManage: ctx.permissions.has("academic.fees.manage"),
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name,
        grades: s.grades.map((g) => {
          const history = fees
            .filter((f) => f.gradeId === g.id)
            .map((f) => ({
              id: f.id,
              amount: Number(f.amount),
              effectiveFrom: f.effectiveFrom,
              createdAt: f.createdAt,
              isActive: f.isActive,
              changedBy: f.createdById ? userName.get(f.createdById) ?? null : null,
              notes: f.notes
            }));
          return {
            id: g.id,
            name: g.name,
            studentCount: studentCount.get(g.id) ?? 0,
            current: history.find((h) => h.isActive) ?? null,
            history: history.slice(0, 10)
          };
        })
      }))
    });
  } catch (err) {
    return handleApiError("grade-fees.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.fees.manage");
    const input = await readJson(request, setSchema);

    const grade = await db.grade.findFirst({
      where: { id: input.gradeId, stage: { organizationId: ctx.organizationId } },
      select: { id: true, name: true, stage: { select: { name: true } } }
    });
    if (!grade) throw new BusinessRuleError("Invalid grade.", { status: 400 });

    let effectiveFrom: Date;
    if (input.effectiveFrom) {
      effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
    } else {
      const center = await getCenterProfile(ctx.organizationId);
      const ym = currentYearMonth(new Date(), center.timezone || "Africa/Cairo");
      effectiveFrom = new Date(Date.UTC(ym.year, ym.month - 1, 1));
    }

    const result = await db.$transaction(async (tx) => {
      const previous = await tx.gradeFee.findFirst({ where: { gradeId: grade.id, isActive: true }, orderBy: { effectiveFrom: "desc" } });
      await tx.gradeFee.updateMany({ where: { gradeId: grade.id, isActive: true }, data: { isActive: false } });
      const fee = await tx.gradeFee.create({
        data: {
          organizationId: ctx.organizationId,
          gradeId: grade.id,
          amount: input.amount,
          effectiveFrom,
          notes: input.notes,
          createdById: ctx.userId
        }
      });
      return { previous, fee };
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CHANGE_GRADE_FEE",
      entityType: "GradeFee",
      entityId: result.fee.id,
      beforeValue: result.previous
        ? { amount: Number(result.previous.amount), effectiveFrom: result.previous.effectiveFrom }
        : null,
      afterValue: {
        stage: grade.stage.name,
        grade: grade.name,
        amount: input.amount,
        effectiveFrom
      }
    });

    return created({ id: result.fee.id, amount: Number(result.fee.amount), effectiveFrom: result.fee.effectiveFrom });
  } catch (err) {
    return handleApiError("grade-fees.set", err);
  }
}
