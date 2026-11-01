import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/rbac";
import { handleApiError, created, readJson, clientIp } from "@/lib/api";
import { ADD_AFTER_CLOSE_TYPES, LESSON_LIFECYCLE_PERMISSIONS, addStudentAfterClose } from "@/lib/lesson-data";

const schema = z.object({
  studentId: z.string().uuid(),
  type: z.enum(ADD_AFTER_CLOSE_TYPES).default("REGULAR"),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(500).optional(),
  lateMinutes: z.number().int().min(1).max(600).optional(),
  makeUpReason: z.string().trim().max(300).optional()
});

/**
 * Adds a student to a lesson that is already CLOSED (forgotten at the door, enrolled
 * after the lesson, or a make-up guest). The lesson is not reopened; the change is
 * recorded with a mandatory reason in the attendance adjustment history and audit log.
 * Same permission as opening / closing a lesson.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireAnyPermission(LESSON_LIFECYCLE_PERMISSIONS);
    const input = await readJson(request, schema);
    const result = await addStudentAfterClose(ctx, params.id, input, clientIp(request));
    return created({
      id: result.attendance.id,
      type: result.attendance.type,
      student: result.student
    });
  } catch (err) {
    return handleApiError("sessions.addStudent", err);
  }
}
