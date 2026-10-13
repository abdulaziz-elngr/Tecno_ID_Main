import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson } from "@/lib/api";
import { previewPlan } from "@/lib/lesson-plan-data";

/**
 * Dry run of lesson formation: returns the real calendar dates the group's
 * weekly schedule produces for the month. Nothing is written — the
 * administrator reviews this list and then confirms with POST /api/lesson-plans.
 */
const schema = z.object({
  groupId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  lessonsPerWeek: z.number().int().min(1).max(14)
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("sessions.create");
    const input = await readJson(request, schema);
    return ok(await previewPlan(ctx, input));
  } catch (err) {
    return handleApiError("lesson-plans.preview", err);
  }
}
