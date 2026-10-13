import { type NextRequest } from "next/server";
import { requireAnyPermission } from "@/lib/rbac";
import { handleApiError, ok, clientIp } from "@/lib/api";
import { LESSON_LIFECYCLE_PERMISSIONS, openLesson } from "@/lib/lesson-data";

/**
 * Opens a scheduled lesson for attendance. Enforces the lesson order of the
 * monthly plan and "one open lesson per group" (see src/lib/lesson-flow.ts).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAnyPermission(LESSON_LIFECYCLE_PERMISSIONS);
    const lesson = await openLesson(ctx, params.id, clientIp(request));
    return ok({ id: lesson.id, status: lesson.status, openedAt: lesson.openedAt });
  } catch (err) {
    return handleApiError("sessions.open", err);
  }
}
