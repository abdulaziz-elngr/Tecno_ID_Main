import { db } from "./db";
import { BusinessRuleError, NotFoundError } from "./api";
import { writeAuditLog } from "./audit";
import { resolveBranchScope, type AuthContext } from "./rbac";
import { getAnalyticsThresholds } from "./settings";
import { countTrailingAbsences } from "./analytics";
import { canCloseLesson, canOpenLesson, lateMinutes, nextLesson, type LessonStatus } from "./lesson-flow";
import {
  buildSnapshotWarnings,
  countAttendance,
  isFeeUnpaid,
  resolveFeeState,
  rosterAttendanceRate,
  scorePercent,
  type AttendanceKind,
  type FeeState,
  type SnapshotWarning
} from "./lesson-snapshot";
import { remainingAmount } from "./billing";
import { paymentWarningFor, type PaymentWarning } from "./payment-warning";
import { DEFAULT_TIME_ZONE, sessionStartInstant } from "./tz";

/**
 * Database-backed operations of the Stage 2 lesson system. The decisions
 * themselves live in the pure modules (lesson-flow, lesson-snapshot,
 * lesson-plan); this file only loads the facts, applies the decision inside a
 * transaction where needed and writes the audit trail.
 */

/** Permissions that may open/close a lesson: the lesson managers and anyone who records attendance. */
export const LESSON_LIFECYCLE_PERMISSIONS = ["sessions.update", "attendance.create"] as const;

function canSeeFees(ctx: AuthContext): boolean {
  return ctx.permissions.has("subscriptions.view") || ctx.permissions.has("payments.view");
}

export async function getCenterTimeZone(branchId: string): Promise<string> {
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { center: { select: { timezone: true } } }
  });
  return branch?.center.timezone || DEFAULT_TIME_ZONE;
}

/** Loads a session inside the caller's organization/branch scope, or throws NotFoundError. */
export async function findScopedSession(ctx: AuthContext, id: string) {
  const session = await db.classSession.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      ...(ctx.isOrgWide ? {} : { branchId: { in: ctx.branchIds } })
    }
  });
  if (!session) throw new NotFoundError("Lesson not found.");
  return session;
}

const OPEN_DENIAL_MESSAGES = {
  NOT_SCHEDULED: "Only a scheduled lesson can be opened.",
  PREVIOUS_LESSON_NOT_FINISHED: "The previous lesson must be closed before this one can be opened.",
  ANOTHER_LESSON_OPEN: "Another lesson of this group is still open. Close it first."
} as const;

// -------------------------------------------------------------------------
// Open / close
// -------------------------------------------------------------------------

export async function openLesson(ctx: AuthContext, sessionId: string, ipAddress?: string) {
  const session = await findScopedSession(ctx, sessionId);

  const [planLessons, openElsewhere] = await Promise.all([
    session.planId
      ? db.classSession.findMany({
          where: { planId: session.planId },
          select: { id: true, lessonNumber: true, status: true }
        })
      : Promise.resolve([]),
    db.classSession.findMany({
      where: { groupId: session.groupId, status: "OPEN", id: { not: session.id } },
      select: { id: true, lessonNumber: true, status: true }
    })
  ]);

  const decision = canOpenLesson({
    lesson: { id: session.id, lessonNumber: session.lessonNumber, status: session.status },
    planLessons,
    openElsewhere
  });
  if (!decision.allowed) {
    throw new BusinessRuleError(OPEN_DENIAL_MESSAGES[decision.code], {
      code: decision.code,
      details: {
        blockingLessonNumber: decision.blockingLessonNumber ?? null,
        blockingLessonId: decision.blockingLessonId ?? null
      }
    });
  }

  // Compare-and-set so two operators pressing "Open" at once cannot both win.
  const result = await db.classSession.updateMany({
    where: { id: session.id, status: "SCHEDULED" },
    data: { status: "OPEN", openedAt: new Date(), openedById: ctx.userId }
  });
  if (result.count === 0) {
    throw new BusinessRuleError("This lesson was just changed by someone else. Reload and try again.", {
      status: 409,
      code: "CONFLICT"
    });
  }

  const updated = await db.classSession.findUniqueOrThrow({ where: { id: session.id } });
  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "OPEN_LESSON",
    entityType: "ClassSession",
    entityId: session.id,
    beforeValue: { status: session.status },
    afterValue: { status: updated.status, lessonNumber: updated.lessonNumber, openedAt: updated.openedAt },
    ipAddress
  });
  return updated;
}

