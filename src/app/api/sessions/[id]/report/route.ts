import { type NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok } from "@/lib/api";
import { buildLessonReport } from "@/lib/lesson-data";

/** Complete snapshot of one lesson: details, attendance lists, unpaid students, summary. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("sessions.view");
    return ok(await buildLessonReport(ctx, params.id));
  } catch (err) {
    return handleApiError("sessions.report", err);
  }
}
