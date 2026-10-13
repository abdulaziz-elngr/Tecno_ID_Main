import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { handleApiError, ok, readJson, NotFoundError, BusinessRuleError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { canCancelLesson } from "@/lib/lesson-flow";

const patchSchema = z.object({
  status: z.enum(["CANCELLED"]).optional(),
  notes: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(3).max(500).optional()
});

async function findScoped(ctx: { organizationId: string; isOrgWide: boolean; branchIds: string[] }, id: string) {
  return db.classSession.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
    }
  });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("sessions.view");
    const session = await db.classSession.findFirst({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            capacity: true,
            grade: { select: { id: true, name: true, stage: { select: { id: true, name: true } } } },
            teacher: { select: { id: true, fullName: true } },
            assistant: { select: { id: true, fullName: true } },
            subject: { select: { id: true, name: true, code: true } },
            students: {
              where: { deletedAt: null },
              select: {
                id: true,
                fullName: true,
                studentCode: true,
                photoUrl: true,
                status: true,
                parents: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
                }
              }
            }
          }
        },
        attendances: {
          where: { deletedAt: null },
          select: {
            id: true,
            studentId: true,
            type: true,
            recordedAt: true,
            notes: true,
            makeUpReason: true
          }
        }
      }
    });

    if (!session) throw new NotFoundError("Session not found.");

    // Roster = enrolled students + any make-up attendees not on the roster.
    const attendanceByStudent = new Map(session.attendances.map((a) => [a.studentId, a]));
    const roster = session.group.students.map((student) => ({
      student,
      isPrimary: true,
      attendance: attendanceByStudent.get(student.id) ?? null
    }));

    const rosterIds = new Set(session.group.students.map((s) => s.id));
    const makeUpStudentIds = session.attendances
      .filter((a) => !rosterIds.has(a.studentId))
      .map((a) => a.studentId);
    const makeUpStudents = makeUpStudentIds.length
      ? await db.student.findMany({
          where: { id: { in: makeUpStudentIds } },
          select: {
            id: true,
            fullName: true,
            studentCode: true,
            photoUrl: true,
            status: true,
            parents: {
              where: { isPrimary: true },
              take: 1,
              select: { parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
            }
          }
        })
      : [];

    return ok({
      session: {
        id: session.id,
        date: session.date,
        startMinutes: session.startMinutes,
        endMinutes: session.endMinutes,
        status: session.status,
        notes: session.notes,
        lessonNumber: session.lessonNumber,
        planId: session.planId,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        group: {
          id: session.group.id,
          name: session.group.name,
          capacity: session.group.capacity,
          grade: session.group.grade,
          stage: session.group.grade.stage,
          subject: session.group.subject,
          teacher: session.group.teacher,
          assistant: session.group.assistant
        }
      },
      roster,
      makeUpAttendees: makeUpStudents.map((s) => ({
        student: s,
        attendance: attendanceByStudent.get(s.id) ?? null
      })),
      counts: {
        present: session.attendances.filter((a) => a.type === "REGULAR").length,
        late: session.attendances.filter((a) => a.type === "LATE").length,
        makeUp: session.attendances.filter((a) => a.type === "MAKE_UP").length,
        excused: session.attendances.filter((a) => a.type === "EXCUSED").length,
        absent: session.attendances.filter((a) => a.type === "ABSENT").length,
        enrolled: session.group.students.length
      }
    });
  } catch (err) {
    return handleApiError("sessions.get", err);
  }
}

/**
 * Notes and cancellation only. Opening and closing a lesson have their own
 * endpoints (POST /api/sessions/:id/open and /close) so the lesson order and
 * "only an explicit close completes a lesson" rules can't be bypassed here.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requirePermission("sessions.update");
    const existing = await findScoped(ctx, params.id);
    if (!existing) throw new NotFoundError("Session not found.");

    const input = await readJson(request, patchSchema);

    if (input.status === "CANCELLED") {
      if (!canCancelLesson(existing.status)) {
        throw new BusinessRuleError(
          existing.status === "COMPLETED"
            ? "A closed lesson is final and cannot be cancelled."
            : "This lesson is already cancelled.",
          { code: "CANNOT_CANCEL" }
        );
      }
      // Cancelling changes the meaning of history (and, for a numbered lesson,
      // lets the plan move on), so a reason is always required.
      const recorded = await db.attendance.count({
        where: { sessionId: existing.id, deletedAt: null }
      });
      if ((recorded > 0 || existing.lessonNumber !== null) && !input.reason) {
        throw new BusinessRuleError("A reason is required to cancel this lesson.", { code: "REASON_REQUIRED" });
      }
    }

    const updated = await db.classSession.update({
      where: { id: existing.id },
      data: { status: input.status, notes: input.notes }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: input.status === "CANCELLED" ? "CANCEL_LESSON" : "UPDATE_SESSION",
      entityType: "ClassSession",
      entityId: updated.id,
      beforeValue: existing,
      afterValue: updated,
      reason: input.reason
    });

    return ok(updated);
  } catch (err) {
    return handleApiError("sessions.update", err);
  }
}