export async function closeLesson(ctx: AuthContext, sessionId: string, ipAddress?: string) {
  const session = await findScopedSession(ctx, sessionId);

  const decision = canCloseLesson(session.status);
  if (!decision.allowed) {
    throw new BusinessRuleError(
      session.status === "COMPLETED"
        ? "This lesson is already closed."
        : "Only an open lesson can be closed.",
      { code: decision.code }
    );
  }

  const { closed, absentMarked } = await db.$transaction(async (tx) => {
    const [roster, recorded] = await Promise.all([
      tx.student.findMany({
        where: { groupId: session.groupId, deletedAt: null, status: "ACTIVE" },
        select: { id: true }
      }),
      // Soft-deleted rows still hold the (sessionId, studentId) unique slot, so
      // they are counted as "has a row" to avoid a duplicate-key failure.
      tx.attendance.findMany({ where: { sessionId: session.id }, select: { studentId: true } })
    ]);
    const hasRow = new Set(recorded.map((r) => r.studentId));
    const absentees = roster.filter((s) => !hasRow.has(s.id));

    if (absentees.length > 0) {
      await tx.attendance.createMany({
        data: absentees.map((s) => ({
          organizationId: ctx.organizationId,
          branchId: session.branchId,
          sessionId: session.id,
          studentId: s.id,
          groupId: session.groupId,
          type: "ABSENT" as const,
          operatorUserId: ctx.userId
        })),
        skipDuplicates: true
      });
    }

    const result = await tx.classSession.updateMany({
      where: { id: session.id, status: "OPEN" },
      data: { status: "COMPLETED", closedAt: new Date(), closedById: ctx.userId }
    });
    if (result.count === 0) {
      throw new BusinessRuleError("This lesson was just changed by someone else. Reload and try again.", {
        status: 409,
        code: "CONFLICT"
      });
    }
    const closed = await tx.classSession.findUniqueOrThrow({ where: { id: session.id } });
    return { closed, absentMarked: absentees.length };
  }, { timeout: 30000, maxWait: 10000 });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "CLOSE_LESSON",
    entityType: "ClassSession",
    entityId: session.id,
    beforeValue: { status: session.status },
    afterValue: { status: closed.status, lessonNumber: closed.lessonNumber, closedAt: closed.closedAt, absentMarked },
    ipAddress
  });

  const next = closed.planId
    ? nextLesson(
        await db.classSession.findMany({
          where: { planId: closed.planId },
          select: { id: true, lessonNumber: true, status: true, date: true, startMinutes: true, endMinutes: true }
        })
      )
    : null;

  return { lesson: closed, absentMarked, nextLesson: next };
}

// -------------------------------------------------------------------------
// Student snapshot (shown immediately after a scan / manual selection)
// -------------------------------------------------------------------------

export interface StudentLessonSnapshot {
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    status: string;
    group: { id: string; name: string } | null;
  };
  lesson: { id: string; lessonNumber: number | null };
  /** Attendance already recorded for THIS lesson, if any. */
  thisLesson: { type: AttendanceKind; recordedAt: Date } | null;
  lastAttendance: {
    type: AttendanceKind;
    date: Date;
    lessonNumber: number | null;
    groupName: string;
  } | null;
  recitation: {
    date: Date;
    status: string;
    score: number | null;
    maxScore: number;
    percent: number | null;
    content: string;
  } | null;
  exam: { name: string; date: Date; score: number; maxScore: number; percent: number | null } | null;
  fees: { state: FeeState; remaining: number; periodYear: number; periodMonth: number } | null;
  /** ALL unpaid subscription months (not only this lesson's month). Always present so attendance staff see it; null when nothing is owed. */
  paymentWarning: PaymentWarning | null;
  /** Sections the viewer's role is not allowed to see (so the UI can say "restricted", not "none"). */
  hidden: { recitation: boolean; exam: boolean; fees: boolean };
  warnings: SnapshotWarning[];
}

