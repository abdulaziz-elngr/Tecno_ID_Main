import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readJson } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { getPaymentRules } from "@/lib/settings";
import { computeSubscriptionStatus } from "@/lib/billing";
import { feeForMonth } from "@/lib/subscription-months";

const schema = z.object({
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  branchId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  amount: z.number().min(0).max(1000000).optional(),
  dueDay: z.number().int().min(1).max(28).optional()
});

/**
 * Bulk-creates the monthly tuition charges for every active student in
 * scope. Idempotent: existing (student, group, period) rows are skipped
 * rather than duplicated or overwritten, so re-running never destroys
 * an already-paid record.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("subscriptions.manage");
    const input = await readJson(request, schema);
    const branchIds = resolveBranchScope(ctx, input.branchId);
    const rules = await getPaymentRules(ctx.organizationId);

    const dueDay = input.dueDay ?? rules.dueDayOfMonth;
    const dueDate = new Date(Date.UTC(input.periodYear, input.periodMonth - 1, dueDay));

    // Each Student belongs to exactly one Group (Student.groupId is the
    // source of truth — there is no groupStudent join table), so the
    // "enrollment" set is just the matching active students.
    const enrollments = await db.student.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        organizationId: ctx.organizationId,
        ...(input.groupId ? { groupId: input.groupId } : {}),
        ...(input.stageId ? { stageId: input.stageId } : {}),
        ...(input.gradeId ? { gradeId: input.gradeId } : {}),
        group: { isActive: true, deletedAt: null, ...(branchIds ? { branchId: { in: branchIds } } : {}) }
      },
      select: { id: true, groupId: true, branchId: true, gradeId: true },
      take: 5000
    });

    const existing = await db.subscription.findMany({
      where: {
        organizationId: ctx.organizationId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        studentId: { in: enrollments.map((e) => e.id) }
      },
      select: { studentId: true, groupId: true }
    });
    const existingKeys = new Set(existing.map((e) => `${e.studentId}:${e.groupId ?? ""}`));

    // The price comes from the student's GRADE (Stage -> Grade -> Price) as it was
    // in force for the generated month. A manual amount overrides it. Students
    // whose grade has no price are skipped and reported, never charged a guess.
    const gradeIds = Array.from(new Set(enrollments.map((e) => e.gradeId)));
    const feeRows = await db.gradeFee.findMany({
      where: { organizationId: ctx.organizationId, gradeId: { in: gradeIds } },
      select: { gradeId: true, amount: true, effectiveFrom: true }
    });
    const feesByGrade = new Map<string, { amount: number; effectiveFrom: Date }[]>();
    for (const f of feeRows) {
      feesByGrade.set(f.gradeId, [...(feesByGrade.get(f.gradeId) ?? []), { amount: Number(f.amount), effectiveFrom: f.effectiveFrom }]);
    }
    const period = { year: input.periodYear, month: input.periodMonth };

    let noPrice = 0;
    const toCreate = [];
    for (const e of enrollments) {
      if (existingKeys.has(`${e.id}:${e.groupId}`)) continue;
      const amount = input.amount ?? feeForMonth(feesByGrade.get(e.gradeId) ?? [], period);
      if (amount === null || amount === undefined || amount <= 0) {
        noPrice++;
        continue;
      }
      toCreate.push({
        organizationId: ctx.organizationId,
        branchId: e.branchId,
        studentId: e.id,
        groupId: e.groupId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        amount,
        dueDate,
        status: computeSubscriptionStatus({ amount, discount: 0, paidAmount: 0, dueDate })
      });
    }

    const result = toCreate.length
      ? await db.subscription.createMany({ data: toCreate, skipDuplicates: true })
      : { count: 0 };

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "GENERATE_SUBSCRIPTIONS",
      entityType: "Subscription",
      afterValue: {
        created: result.count,
        skipped: enrollments.length - toCreate.length - noPrice,
        noPrice,
        period: `${input.periodYear}-${String(input.periodMonth).padStart(2, "0")}`
      }
    });

    return ok({
      created: result.count,
      skipped: enrollments.length - toCreate.length - noPrice,
      noPrice,
      considered: enrollments.length
    });
  } catch (err) {
    return handleApiError("subscriptions.generate", err);
  }
}
