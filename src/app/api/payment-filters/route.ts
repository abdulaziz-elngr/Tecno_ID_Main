import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok } from "@/lib/api";

/** Stage -> Grade -> Group tree for the payment screens (needs only payments.view). */
export async function GET() {
  try {
    const ctx = await requirePermission("payments.view");
    const branchIds = resolveBranchScope(ctx, undefined);
    const stages = await db.stage.findMany({
      where: { organizationId: ctx.organizationId, isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        grades: {
          where: { isActive: true },
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            groups: {
              where: { deletedAt: null, isActive: true, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
              orderBy: { name: "asc" },
              select: { id: true, name: true, subject: { select: { name: true } } }
            }
          }
        }
      }
    });
    return ok(stages);
  } catch (err) {
    return handleApiError("payment-filters", err);
  }
}
