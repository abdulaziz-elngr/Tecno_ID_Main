/**
 * Lesson formation (تشكيل الحصص) — PURE date generation.
 *
 * Given a group's configured weekly schedule slots and a requested number of
 * lessons per week, this module works out the REAL calendar dates of one
 * month. It never touches the database so it can be unit-tested exhaustively;
 * `src/app/api/lesson-plans/*` loads the facts, calls these functions and
 * persists the result.
 *
 * Rules:
 *  - Only dates whose weekday matches an active schedule slot are ever
 *    produced — dates are never invented.
 *  - The month is split into calendar weeks (Saturday → Friday, the Egyptian
 *    working week). For every week, ALL slot occurrences of that full week are
 *    sorted chronologically and the first `lessonsPerWeek` are chosen; only
 *    then are dates outside the requested month dropped. Deciding on the
 *    whole week (not just the in-month part) means a week that straddles two
 *    months is never counted twice nor skipped when the next month is formed.
 *  - A request for more lessons per week than the group has weekly slots is
 *    capped at the number of slots (the configured schedule is never
 *    exceeded) and reported through `warnings`.
 *  - Lessons are numbered 1..n in chronological order.
 */

export type WeekdayName =
  | "SUNDAY"
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY";

const WEEKDAYS: WeekdayName[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY"
];

/** JS getUTCDay() index of the day each calendar week starts on (6 = Saturday). */
export const WEEK_STARTS_ON = 6;

export interface ScheduleSlot {
  dayOfWeek: WeekdayName;
  startMinutes: number;
  endMinutes: number;
}

export interface PlannedLesson {
  /** 1-based number inside the monthly plan. */
  lessonNumber: number;
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  dayOfWeek: WeekdayName;
  startMinutes: number;
  endMinutes: number;
}

export interface LessonPlanResult {
  lessons: PlannedLesson[];
  /** Number of calendar weeks that intersect the month. */
  weeksInMonth: number;
  /** The per-week count actually applied (requested, capped at the slots/week). */
  appliedLessonsPerWeek: number;
  warnings: LessonPlanWarning[];
}

export type LessonPlanWarning =
  | { code: "NO_SCHEDULE" }
  | { code: "LESSONS_PER_WEEK_CAPPED"; requested: number; applied: number };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function weekdayOf(date: Date): WeekdayName {
  return WEEKDAYS[date.getUTCDay()]!;
}

/** Start (UTC midnight) of the calendar week that contains `date`. */
export function startOfWeek(date: Date, weekStartsOn: number = WEEK_STARTS_ON): Date {
  const diff = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff);
}

export function daysInMonth(year: number, month: number): number {
  return utcDate(year, month, 0).getUTCDate();
}

/**
 * Every date of the month on which a slot occurs, chronological (then by
 * start time). This is the full set of dates a plan may legitimately use.
 */
