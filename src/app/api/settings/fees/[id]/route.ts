import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { handleApiError, ok, readJson, NotFoundError } from "@/lib/api";

const SCOPE = "settings.fees.detail";

const updateSchema = z.object({
  amount: z.number().positive().max(1_000_000).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).optional()
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("academic.fees.manage");
    const fee = await db.subscriptionFee.findFirst({
      where: { id: params.id, organizationId: ctx.organizationId }
    });
    if (!fee) throw new NotFoundError("Fee not found.");

    const input = await readJson(request, updateSchema);
    const updated = await db.subscriptionFee.update({ where: { id: fee.id }, data: input });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_SUBSCRIPTION_FEE",
      entityType: "SubscriptionFee",
      entityId: fee.id,
      beforeValue: fee,
      afterValue: updated
    });

    return ok(updated);
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
