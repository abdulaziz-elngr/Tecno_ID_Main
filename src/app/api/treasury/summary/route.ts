import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAnyPermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { treasurySummary } from "@/lib/treasury";

const querySchema = z.object({
  branchId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional()
});

/** Total + month balance (income - deductions) for the finance screens that show it. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAnyPermission(["payments.view", "deductions.view", "books.view"]);
    const query = readQuery(request, querySchema);
    const branchIds = resolveBranchScope(ctx, query.branchId);
    const now = new Date();
    const summary = await treasurySummary(
      { organizationId: ctx.organizationId, branchIds },
      query.year ?? now.getUTCFullYear(),
      query.month ?? now.getUTCMonth() + 1
    );
    return ok(summary);
  } catch (err) {
    return handleApiError("treasury.summary", err);
  }
}
