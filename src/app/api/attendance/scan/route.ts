import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, resolveBranchScope } from "@/lib/rbac";
import { groupIdFilter, resolveOwnGroupIds } from "@/lib/group-access";
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

    // Latency matters here (a queue of kids at the door): every independent query
    // below runs in parallel instead of one after the other.
    const studentPromise = db.student.findFirst({
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
        gradeId: true,
        enrollmentDate: true,
        group: { select: { id: true, name: true, grade: { select: { name: true, stage: { select: { name: true } } } } } }
      }
    });
    const sessionPromise = (async () => {
      const ownGroupIds = await resolveOwnGroupIds(ctx);
      return db.classSession.findFirst({
        where: {
          id: input.sessionId,
          organizationId: ctx.organizationId,
          ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } }),
          ...groupIdFilter(ownGroupIds)
        },
        include: {
          group: {
            select: {
              id: true,
              name: true,
              capacity: true,
              gradeId: true,
              subjectId: true,
              grade: { select: { name: true, stage: { select: { name: true } } } }
            }
          }
        }
      });
    })();
    // Avoid an unhandled rejection if the other promise throws first.
    studentPromise.catch(() => {});
    sessionPromise.catch(() => {});
    const [session, student] = await Promise.all([sessionPromise, studentPromise]);

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

    if (!student) {
      return ok(
        { status: "REJECTED", code: "STUDENT_NOT_FOUND", message: "No student matches this code." },
        { status: 404 }
      );
    }

    // A student from another branch cannot be scanned into this branch's
    // session by an operator who has no access to that student.
    resolveBranchScope(ctx, student.branchId);

    const monthStart = new Date(Date.UTC(session.date.getUTCFullYear(), session.date.getUTCMonth(), 1));

    const [existing, attendeeCount, makeUpsThisMonth, origin, rules, lateThreshold, timeZone, snapshot] =
      await Promise.all([
        db.attendance.findFirst({
          where: { sessionId: session.id, studentId: student.id, deletedAt: null },
          select: { id: true, type: true, recordedAt: true }
        }),
        db.attendance.count({ where: { sessionId: session.id, deletedAt: null } }),
        db.attendance.count({
          where: {
            studentId: student.id,
            type: "MAKE_UP",
            deletedAt: null,
            recordedAt: { gte: monthStart }
          }
        }),
        input.originSessionId
          ? db.classSession.findFirst({
              where: { id: input.originSessionId, organizationId: ctx.organizationId },
              select: { date: true }
            })
          : Promise.resolve(null),
        getMakeUpRules(ctx.organizationId),
        getLateThresholdMinutes(ctx.organizationId),
        getCenterTimeZone(session.branchId),
        // Stage 2: everything the operator needs to know about this student,
        // returned with EVERY outcome so it is on screen the moment of the scan.
        snapshotFor(ctx, { ...session, group: { subjectId: session.group.subjectId } }, student)
      ]);

    const daysSinceOrigin: number | null = origin
      ? Math.round((session.date.getTime() - origin.date.getTime()) / 86400000)
      : null;

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
      minutesAfterStart: minutesAfterStart(session.date, session.startMinutes, new Date(), timeZone),
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
    // The session update and the audit row are independent: run them together.
    const openLegacySession =
      session.status === "SCHEDULED" && session.planId === null
        ? db.classSession.update({
            where: { id: session.id },
            data: { status: "OPEN", openedAt: new Date() }
          })
        : Promise.resolve(null);

    const auditPromise = writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: decision.isMakeUp ? "RECORD_MAKEUP_ATTENDANCE" : "RECORD_ATTENDANCE",
      entityType: "Attendance",
      entityId: attendance.id,
      afterValue: attendance,
      reason: input.makeUpReason,
      ipAddress: clientIp(request)
    });
    await Promise.all([openLegacySession, auditPromise]);

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
