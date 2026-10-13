/**
 * Student performance / consistency scoring (Stage 3 — "Student performance" page).
 *
 * Pure functions, unit-tested in performance.test.ts. All inputs come from real
 * database rows (ExamResult, AssignmentSubmission, Recitation, Attendance); this
 * file only defines HOW they are combined, so the methodology lives in one place
 * and is shown to users on the page.
 *
 * ── Methodology ──────────────────────────────────────────────────────────────
 * Every category is first turned into a 0–100 percentage:
 *   Exams       mean of (score ÷ exam max) over the exams the student sat and
 *               was graded in. Each exam counts equally, whatever its max score.
 *               Absences are NOT counted as zeros (they are reported separately).
 *   Homework    completed ÷ recorded. Only homework whose status was actually
 *               recorded (Completed / Not completed) counts; homework nobody has
 *               marked yet never penalises the student.
 *   Recitation  mean of (score ÷ recitation max) over graded recitations.
 *   Attendance  attended ÷ lessons held. Lessons held = COMPLETED lessons of the
 *               student's group on/after their enrolment date; EXCUSED lessons
 *               are removed from the denominator; REGULAR, MAKE_UP and LATE all
 *               count as attended.
 *
 * Overall score = weighted mean of the categories that HAVE data:
 *   Exams 35 · Attendance 25 · Homework 20 · Recitation 20
 * Exams weigh most because they are the only formal, comparable measure of
 * mastery; attendance is next because it drives everything else; homework and
 * recitation are frequent but smaller, teacher-judged signals. When a category
 * has no (or too little) data its weight is redistributed over the others — a
 * missing category is never treated as zero.
 *
 * A student is only RANKED when at least MIN_CATEGORIES_FOR_RANKING categories
 * have enough data, so one lucky exam cannot top the board.
 */

export const PERFORMANCE_WEIGHTS = {
  exams: 35,
  attendance: 25,
  homework: 20,
  recitation: 20
} as const;

/** A category below its threshold is reported as a reason to pay attention. */
export const PERFORMANCE_THRESHOLDS = {
  exams: 50,
  homework: 60,
  recitation: 50,
  attendance: 75,
  overall: 60,
  /** Missing this many (or more) exams is flagged on its own. */
  missedExams: 2
} as const;

/** Minimum number of data points before a category is trusted at all. */
export const MIN_SAMPLES = {
  exams: 1,
  homework: 2,
  recitation: 1,
  attendance: 3
} as const;

export const MIN_CATEGORIES_FOR_RANKING = 2;

export type ReasonCode =
  | "LOW_EXAM"
  | "LOW_HOMEWORK"
  | "LOW_RECITATION"
  | "LOW_ATTENDANCE"
  | "MISSED_EXAMS"
  | "LOW_OVERALL";

export interface PerformanceReason {
  code: ReasonCode;
  /** The student's actual figure (a percentage, or a count for MISSED_EXAMS). */
  value: number;
  /** The limit that was crossed. */
  threshold: number;
}

export interface MetricsInput {
  exams: { score: number | null; maxScore: number; isAbsent: boolean }[];
  /** Only homework whose status has been recorded. */
  homework: { completed: boolean }[];
  recitations: { score: number | null; maxScore: number }[];
  attendance: { held: number; attended: number; excused: number };
}

export interface StudentMetrics {
  examAvg: number | null;
  examsTaken: number;
  examsAbsent: number;
  homeworkPct: number | null;
  homeworkRecorded: number;
  homeworkDone: number;
  recitationAvg: number | null;
  recitationCount: number;
  attendancePct: number | null;
  lessonsHeld: number;
  lessonsAttended: number;
  categoriesWithData: number;
  overall: number | null;
  /** True when enough categories have data for the student to be ranked. */
  ranked: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function overallScore(parts: {
  exams: number | null;
  attendance: number | null;
  homework: number | null;
  recitation: number | null;
}): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const key of ["exams", "attendance", "homework", "recitation"] as const) {
    const value = parts[key];
    if (value === null) continue;
    weighted += value * PERFORMANCE_WEIGHTS[key];
    totalWeight += PERFORMANCE_WEIGHTS[key];
  }
  if (totalWeight === 0) return null;
  return round1(weighted / totalWeight);
}

