import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, handleApiError, ok, readJson, reasonSchema } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/** Voids a deduction (never deleted): the amount returns to the treasury balance. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("deductions.void");
    const { reason } = await readJson(request, reasonSchema);

    const row = await db.treasuryDeduction.findFirst({ where: { id: params.id, organizationId: ctx.organizationId } });
    if (!row) throw new NotFoundError("Deduction not found.");
    resolveBranchScope(ctx, row.branchId);
    if (row.status === "VOIDED") throw new BusinessRuleError("This deduction is already voided.", { status: 409, code: "ALREADY_VOIDED" });

    await db.treasuryDeduction.update({
      where: { id: row.id },
      data: { status: "VOIDED", voidedAt: new Date(), voidedById: ctx.userId, voidReason: reason }
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "VOID_DEDUCTION",
      entityType: "TreasuryDeduction",
      entityId: row.id,
      beforeValue: { amount: Number(row.amount), status: row.status },
      reason
    });
    return ok({ id: row.id, status: "VOIDED" });
  } catch (err) {
    return handleApiError("deductions.void", err);
  }
}
