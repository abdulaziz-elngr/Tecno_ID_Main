import { type NextRequest } from "next/server";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { loadRoster } from "@/lib/payment-roster";
import { recordsQuerySchema } from "@/lib/payment-schemas";

/** Paid / not-paid split for a month. Read-only; data comes from the same ledger the payment API enforces. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("payments.view");
    const query = readQuery(request, recordsQuerySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);
    const roster = await loadRoster({
      organizationId: ctx.organizationId,
      branchIds,
      stageId: query.stageId,
      gradeId: query.gradeId,
      groupId: query.groupId,
      year: query.year,
      month: query.month,
      q: query.q,
      exact: query.exact === "1"
    });
    return ok(roster);
  } catch (err) {
    return handleApiError("payment-records.list", err);
  }
}