export async function buildStudentSnapshot(
  ctx: AuthContext,
  sessionId: string,
  studentId: string
): Promise<StudentLessonSnapshot> {
  const session = await findScopedSession(ctx, sessionId);
  const student = await db.student.findFirst({
    where: { id: studentId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      studentCode: true,
      status: true,
      branchId: true,
      groupId: true,
      group: { select: { id: true, name: true } }
    }
  });
  if (!student) throw new NotFoundError("Student not found.");
  resolveBranchScope(ctx, student.branchId);

  return snapshotFor(ctx, session, student);
}

/** Same as buildStudentSnapshot but reuses already-loaded (and already scope-checked) rows — used by the scan route. */
export async function snapshotFor(
  ctx: AuthContext,
  session: { id: string; groupId: string; date: Date; lessonNumber: number | null },
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    status: string;
    groupId: string;
    group: { id: string; name: string } | null;
  }
): Promise<StudentLessonSnapshot> {
  const canRecitation = ctx.permissions.has("recitation.view");
  const canExam = ctx.permissions.has("exams.view");
  const canFees = canSeeFees(ctx);

  const lessonGroup = await db.group.findUnique({
    where: { id: session.groupId },
    select: { subjectId: true }
  });
  const subjectId = lessonGroup?.subjectId ?? null;
  const periodYear = session.date.getUTCFullYear();
  const periodMonth = session.date.getUTCMonth() + 1;

  const [thisLesson, history, recitation, exam, subscriptions, thresholds, paymentWarning] = await Promise.all([
    db.attendance.findFirst({
      where: { sessionId: session.id, studentId: student.id, deletedAt: null },
      select: { type: true, recordedAt: true }
    }),
    db.attendance.findMany({
      where: {
        studentId: student.id,
        deletedAt: null,
        sessionId: { not: session.id },
        session: { date: { lte: session.date } }
      },
      orderBy: [{ session: { date: "desc" } }, { recordedAt: "desc" }],
      take: 10,
      select: {
        type: true,
        session: { select: { date: true, lessonNumber: true, group: { select: { name: true } } } }
      }
    }),
    canRecitation
      ? db.recitation.findFirst({
          where: {
            studentId: student.id,
            organizationId: ctx.organizationId,
            ...(subjectId ? { OR: [{ subjectId }, { subjectId: null }] } : {})
          },
          orderBy: { date: "desc" },
          select: { date: true, status: true, score: true, maxScore: true, content: true }
        })
      : Promise.resolve(null),
    canExam
      ? db.examResult.findFirst({
          where: {
            studentId: student.id,
            isAbsent: false,
            score: { not: null },
            exam: { deletedAt: null, ...(subjectId ? { subjectId } : {}) }
          },
          orderBy: { exam: { date: "desc" } },
          select: { score: true, exam: { select: { name: true, date: true, maxScore: true } } }
        })
      : Promise.resolve(null),
    canFees
      ? db.subscription.findMany({
          where: { studentId: student.id, periodYear, periodMonth },
          select: { groupId: true, status: true, amount: true, discount: true, paidAmount: true }
        })
      : Promise.resolve([]),
    getAnalyticsThresholds(ctx.organizationId),
    paymentWarningFor(ctx.organizationId, student.id).catch((err) => {
      console.error("[snapshot] payment warning failed", err);
      return null;
    })
  ]);

  const lastRow = history[0] ?? null;

  // History is newest-first; the streak helper wants chronological order.
  const chronological = [...history].reverse().map((row) => row.type !== "ABSENT");
  const consecutiveAbsences = countTrailingAbsences(chronological);

  const fee = canFees
    ? resolveFeeState(
        subscriptions.map((s) => ({
          groupId: s.groupId,
          status: s.status,
          remaining: remainingAmount(Number(s.amount), Number(s.discount), Number(s.paidAmount))
        })),
        session.groupId
      )
    : null;

  const recitationMax = recitation ? Number(recitation.maxScore) : 0;
  const recitationScore = recitation?.score === null || recitation?.score === undefined ? null : Number(recitation.score);

  return {
    student: {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      status: student.status,
      group: student.group
    },
    lesson: { id: session.id, lessonNumber: session.lessonNumber },
    thisLesson: thisLesson ? { type: thisLesson.type, recordedAt: thisLesson.recordedAt } : null,
    lastAttendance: lastRow
      ? {
          type: lastRow.type,
          date: lastRow.session.date,
          lessonNumber: lastRow.session.lessonNumber,
          groupName: lastRow.session.group.name
        }
      : null,
    recitation: recitation
      ? {
          date: recitation.date,
          status: recitation.status,
          score: recitationScore,
          maxScore: recitationMax,
          percent: scorePercent(recitationScore, recitationMax),
          content: recitation.content
        }
      : null,
    exam:
      exam && exam.score !== null
        ? {
            name: exam.exam.name,
            date: exam.exam.date,
            score: Number(exam.score),
            maxScore: Number(exam.exam.maxScore),
            percent: scorePercent(Number(exam.score), Number(exam.exam.maxScore))
          }
        : null,
    fees: fee ? { ...fee, periodYear, periodMonth } : null,
    paymentWarning,
    hidden: { recitation: !canRecitation, exam: !canExam, fees: !canFees },
    warnings: buildSnapshotWarnings({
      studentStatus: student.status,
      studentGroupId: student.groupId,
      lessonGroupId: session.groupId,
      alreadyRecorded: Boolean(thisLesson),
      consecutiveAbsences,
      repeatedAbsenceThreshold: thresholds.repeatedAbsenceCount,
      feeState: fee?.state
    })
  };
}

