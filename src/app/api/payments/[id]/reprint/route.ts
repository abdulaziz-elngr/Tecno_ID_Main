import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, NotFoundError, clientIp } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/**
 * Authorises and audits a receipt REPRINT. It never creates or changes a
 * payment — the receipt page renders the original transaction.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("payments.reprint");
    const payment = await db.payment.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      select: { id: true, receiptNumber: true, studentId: true }
    });
    if (!payment) throw new NotFoundError("Payment not found.");

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "REPRINT_RECEIPT",
      entityType: "Payment",
      entityId: payment.id,
      afterValue: { receiptNumber: payment.receiptNumber },
      ipAddress: clientIp(request)
    });
    return ok({ id: payment.id, receiptNumber: payment.receiptNumber });
  } catch (err) {
    return handleApiError("payments.reprint", err);
  }
}
