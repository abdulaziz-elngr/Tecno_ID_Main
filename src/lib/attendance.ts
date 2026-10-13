/**
 * Attendance business rules (spec §9–§13).
 *
 * The decision logic is a PURE function so it can be unit-tested
 * exhaustively without a database. `src/app/api/attendance/scan/route.ts`
 * loads the facts from Postgres, hands them to `evaluateAttendance()`,
 * and only writes a row when the decision is `allowed`.
 *
 * Rules enforced here:
 *   Rule 1  A student cannot have duplicate attendance for one session.
 *   Rule 2  A student scanning at a group that is not their own group
 *           always requires an explicit human decision (Accept make-up
 *           / Reject) — evaluateAttendance() never auto-approves this,
 *           it returns `needsConfirmation: true` until the caller
 *           passes `confirmMakeUp: true` (i.e. the admin clicked
 *           "Accept make-up attendance" in the UI).
 *   Rule 3  Group capacity cannot be exceeded (unless overridden).
 */

export type AttendanceTypeValue = "REGULAR" | "MAKE_UP" | "LATE" | "EXCUSED" | "ABSENT";

export interface MakeUpRules {
  /** Refuse if the session already has as many attendees as the group capacity. */
  respectCapacity: boolean;
  /** Maximum make-up sessions a student may take within the calendar month. 0 = unlimited. */
  maxMakeUpsPerMonth: number;
  /** Make-up must happen within N days of the missed session, if one is known. 0 = no limit. */
  maxDaysAfterOrigin: number;
}

export const DEFAULT_MAKEUP_RULES: MakeUpRules = {
  respectCapacity: true,
  maxMakeUpsPerMonth: 0,
  maxDaysAfterOrigin: 0
};

/** Minutes after the session start time after which a student is marked LATE. */
export const DEFAULT_LATE_THRESHOLD_MINUTES = 15;

export interface AttendanceFacts {
  /** The student's own (home) group id. */
  studentGroupId: string;
  /** The group the scanned session belongs to. */
  sessionGroupId: string;
  groupCapacity: number;
  currentAttendeeCount: number;
  /** Already-recorded attendance for this exact session (Rule 1). */
  alreadyRecorded: boolean;
  /** Number of MAKE_UP rows the student already has this calendar month. */
  makeUpsThisMonth: number;
  /** Days between the missed session and this one, if an origin session is known. */
  daysSinceOriginSession: number | null;
  /**
   * True only when the operator has already clicked "Accept make-up
   * attendance" for this exact scan (the frontend re-sends the scan
   * with this flag set after the confirmation dialog). Until then a
   * cross-group scan always comes back as `needsConfirmation`.
   */
  confirmMakeUp: boolean;
  /** Whether an override for a full group has been explicitly granted by an admin. */
  overrideCapacity?: boolean;
  /** Minutes elapsed since the session's scheduled start (can be negative). */
  minutesAfterStart: number;
  sessionStatus: "SCHEDULED" | "OPEN" | "COMPLETED" | "CANCELLED";
  /**
   * Stage 2: lessons that belong to a monthly plan are never opened as a side
   * effect of a scan — an operator must open them explicitly (so the lesson
   * order can't be skipped). Legacy sessions keep the old "first scan opens it".
   */
  requiresExplicitOpen?: boolean;
  studentStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "GRADUATED";
  lateThresholdMinutes?: number;
}

export type AttendanceDecisionCode =
  | "OK_REGULAR"
  | "OK_LATE"
  | "OK_MAKE_UP"
  | "DUPLICATE"
  | "SESSION_CANCELLED"
  | "SESSION_COMPLETED"
  | "LESSON_NOT_OPEN"
  | "STUDENT_NOT_ACTIVE"
  | "DIFFERENT_GROUP"
  | "CAPACITY_FULL"
  | "MAKEUP_LIMIT_REACHED"
  | "MAKEUP_WINDOW_EXPIRED";

