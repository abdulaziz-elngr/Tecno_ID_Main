import { type NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, clientIp } from "@/lib/api";
import { deletePlan } from "@/lib/lesson-plan-data";

/** Removes a plan that has no history (nothing opened, closed or attended). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("sessions.update");
    return ok(await deletePlan(ctx, params.id, clientIp(request)));
  } catch (err) {
    return handleApiError("lesson-plans.delete", err);
  }
}
