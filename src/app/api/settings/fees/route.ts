import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { handleApiError, ok, created, readJson, BusinessRuleError } from "@/lib/api";

const SCOPE = "settings.fees";

const createSchema = z.object({
  stageId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  effectiveFrom: z.string().datetime().optional(),
  notes: z.string().trim().max(500).optional()
});

/**
 * Settings -> Subscription Fees (spec §17). Fees are configured per
 * Stage and are never hard-coded. Creating a new fee for a stage
 * automatically deactivates the previous active fee for that stage so
 * `currentStageFee()` always resolves a single unambiguous amount.
 */
export async function GET() {
  try {
    const ctx = await requirePermission("academic.fees.manage");
    const fees = await db.subscriptionFee.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ stage: { order: "asc" } }, { effectiveFrom: "desc" }],
      include: { stage: { select: { id: true, name: true } } }
    });
    return ok(fees);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("academic.fees.manage");
    const input = await readJson(request, createSchema);

    const stage = await db.stage.findFirst({ where: { id: input.stageId, organizationId: ctx.organizationId } });
    if (!stage) throw new BusinessRuleError("Invalid stage.", { status: 400 });

    const fee = await db.$transaction(async (tx) => {
      await tx.subscriptionFee.updateMany({
        where: { stageId: input.stageId, isActive: true },
        data: { isActive: false }
      });
      return tx.subscriptionFee.create({
        data: {
          organizationId: ctx.organizationId,
          stageId: input.stageId,
          amount: input.amount,
          effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
          notes: input.notes,
          createdById: ctx.userId
        }
      });
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "CREATE_SUBSCRIPTION_FEE",
      entityType: "SubscriptionFee",
      entityId: fee.id,
      afterValue: fee
    });

    return created(fee);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
