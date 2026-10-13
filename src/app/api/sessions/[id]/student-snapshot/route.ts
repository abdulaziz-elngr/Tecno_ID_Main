import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readQuery } from "@/lib/api";
import { buildStudentSnapshot } from "@/lib/lesson-data";

const querySchema = z.object({ studentId: z.string().uuid() });

/**
 * Info card shown right after a student is selected (manual mode) — last
 * attendance, latest recitation / exam and the lesson-month fee state. Each
 * section is only included when the caller's role may see that data.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("attendance.view");
    const { studentId } = readQuery(request, querySchema);
    return ok(await buildStudentSnapshot(ctx, params.id, studentId));
  } catch (err) {
    return handleApiError("sessions.student-snapshot", err);
  }
}