export interface AttendanceDecision {
  allowed: boolean;
  /** True when the caller must show the "Student belongs to another group" dialog and re-submit with confirmMakeUp. */
  needsConfirmation: boolean;
  type: AttendanceTypeValue | null;
  code: AttendanceDecisionCode;
  /** Machine-neutral English sentence; the UI maps `code` to a localized string. */
  message: string;
  isMakeUp: boolean;
}

export function evaluateAttendance(
  facts: AttendanceFacts,
  rules: MakeUpRules = DEFAULT_MAKEUP_RULES
): AttendanceDecision {
  const lateThreshold = facts.lateThresholdMinutes ?? DEFAULT_LATE_THRESHOLD_MINUTES;

  // --- Hard blockers, checked before anything else ---
  if (facts.alreadyRecorded) {
    return deny("DUPLICATE", "Attendance for this student in this session is already recorded.");
  }
  if (facts.sessionStatus === "CANCELLED") {
    return deny("SESSION_CANCELLED", "This session has been cancelled.");
  }
  if (facts.sessionStatus === "COMPLETED") {
    return deny("SESSION_COMPLETED", "This session is already closed for attendance.");
  }
  if (facts.requiresExplicitOpen && facts.sessionStatus !== "OPEN") {
    return deny("LESSON_NOT_OPEN", "This lesson is not open. Open the lesson before recording attendance.");
  }
  if (facts.studentStatus !== "ACTIVE") {
    return deny("STUDENT_NOT_ACTIVE", "This student account is not active.");
  }

  const isOwnGroup = facts.studentGroupId === facts.sessionGroupId;
  const capacityFull =
    rules.respectCapacity && !facts.overrideCapacity && facts.currentAttendeeCount >= facts.groupCapacity;

  // --- Path A: the student belongs to this group. Normal attendance. ---
  if (isOwnGroup) {
    if (capacityFull) {
      return deny("CAPACITY_FULL", "This session has reached its capacity.");
    }
    const late = facts.minutesAfterStart > lateThreshold;
    return {
      allowed: true,
      needsConfirmation: false,
      type: late ? "LATE" : "REGULAR",
      code: late ? "OK_LATE" : "OK_REGULAR",
      message: late ? "Attendance recorded (late)." : "Attendance recorded.",
      isMakeUp: false
    };
  }

  // --- Path B: the student belongs to a DIFFERENT group (spec §10). ---
  // Every cross-group scan requires an explicit human decision — we
  // never silently approve it, regardless of any rule below.
  if (!facts.confirmMakeUp) {
    return {
      allowed: false,
      needsConfirmation: true,
      type: null,
      code: "DIFFERENT_GROUP",
      message: "Student belongs to another group.",
      isMakeUp: false
    };
  }

  if (capacityFull) {
    return deny("CAPACITY_FULL", "This session has reached its capacity.");
  }

  if (rules.maxMakeUpsPerMonth > 0 && facts.makeUpsThisMonth >= rules.maxMakeUpsPerMonth) {
    return deny(
      "MAKEUP_LIMIT_REACHED",
      "This student has reached the allowed number of make-up sessions this month."
    );
  }

  if (
    rules.maxDaysAfterOrigin > 0 &&
    facts.daysSinceOriginSession !== null &&
    facts.daysSinceOriginSession > rules.maxDaysAfterOrigin
  ) {
    return deny(
      "MAKEUP_WINDOW_EXPIRED",
      "The allowed make-up window for the missed session has expired."
    );
  }

  return {
    allowed: true,
    needsConfirmation: false,
    type: "MAKE_UP",
    code: "OK_MAKE_UP",
    message: "Make-up attendance recorded.",
    isMakeUp: true
  };
}

function deny(code: AttendanceDecisionCode, message: string): AttendanceDecision {
  return { allowed: false, needsConfirmation: false, type: null, code, message, isMakeUp: false };
}

/** Percentage helper used across attendance dashboards and student profiles. */
export function attendanceRate(present: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}

/** Normalizes a scanned barcode/QR payload before lookup. */
export function normalizeScanInput(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}