// -------------------------------------------------------------------------
// Lesson report (Lessons page detail + printable report)
// -------------------------------------------------------------------------

export interface LessonReportStudent {
  studentId: string;
  fullName: string;
  studentCode: string;
  type: AttendanceKind | null;
  recordedAt: Date | null;
  lateMinutes: number | null;
  /** Other-group (make-up) attendee. */
  isMakeUp: boolean;
  /** Primary parent, for the WhatsApp follow-up of absent / late students. */
  parent: { fullName: string; phone: string; whatsappNumber: string | null } | null;
}

export interface LessonReport {
  lesson: {
    id: string;
    lessonNumber: number | null;
    totalLessons: number | null;
    date: Date;
    dayOfWeek: number;
    startMinutes: number;
    endMinutes: number;
    status: LessonStatus;
    openedAt: Date | null;
    closedAt: Date | null;
    planId: string | null;
    year: number;
    month: number;
  };
  group: { id: string; name: string; capacity: number };
  stage: { id: string; name: string };
  grade: { id: string; name: string };
  subject: { id: string; name: string; code: string | null } | null;
  teacher: { id: string; fullName: string } | null;
  assistant: { id: string; fullName: string } | null;
  center: { name: string; address: string | null; phone: string | null; logoUrl: string | null };
  counts: {
    enrolled: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    makeUp: number;
    /** Roster students with no attendance row yet (only while the lesson is not closed). */
    pending: number;
    unpaid: number | null;
    attendanceRate: number;
  };
  present: LessonReportStudent[];
  late: LessonReportStudent[];
  absent: LessonReportStudent[];
  excused: LessonReportStudent[];
  pending: LessonReportStudent[];
  unpaid: (LessonReportStudent & { feeState: FeeState; remaining: number })[] | null;
  unpaidHidden: boolean;
  navigation: {
    previous: { id: string; lessonNumber: number | null } | null;
    next: { id: string; lessonNumber: number | null } | null;
  };
}

