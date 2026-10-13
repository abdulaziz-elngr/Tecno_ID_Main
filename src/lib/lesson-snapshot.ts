/**
 * Pure helpers shared by the student scan card and the lesson report
 * (Stage 2). No database access — `src/lib/lesson-data.ts` loads the facts.
 */

export type FeeState = "PAID" | "WAIVED" | "PARTIAL" | "UNPAID" | "OVERDUE" | "NOT_BILLED";

export interface FeeSubscription {
  groupId: string | null;
  status: "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" | "WAIVED";
  remaining: number;
}

/**
 * The student's fee state for one month, as it applies to ONE group.
 * Preference: the subscription billed for that group, then a general
 * (group-less) one. A subscription billed for a *different* group does not
 * decide this group's lesson. No matching subscription → NOT_BILLED.
 */
export function resolveFeeState(
  subscriptions: FeeSubscription[],
  groupId: string
): { state: FeeState; remaining: number } {
  const match =
    subscriptions.find((s) => s.groupId === groupId) ?? subscriptions.find((s) => s.groupId === null);
  if (!match) return { state: "NOT_BILLED", remaining: 0 };
  return { state: match.status, remaining: match.remaining };
}

/**
 * "Has not paid the month's fees". PAID and WAIVED are settled; everything
 * else — including a month with no subscription at all — is reported so the
 * front desk can follow up.
 */
export function isFeeUnpaid(state: FeeState): boolean {
  return state !== "PAID" && state !== "WAIVED";
}

export function scorePercent(score: number | null | undefined, maxScore: number): number | null {
  if (score === null || score === undefined || !(maxScore > 0)) return null;
  return Math.round((score / maxScore) * 1000) / 10;
}

export type AttendanceKind = "REGULAR" | "MAKE_UP" | "LATE" | "EXCUSED" | "ABSENT";

export interface LessonAttendanceCounts {
  /** REGULAR + MAKE_UP */
  present: number;
  late: number;
  absent: number;
  excused: number;
  makeUp: number;
}

export function countAttendance(types: AttendanceKind[]): LessonAttendanceCounts {
  const counts: LessonAttendanceCounts = { present: 0, late: 0, absent: 0, excused: 0, makeUp: 0 };
  for (const type of types) {
    if (type === "REGULAR") counts.present += 1;
    else if (type === "MAKE_UP") {
      counts.present += 1;
      counts.makeUp += 1;
    } else if (type === "LATE") counts.late += 1;
    else if (type === "ABSENT") counts.absent += 1;
    else if (type === "EXCUSED") counts.excused += 1;
  }
  return counts;
}

/** Share of the enrolled roster that showed up (on time or late), 0–100 with one decimal. */
export function rosterAttendanceRate(enrolled: number, attendedFromRoster: number): number {
  if (enrolled <= 0) return 0;
  return Math.round((Math.min(attendedFromRoster, enrolled) / enrolled) * 1000) / 10;
}

export type SnapshotWarningCode =
  | "NOT_ACTIVE"
  | "REPEATED_ABSENCE"
  | "DIFFERENT_GROUP"
  | "ALREADY_RECORDED"
  | "FEES_UNPAID";

export interface SnapshotWarning {
  code: SnapshotWarningCode;
  severity: "info" | "warning" | "critical";
  /** Present for REPEATED_ABSENCE so the UI can say how many. */
  count?: number;
}

export function buildSnapshotWarnings(input: {
  studentStatus: string;
  studentGroupId: string;
  lessonGroupId: string;
  alreadyRecorded: boolean;
  consecutiveAbsences: number;
  repeatedAbsenceThreshold: number;
  /** undefined when the viewer may not see fees. */
  feeState?: FeeState;
}): SnapshotWarning[] {
  const warnings: SnapshotWarning[] = [];
  if (input.studentStatus !== "ACTIVE") warnings.push({ code: "NOT_ACTIVE", severity: "critical" });
  if (input.studentGroupId !== input.lessonGroupId) warnings.push({ code: "DIFFERENT_GROUP", severity: "warning" });
  if (input.alreadyRecorded) warnings.push({ code: "ALREADY_RECORDED", severity: "info" });
  if (input.consecutiveAbsences >= input.repeatedAbsenceThreshold && input.repeatedAbsenceThreshold > 0) {
    warnings.push({ code: "REPEATED_ABSENCE", severity: "critical", count: input.consecutiveAbsences });
  }
  if (input.feeState !== undefined && isFeeUnpaid(input.feeState)) {
    warnings.push({ code: "FEES_UNPAID", severity: "warning" });
  }
  return warnings;
}
