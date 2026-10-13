import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, created, readJson, readQuery, clientIp } from "@/lib/api";
import { createPlan, listPlans } from "@/lib/lesson-plan-data";

/**
 * Monthly lesson plans (تشكيل الحصص).
 *   GET  — plans (with their numbered lessons) filtered by month / group / stage / grade / subject.
 *   POST — confirm a reviewed plan: creates the numbered, dated lessons of one group for one month.
 */

const listSchema = z.object({
  branchId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional()
});

const createSchema = z.object({
  groupId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  lessonsPerWeek: z.number().int().min(1).max(14),
  lessons: z
    .array(
      z.object({
        date: z.string().date(),
        startMinutes: z.number().int().min(0).max(1439)
      })
    )
    .min(1)
    .max(62)
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("sessions.view");
    const query = readQuery(request, listSchema);
    return ok(await listPlans(ctx, query));
  } catch (err) {
    return handleApiError("lesson-plans.list", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("sessions.create");
    const input = await readJson(request, createSchema);
    return created(await createPlan(ctx, input, clientIp(request)));
  } catch (err) {
    return handleApiError("lesson-plans.create", err);
  }
}