export async function buildLessonReport(ctx: AuthContext, sessionId: string): Promise<LessonReport> {
  const base = await findScopedSession(ctx, sessionId);
  const session = await db.classSession.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      group: {
        include: {
          grade: { include: { stage: true } },
          subject: true,
          teacher: true,
          assistant: true,
          branch: { include: { center: true } }
        }
      }
    }
  });

  const sessionTeacher = session.teacherId
    ? await db.teacher.findUnique({ where: { id: session.teacherId }, select: { id: true, fullName: true } })
    : null;
  const sessionAssistant = session.assistantId
    ? await db.teacher.findUnique({ where: { id: session.assistantId }, select: { id: true, fullName: true } })
    : null;

  const timeZone = session.group.branch.center.timezone || DEFAULT_TIME_ZONE;
  const startInstant = sessionStartInstant(session.date, session.startMinutes, timeZone);
  const year = session.date.getUTCFullYear();
  const month = session.date.getUTCMonth() + 1;

  const [roster, attendance, planLessons] = await Promise.all([
    db.student.findMany({
      where: { groupId: session.groupId, deletedAt: null, status: "ACTIVE" },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, studentCode: true }
    }),
    db.attendance.findMany({
      where: { sessionId: session.id, deletedAt: null },
      select: {
        studentId: true,
        type: true,
        recordedAt: true,
        student: { select: { fullName: true, studentCode: true } }
      }
    }),
    session.planId
      ? db.classSession.findMany({
          where: { planId: session.planId },
          orderBy: { lessonNumber: "asc" },
          select: { id: true, lessonNumber: true }
        })
      : Promise.resolve([] as { id: string; lessonNumber: number | null }[])
  ]);

  const rosterIds = new Set(roster.map((s) => s.id));
  const rowByStudent = new Map(attendance.map((a) => [a.studentId, a]));

  const involvedIds = [...new Set([...roster.map((s) => s.id), ...attendance.map((a) => a.studentId)])];
  const primaryParents = involvedIds.length
    ? await db.studentParent.findMany({
        where: { studentId: { in: involvedIds }, isPrimary: true },
        select: { studentId: true, parent: { select: { fullName: true, phone: true, whatsappNumber: true } } }
      })
    : [];
  const parentByStudent = new Map(primaryParents.map((p) => [p.studentId, p.parent]));

  const toEntry = (
    studentId: string,
    fullName: string,
    studentCode: string,
    row: (typeof attendance)[number] | undefined
  ): LessonReportStudent => ({
    studentId,
    fullName,
    studentCode,
    type: row?.type ?? null,
    recordedAt: row?.recordedAt ?? null,
    lateMinutes: row?.type === "LATE" ? lateMinutes(startInstant, row.recordedAt) : null,
    isMakeUp: row ? !rosterIds.has(studentId) : false,
    parent: parentByStudent.get(studentId) ?? null
  });

  const present: LessonReportStudent[] = [];
  const late: LessonReportStudent[] = [];
  const absent: LessonReportStudent[] = [];
  const excused: LessonReportStudent[] = [];
  const pending: LessonReportStudent[] = [];

  // Everyone with a row (roster students AND make-up attendees from other groups).
  for (const row of attendance) {
    const entry = toEntry(row.studentId, row.student.fullName, row.student.studentCode, row);
    if (row.type === "REGULAR" || row.type === "MAKE_UP") present.push(entry);
    else if (row.type === "LATE") late.push(entry);
    else if (row.type === "ABSENT") absent.push(entry);
    else if (row.type === "EXCUSED") excused.push(entry);
  }
  // Roster students without a row: ABSENT once the lesson is closed, otherwise still pending.
  for (const student of roster) {
    if (rowByStudent.has(student.id)) continue;
    const entry = toEntry(student.id, student.fullName, student.studentCode, undefined);
    if (session.status === "COMPLETED") absent.push({ ...entry, type: "ABSENT" });
    else pending.push(entry);
  }

  const byTime = (a: LessonReportStudent, b: LessonReportStudent) =>
    (a.recordedAt?.getTime() ?? 0) - (b.recordedAt?.getTime() ?? 0) || a.fullName.localeCompare(b.fullName);
  present.sort(byTime);
  late.sort(byTime);
  absent.sort((a, b) => a.fullName.localeCompare(b.fullName));
  excused.sort((a, b) => a.fullName.localeCompare(b.fullName));
  pending.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const counts = countAttendance(
    [...present, ...late, ...absent, ...excused].map((e) => e.type as AttendanceKind)
  );
  const attendedFromRoster = [...present, ...late].filter((e) => rosterIds.has(e.studentId)).length;

  // Fees — roster students only, and only for roles allowed to see finance.
  let unpaid: LessonReport["unpaid"] = null;
  const unpaidHidden = !canSeeFees(ctx);
  if (!unpaidHidden && roster.length > 0) {
    const subscriptions = await db.subscription.findMany({
      where: { studentId: { in: roster.map((s) => s.id) }, periodYear: year, periodMonth: month },
      select: { studentId: true, groupId: true, status: true, amount: true, discount: true, paidAmount: true }
    });
    const byStudent = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const list = byStudent.get(sub.studentId) ?? [];
      list.push(sub);
      byStudent.set(sub.studentId, list);
    }
    unpaid = [];
    for (const student of roster) {
      const fee = resolveFeeState(
        (byStudent.get(student.id) ?? []).map((s) => ({
          groupId: s.groupId,
          status: s.status,
          remaining: remainingAmount(Number(s.amount), Number(s.discount), Number(s.paidAmount))
        })),
        session.groupId
      );
      if (isFeeUnpaid(fee.state)) {
        unpaid.push({
          ...toEntry(student.id, student.fullName, student.studentCode, rowByStudent.get(student.id)),
          feeState: fee.state,
          remaining: fee.remaining
        });
      }
    }
  }

  const index = planLessons.findIndex((l) => l.id === session.id);
  const center = session.group.branch.center;

  return {
    lesson: {
      id: session.id,
      lessonNumber: session.lessonNumber,
      totalLessons: planLessons.length > 0 ? planLessons.length : null,
      date: session.date,
      dayOfWeek: session.date.getUTCDay(),
      startMinutes: session.startMinutes,
      endMinutes: session.endMinutes,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      planId: session.planId,
      year,
      month
    },
    group: { id: session.group.id, name: session.group.name, capacity: session.group.capacity },
    stage: { id: session.group.grade.stage.id, name: session.group.grade.stage.name },
    grade: { id: session.group.grade.id, name: session.group.grade.name },
    subject: session.group.subject
      ? { id: session.group.subject.id, name: session.group.subject.name, code: session.group.subject.code }
      : null,
    teacher: sessionTeacher ?? (session.group.teacher ? { id: session.group.teacher.id, fullName: session.group.teacher.fullName } : null),
    assistant:
      sessionAssistant ??
      (session.group.assistant ? { id: session.group.assistant.id, fullName: session.group.assistant.fullName } : null),
    center: { name: center.name, address: center.address, phone: center.phone, logoUrl: center.logoUrl },
    counts: {
      enrolled: roster.length,
      present: counts.present,
      late: counts.late,
      absent: counts.absent,
      excused: counts.excused,
      makeUp: counts.makeUp,
      pending: pending.length,
      unpaid: unpaid ? unpaid.length : null,
      attendanceRate: rosterAttendanceRate(roster.length, attendedFromRoster)
    },
    present,
    late,
    absent,
    excused,
    pending,
    unpaid,
    unpaidHidden,
    navigation: {
      previous: index > 0 ? (planLessons[index - 1] ?? null) : null,
      next: index >= 0 && index < planLessons.length - 1 ? (planLessons[index + 1] ?? null) : null
    }
  };
}
