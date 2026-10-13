import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { handleApiError, ok, readJson, clientIp, userAgent, BusinessRuleError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { evaluateAttendance, normalizeScanInput, type AttendanceFacts } from "@/lib/attendance";
import { minutesAfterStart } from "@/lib/sessions";
import { getCenterTimeZone, snapshotFor } from "@/lib/lesson-data";
import { getLateThresholdMinutes, getMakeUpRules } from "@/lib/settings";
import { writeAuditLog } from "@/lib/audit";
import { dispatchEvent } from "@/lib/notifications";

/**
 * POST /api/attendance/scan — the barcode/QR attendance flow (spec §9, §10).
 *
 *   Scan -> find student -> validate student -> validate session/group ->
 *   duplicate check -> own-group vs cross-group decision -> record -> respond.
 *
 * Cross-group scans NEVER auto-record. The first call comes back with
 * status "NEEDS_CONFIRMATION" (spec §10: "Student belongs to another
 * group", with the student's current group and the session's group
 * for the UI to render). Only when the operator clicks "Accept make-up
 * attendance" does the frontend resend the same scan with
 * `confirmMakeUp: true`, which is what actually writes the row —
 * `mode: "PREVIEW"` never writes anything, `confirmMakeUp` always
 * implies a write attempt.
 */

const scanSchema = z.object({
  code: z.string().trim().min(3).max(100),
  sessionId: z.string().uuid(),
  /** Set to true only after the operator clicked "Accept make-up attendance". */
  confirmMakeUp: z.boolean().optional(),
  makeUpReason: z.string().trim().max(300).optional(),
  originSessionId: z.string().uuid().optional(),
  overrideCapacity: z.boolean().optional(),
  deviceInfo: z.string().trim().max(200).optional()
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("attendance.create");

    // Rate limit per operator: a scanner gun can fire fast, but not
    // thousands per minute — that would be a script, not a queue of kids.
    const limit = checkRateLimit(`scan:${ctx.userId}`, 240, 60 * 1000);
    if (!limit.allowed) {
      throw new BusinessRuleError("Too many scans. Please slow down.", {
        status: 429,
        code: "RATE_LIMITED"
      });
    }

    const input = await readJson(request, scanSchema);
    const code = normalizeScanInput(input.code);

    const session = await db.classSession.findFirst({
      where: {
        id: input.sessionId,
        organizationId: ctx.organizationId,
        ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            capacity: true,
            gradeId: true,
            grade: { select: { name: true, stage: { select: { name: true } } } }
          }
        }
      }
    });
    if (!session) {
      return ok(
        {
          status: "REJECTED",
          code: "SESSION_NOT_FOUND",
          message: "Session not found or outside your branch scope."
        },
        { status: 404 }
      );
    }
    resolveBranchScope(ctx, session.branchId);

    const student = await db.student.findFirst({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        OR: [{ qrCode: code }, { studentCode: code }]
      },
      select: {
        id: true,
        fullName: true,
        studentCode: true,
        photoUrl: true,
        status: true,
        branchId: true,
        groupId: true,
        group: { select: { id: true, name: true, grade: { select: { name: true, stage: { select: { name: true } } } } } }
      }
    });

    if (!student) {
      return ok(
        { status: "REJECTED", code: "STUDENT_NOT_FOUND", message: "No student matches this code." },
        { status: 404 }
      );
    }

    // A student from another branch cannot be scanned into this branch's
    // session by an operator who has no access to that student.
    resolveBranchScope(ctx, student.branchId);

    const [existing, attendeeCount] = await Promise.all([
      db.attendance.findFirst({
        where: { sessionId: session.id, studentId: student.id, deletedAt: null },
        select: { id: true, type: true, recordedAt: true }
      }),
      db.attendance.count({ where: { sessionId: session.id, deletedAt: null } })
    ]);
    const monthStart = new Date(Date.UTC(session.date.getUTCFullYear(), session.date.getUTCMonth(), 1));

    const makeUpsThisMonth = await db.attendance.count({
      where: {
        studentId: student.id,
        type: "MAKE_UP",
        deletedAt: null,
        recordedAt: { gte: monthStart }
      }
    });

    let daysSinceOrigin: number | null = null;
    if (input.originSessionId) {
      const origin = await db.classSession.findFirst({
        where: { id: input.originSessionId, organizationId: ctx.organizationId },
        select: { date: true }
      });
      if (origin) {
        daysSinceOrigin = Math.round((session.date.getTime() - origin.date.getTime()) / 86400000);
      }
    }

    const [rules, lateThreshold] = await Promise.all([
      getMakeUpRules(ctx.organizationId),
      getLateThresholdMinutes(ctx.organizationId)
    ]);

    const canOverrideCapacity = ctx.permissions.has("academic.groups.manage") && Boolean(input.overrideCapacity);

    const facts: AttendanceFacts = {
      studentGroupId: student.groupId,
      sessionGroupId: session.group.id,
      groupCapacity: session.group.capacity,
      currentAttendeeCount: attendeeCount,
      alreadyRecorded: Boolean(existing),
      makeUpsThisMonth,
      daysSinceOriginSession: daysSinceOrigin,
      confirmMakeUp: Boolean(input.confirmMakeUp),
      overrideCapacity: canOverrideCapacity,
      minutesAfterStart: minutesAfterStart(
        session.date,
        session.startMinutes,
        new Date(),
        await getCenterTimeZone(session.branchId)
      ),
      sessionStatus: session.status,
      requiresExplicitOpen: session.planId !== null,
      studentStatus: student.status,
      lateThresholdMinutes: lateThreshold
    };

    const decision = evaluateAttendance(facts, rules);

    const studentCard = {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      photoUrl: student.photoUrl,
      currentGroup: student.group
    };
    // Stage 2: everything the operator needs to know about this student,
    // returned with EVERY outcome so it is on screen the moment of the scan.
    const snapshot = await snapshotFor(ctx, session, student);
    const sessionCard = {
      id: session.id,
      lessonNumber: session.lessonNumber,
      groupId: session.group.id,
      groupName: session.group.name,
      gradeName: session.group.grade.name,
      stageName: session.group.grade.stage.name
    };

    // Spec §10 — cross-group scan: never write, always ask.
    if (decision.needsConfirmation) {
      return ok({
        status: "NEEDS_CONFIRMATION",
        code: decision.code,
        message: decision.message,
        student: studentCard,
        session: sessionCard,
        currentGroup: student.group,
        selectedGroup: { id: session.group.id, name: session.group.name },
        snapshot
      });
    }

    if (!decision.allowed) {
      return ok({
        status: "REJECTED",
        code: decision.code,
        message: decision.message,
        student: studentCard,
        session: sessionCard,
        existingAttendance: existing,
        snapshot
      });
    }

    const attendance = await db.attendance.create({
      data: {
        organizationId: ctx.organizationId,
        branchId: session.branchId,
        sessionId: session.id,
        studentId: student.id,
        groupId: session.group.id,
        type: decision.type!,
        operatorUserId: ctx.userId,
        deviceInfo: input.deviceInfo ?? userAgent(request)?.slice(0, 200),
        makeUpReason: decision.isMakeUp ? input.makeUpReason : undefined,
        makeUpApprovedBy: decision.isMakeUp ? ctx.userId : undefined,
        originGroupId: decision.isMakeUp ? student.groupId : undefined,
        originSessionId: decision.isMakeUp ? input.originSessionId : undefined
      }
    });

    // Legacy (unnumbered) sessions are still opened by the first scan. Lessons
    // of a monthly plan never get here while SCHEDULED: evaluateAttendance()
    // refuses them with LESSON_NOT_OPEN until an operator opens the lesson.
    if (session.status === "SCHEDULED" && session.planId === null) {
      await db.classSession.update({
        where: { id: session.id },
        data: { status: "OPEN", openedAt: new Date() }
      });
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: decision.isMakeUp ? "RECORD_MAKEUP_ATTENDANCE" : "RECORD_ATTENDANCE",
      entityType: "Attendance",
      entityId: attendance.id,
      afterValue: attendance,
      reason: input.makeUpReason,
      ipAddress: clientIp(request)
    });

    if (decision.type === "LATE") {
      // Awaited (serverless may freeze after the response); dispatchEvent never throws.
      await dispatchEvent({
        organizationId: ctx.organizationId,
        event: "STUDENT_LATE",
        studentId: student.id,
        title: "Late arrival",
        actorUserId: ctx.userId,
        variables: {
          student_name: student.fullName,
          group_name: session.group.name,
          date: session.date.toISOString().slice(0, 10),
          late_minutes: Math.max(0, facts.minutesAfterStart)
        }
      }).catch((err) => console.error("[attendance.scan] notify failed", err));
    }

    return ok({
      status: "ACCEPTED",
      code: decision.code,
      message: decision.message,
      attendance: {
        id: attendance.id,
        type: attendance.type,
        recordedAt: attendance.recordedAt
      },
      student: studentCard,
      session: sessionCard,
      snapshot: { ...snapshot, thisLesson: { type: attendance.type, recordedAt: attendance.recordedAt } }
    });
  } catch (err) {
    return handleApiError("attendance.scan", err);
  }
}