export function slotOccurrencesInMonth(
  year: number,
  month: number,
  slots: ScheduleSlot[]
): Omit<PlannedLesson, "lessonNumber">[] {
  const out: Omit<PlannedLesson, "lessonNumber">[] = [];
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const date = utcDate(year, month - 1, day);
    const dow = weekdayOf(date);
    for (const slot of slots) {
      if (slot.dayOfWeek !== dow) continue;
      out.push({
        date: isoDate(date),
        dayOfWeek: dow,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
}

/**
 * Generates the lessons of one month.
 *
 * @param year   calendar year, e.g. 2026
 * @param month  1–12
 */
export function generateMonthlyLessons(params: {
  year: number;
  month: number;
  slots: ScheduleSlot[];
  lessonsPerWeek: number;
  weekStartsOn?: number;
}): LessonPlanResult {
  const { year, month, slots } = params;
  const weekStartsOn = params.weekStartsOn ?? WEEK_STARTS_ON;
  const warnings: LessonPlanWarning[] = [];

  if (slots.length === 0) {
    return { lessons: [], weeksInMonth: countWeeks(year, month, weekStartsOn), appliedLessonsPerWeek: 0, warnings: [{ code: "NO_SCHEDULE" }] };
  }

  const requested = Math.max(1, Math.floor(params.lessonsPerWeek));
  const applied = Math.min(requested, slots.length);
  if (applied < requested) {
    warnings.push({ code: "LESSONS_PER_WEEK_CAPPED", requested, applied });
  }

  const firstDay = utcDate(year, month - 1, 1);
  const lastDay = utcDate(year, month - 1, daysInMonth(year, month));
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  const selected: Omit<PlannedLesson, "lessonNumber">[] = [];
  let weeks = 0;

  for (
    let weekStart = startOfWeek(firstDay, weekStartsOn);
    weekStart <= lastDay;
    weekStart = utcDate(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7)
  ) {
    weeks += 1;

    // All slot occurrences of the FULL week (even days that fall outside the month).
    const weekOccurrences: Omit<PlannedLesson, "lessonNumber">[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = utcDate(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + offset);
      const dow = weekdayOf(date);
      for (const slot of slots) {
        if (slot.dayOfWeek === dow) {
          weekOccurrences.push({
            date: isoDate(date),
            dayOfWeek: dow,
            startMinutes: slot.startMinutes,
            endMinutes: slot.endMinutes
          });
        }
      }
    }
    weekOccurrences.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);

    for (const occurrence of weekOccurrences.slice(0, applied)) {
      if (occurrence.date.startsWith(monthPrefix)) selected.push(occurrence);
    }
  }

  selected.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);

  return {
    lessons: numberLessons(selected),
    weeksInMonth: weeks,
    appliedLessonsPerWeek: applied,
    warnings
  };
}

function countWeeks(year: number, month: number, weekStartsOn: number): number {
  const firstDay = utcDate(year, month - 1, 1);
  const lastDay = utcDate(year, month - 1, daysInMonth(year, month));
  let weeks = 0;
  for (
    let weekStart = startOfWeek(firstDay, weekStartsOn);
    weekStart <= lastDay;
    weekStart = utcDate(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7)
  ) {
    weeks += 1;
  }
  return weeks;
}

/** Assigns 1..n lesson numbers in chronological order. */
export function numberLessons(
  lessons: Omit<PlannedLesson, "lessonNumber">[]
): PlannedLesson[] {
  return [...lessons]
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)
    .map((lesson, index) => ({ ...lesson, lessonNumber: index + 1 }));
}

/**
 * Server-side guard for the lessons the administrator confirmed after
 * reviewing the preview: every submitted lesson must be one of the real slot
 * occurrences of that month, with no duplicates. Returns the lessons
 * (re-numbered 1..n from the trusted slot data — the client never decides
 * times or numbers) or the first problem found.
 */
export function validateConfirmedLessons(params: {
  year: number;
  month: number;
  slots: ScheduleSlot[];
  confirmed: { date: string; startMinutes: number }[];
}): { ok: true; lessons: PlannedLesson[] } | { ok: false; reason: string; date?: string } {
  if (params.confirmed.length === 0) {
    return { ok: false, reason: "NO_LESSONS" };
  }
  const allowed = new Map(
    slotOccurrencesInMonth(params.year, params.month, params.slots).map((o) => [
      `${o.date}|${o.startMinutes}`,
      o
    ])
  );

  const seen = new Set<string>();
  const picked: Omit<PlannedLesson, "lessonNumber">[] = [];
  for (const item of params.confirmed) {
    const key = `${item.date}|${item.startMinutes}`;
    const match = allowed.get(key);
    if (!match) return { ok: false, reason: "NOT_A_SCHEDULED_DAY", date: item.date };
    if (seen.has(key)) return { ok: false, reason: "DUPLICATE_DATE", date: item.date };
    seen.add(key);
    picked.push(match);
  }
  return { ok: true, lessons: numberLessons(picked) };
}

/** "SATURDAY" → JS getUTCDay index, handy for tests and UI sorting. */
export function weekdayIndex(day: WeekdayName): number {
  return WEEKDAYS.indexOf(day);
}
