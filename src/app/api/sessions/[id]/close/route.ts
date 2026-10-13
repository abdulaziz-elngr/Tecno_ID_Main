import { type NextRequest } from "next/server";
import { requireAnyPermission } from "@/lib/rbac";
import { handleApiError, ok, clientIp } from "@/lib/api";
import { LESSON_LIFECYCLE_PERMISSIONS, closeLesson } from "@/lib/lesson-data";

/**
 * Explicitly closes an OPEN lesson: roster students without a record are saved
 * as ABSENT, the lesson becomes COMPLETED (final) and the next lesson of the
 * plan is returned. A lesson is never closed by the clock — only by this call.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAnyPermission(LESSON_LIFECYCLE_PERMISSIONS);
    const result = await closeLesson(ctx, params.id, clientIp(request));
    return ok({
      id: result.lesson.id,
      status: result.lesson.status,
      closedAt: result.lesson.closedAt,
      absentMarked: result.absentMarked,
      nextLesson: result.nextLesson
        ? {
            id: result.nextLesson.id,
            lessonNumber: result.nextLesson.lessonNumber,
            date: result.nextLesson.date,
            startMinutes: result.nextLesson.startMinutes,
            endMinutes: result.nextLesson.endMinutes
          }
        : null
    });
  } catch (err) {
    return handleApiError("sessions.close", err);
  }
}