export function computeMetrics(input: MetricsInput): StudentMetrics {
  const gradedExams = input.exams.filter((e) => !e.isAbsent && e.score !== null && e.maxScore > 0);
  const examsAbsent = input.exams.filter((e) => e.isAbsent).length;
  const examAvgRaw = gradedExams.length >= MIN_SAMPLES.exams ? mean(gradedExams.map((e) => ((e.score as number) / e.maxScore) * 100)) : null;

  const homeworkDone = input.homework.filter((h) => h.completed).length;
  const homeworkPctRaw =
    input.homework.length >= MIN_SAMPLES.homework ? (homeworkDone / input.homework.length) * 100 : null;

  const gradedRecitations = input.recitations.filter((r) => r.score !== null && r.maxScore > 0);
  const recitationAvgRaw =
    gradedRecitations.length >= MIN_SAMPLES.recitation
      ? mean(gradedRecitations.map((r) => ((r.score as number) / r.maxScore) * 100))
      : null;

  const denominator = input.attendance.held - input.attendance.excused;
  const attendancePctRaw =
    denominator >= MIN_SAMPLES.attendance ? (Math.min(input.attendance.attended, denominator) / denominator) * 100 : null;

  const examAvg = examAvgRaw === null ? null : round1(examAvgRaw);
  const homeworkPct = homeworkPctRaw === null ? null : round1(homeworkPctRaw);
  const recitationAvg = recitationAvgRaw === null ? null : round1(recitationAvgRaw);
  const attendancePct = attendancePctRaw === null ? null : round1(attendancePctRaw);

  const categoriesWithData = [examAvg, homeworkPct, recitationAvg, attendancePct].filter((v) => v !== null).length;

  return {
    examAvg,
    examsTaken: gradedExams.length,
    examsAbsent,
    homeworkPct,
    homeworkRecorded: input.homework.length,
    homeworkDone,
    recitationAvg,
    recitationCount: gradedRecitations.length,
    attendancePct,
    lessonsHeld: input.attendance.held,
    lessonsAttended: input.attendance.attended,
    categoriesWithData,
    overall: overallScore({ exams: examAvg, attendance: attendancePct, homework: homeworkPct, recitation: recitationAvg }),
    ranked: categoriesWithData >= MIN_CATEGORIES_FOR_RANKING
  };
}

/** Why a student needs attention (empty = nothing to flag). */
export function evaluateReasons(m: StudentMetrics): PerformanceReason[] {
  const reasons: PerformanceReason[] = [];
  const T = PERFORMANCE_THRESHOLDS;
  if (m.examAvg !== null && m.examAvg < T.exams) reasons.push({ code: "LOW_EXAM", value: m.examAvg, threshold: T.exams });
  if (m.homeworkPct !== null && m.homeworkPct < T.homework) {
    reasons.push({ code: "LOW_HOMEWORK", value: m.homeworkPct, threshold: T.homework });
  }
  if (m.recitationAvg !== null && m.recitationAvg < T.recitation) {
    reasons.push({ code: "LOW_RECITATION", value: m.recitationAvg, threshold: T.recitation });
  }
  if (m.attendancePct !== null && m.attendancePct < T.attendance) {
    reasons.push({ code: "LOW_ATTENDANCE", value: m.attendancePct, threshold: T.attendance });
  }
  if (m.examsAbsent >= T.missedExams) {
    reasons.push({ code: "MISSED_EXAMS", value: m.examsAbsent, threshold: T.missedExams });
  }
  if (m.overall !== null && m.overall < T.overall) {
    reasons.push({ code: "LOW_OVERALL", value: m.overall, threshold: T.overall });
  }
  return reasons;
}

/** Competition ranking (1,2,2,4) by overall score, highest first. Unranked students are skipped. */
export function rankByOverall<T extends { overall: number | null; ranked: boolean }>(items: T[]): (T & { rank: number })[] {
  const sorted = items
    .filter((i) => i.ranked && i.overall !== null)
    .sort((a, b) => (b.overall as number) - (a.overall as number));
  const out: (T & { rank: number })[] = [];
  let lastScore: number | null = null;
  let lastRank = 0;
  sorted.forEach((item, index) => {
    const rank = lastScore !== null && item.overall === lastScore ? lastRank : index + 1;
    out.push({ ...item, rank });
    lastScore = item.overall;
    lastRank = rank;
  });
  return out;
}

/** Students who most need attention first: more reasons, then lower overall score. */
export function sortByNeed<T extends { reasons: PerformanceReason[]; overall: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
    const ao = a.overall ?? 101;
    const bo = b.overall ?? 101;
    return ao - bo;
  });
}
