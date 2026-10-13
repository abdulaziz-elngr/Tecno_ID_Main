/**
 * Lesson lifecycle rules (Stage 2) — PURE functions, no database.
 *
 *   SCHEDULED ──open──▶ OPEN ──close──▶ COMPLETED   (final, locked)
 *       │                 │
 *       └──── cancel ─────┴──▶ CANCELLED            (final)
 *
 * Guarantees enforced here (and unit-tested):
 *  - A lesson of a monthly plan can only be opened once every earlier lesson
 *    of that plan is finished (COMPLETED or explicitly CANCELLED), so history
 *    can't be skipped by accident.
 *  - Only one lesson per group may be OPEN at a time.
 *  - A lesson is NEVER closed because of the clock: only an explicit close
 *    moves OPEN → COMPLETED. `scheduledEnd` is informational only.
 *  - COMPLETED is final: attendance corrections after that go through the
 *    audited attendance adjustment flow (attendance.update + reason).
 */

export type LessonStatus = "SCHEDULED" | "OPEN" | "COMPLETED" | "CANCELLED";

export interface LessonRef {
  id: string;
  /** null for sessions that pre-date lesson formation. */
  lessonNumber: number | null;
  status: LessonStatus;
}

export function isFinished(status: LessonStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export type OpenDenialCode =
  | "NOT_SCHEDULED"
  | "PREVIOUS_LESSON_NOT_FINISHED"
  | "ANOTHER_LESSON_OPEN";

export type OpenDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: OpenDenialCode;
      /** Lesson number of the lesson that must be finished first (when known). */
      blockingLessonNumber?: number | null;
      blockingLessonId?: string;
    };

/**
 * @param lesson       the lesson the operator wants to open
 * @param planLessons  every lesson of the same monthly plan (may include `lesson`)
 * @param openElsewhere other OPEN lessons of the same group (any plan)
 */
export function canOpenLesson(params: {
  lesson: LessonRef;
  planLessons: LessonRef[];
  openElsewhere: LessonRef[];
}): OpenDecision {
  const { lesson, planLessons } = params;

  if (lesson.status !== "SCHEDULED") {
    return { allowed: false, code: "NOT_SCHEDULED" };
  }

  const otherOpen = params.openElsewhere.find((l) => l.id !== lesson.id && l.status === "OPEN");
  if (otherOpen) {
    return {
      allowed: false,
      code: "ANOTHER_LESSON_OPEN",
      blockingLessonNumber: otherOpen.lessonNumber,
      blockingLessonId: otherOpen.id
    };
  }

  if (lesson.lessonNumber !== null) {
    const blocking = planLessons
      .filter(
        (l) =>
          l.id !== lesson.id &&
          l.lessonNumber !== null &&
          l.lessonNumber < lesson.lessonNumber! &&
          !isFinished(l.status)
      )
      .sort((a, b) => (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0))[0];
    if (blocking) {
      return {
        allowed: false,
        code: "PREVIOUS_LESSON_NOT_FINISHED",
        blockingLessonNumber: blocking.lessonNumber,
        blockingLessonId: blocking.id
      };
    }
  }

  return { allowed: true };
}

/** The lesson that may be opened next: lowest-numbered SCHEDULED lesson. */
export function nextLesson<T extends LessonRef>(planLessons: T[]): T | null {
  const sorted = [...planLessons]
    .filter((l) => l.lessonNumber !== null)
    .sort((a, b) => (a.lessonNumber ?? 0) - (b.lessonNumber ?? 0));
  const next = sorted.find((l) => !isFinished(l.status));
  // The first unfinished lesson is either the OPEN one (current) or the next
  // SCHEDULED one. Only the latter is "next to open".
  return next && next.status === "SCHEDULED" ? next : null;
}

/** The currently open lesson of a plan, if any. */
export function currentLesson<T extends LessonRef>(planLessons: T[]): T | null {
  return planLessons.find((l) => l.status === "OPEN") ?? null;
}

export type CloseDenialCode = "NOT_OPEN";

export function canCloseLesson(status: LessonStatus): { allowed: true } | { allowed: false; code: CloseDenialCode } {
  return status === "OPEN" ? { allowed: true } : { allowed: false, code: "NOT_OPEN" };
}

/** COMPLETED and CANCELLED are final; everything else can be cancelled. */
export function canCancelLesson(status: LessonStatus): boolean {
  return status === "SCHEDULED" || status === "OPEN";
}

export interface PlanProgress {
  total: number;
  completed: number;
  cancelled: number;
  open: number;
  scheduled: number;
}

export function planProgress(lessons: { status: LessonStatus }[]): PlanProgress {
  const progress: PlanProgress = { total: lessons.length, completed: 0, cancelled: 0, open: 0, scheduled: 0 };
  for (const l of lessons) {
    if (l.status === "COMPLETED") progress.completed += 1;
    else if (l.status === "CANCELLED") progress.cancelled += 1;
    else if (l.status === "OPEN") progress.open += 1;
    else progress.scheduled += 1;
  }
  return progress;
}

/** A plan may only be removed while it has no history at all. */
export function isPlanDeletable(lessons: { status: LessonStatus; attendanceCount: number }[]): boolean {
  return lessons.every((l) => l.status === "SCHEDULED" && l.attendanceCount === 0);
}

/**
 * Minutes a student arrived after the lesson's real start instant (never
 * negative). Use `sessionStartInstant()` from tz.ts to get the instant.
 */
export function lateMinutes(startInstant: Date, recordedAt: Date): number {
  return Math.max(0, Math.round((recordedAt.getTime() - startInstant.getTime()) / 60000));
}
