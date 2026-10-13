import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  evaluateReasons,
  overallScore,
  rankByOverall,
  sortByNeed,
  PERFORMANCE_WEIGHTS
} from "./performance";

const empty = { exams: [], homework: [], recitations: [], attendance: { held: 0, attended: 0, excused: 0 } };

describe("performance weights", () => {
  it("sum to 100", () => {
    expect(Object.values(PERFORMANCE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("computeMetrics", () => {
  it("has no data for a student without any records", () => {
    const m = computeMetrics(empty);
    expect(m.overall).toBeNull();
    expect(m.ranked).toBe(false);
    expect(m.categoriesWithData).toBe(0);
  });

  it("averages exam percentages (each exam counts equally) and ignores absences", () => {
    const m = computeMetrics({
      ...empty,
      exams: [
        { score: 40, maxScore: 100, isAbsent: false },
        { score: 9, maxScore: 10, isAbsent: false },
        { score: null, maxScore: 50, isAbsent: true }
      ]
    });
    expect(m.examAvg).toBe(65);
    expect(m.examsTaken).toBe(2);
    expect(m.examsAbsent).toBe(1);
  });

  it("needs at least two recorded homework items", () => {
    expect(computeMetrics({ ...empty, homework: [{ completed: true }] }).homeworkPct).toBeNull();
    expect(computeMetrics({ ...empty, homework: [{ completed: true }, { completed: false }] }).homeworkPct).toBe(50);
  });

  it("removes excused lessons from the attendance denominator", () => {
    const m = computeMetrics({ ...empty, attendance: { held: 10, attended: 8, excused: 2 } });
    expect(m.attendancePct).toBe(100);
  });

  it("does not trust attendance with fewer than 3 lessons", () => {
    expect(computeMetrics({ ...empty, attendance: { held: 2, attended: 2, excused: 0 } }).attendancePct).toBeNull();
  });
});

describe("overallScore", () => {
  it("redistributes the weight of missing categories instead of counting zero", () => {
    expect(overallScore({ exams: 80, attendance: null, homework: null, recitation: null })).toBe(80);
    expect(overallScore({ exams: 100, attendance: 0, homework: null, recitation: null })).toBe(58.3);
  });
  it("uses all four weights when present", () => {
    expect(overallScore({ exams: 100, attendance: 100, homework: 100, recitation: 100 })).toBe(100);
    expect(overallScore({ exams: 60, attendance: 80, homework: 50, recitation: 70 })).toBe(65);
  });
});

describe("ranking and reasons", () => {
  it("ranks with ties sharing a position and skips unranked students", () => {
    const ranked = rankByOverall([
      { overall: 90, ranked: true },
      { overall: 90, ranked: true },
      { overall: 80, ranked: true },
      { overall: 99, ranked: false }
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("explains why a student needs attention", () => {
    const m = computeMetrics({
      exams: [{ score: 30, maxScore: 100, isAbsent: false }],
      homework: [{ completed: false }, { completed: false }, { completed: true }],
      recitations: [{ score: 2, maxScore: 10 }],
      attendance: { held: 10, attended: 5, excused: 0 }
    });
    const codes = evaluateReasons(m).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["LOW_EXAM", "LOW_HOMEWORK", "LOW_RECITATION", "LOW_ATTENDANCE", "LOW_OVERALL"]));
  });

  it("flags nothing for a strong student", () => {
    const m = computeMetrics({
      exams: [{ score: 90, maxScore: 100, isAbsent: false }],
      homework: [{ completed: true }, { completed: true }],
      recitations: [{ score: 9, maxScore: 10 }],
      attendance: { held: 10, attended: 10, excused: 0 }
    });
    expect(evaluateReasons(m)).toEqual([]);
  });

  it("sorts the neediest students first", () => {
    const sorted = sortByNeed([
      { reasons: [{ code: "LOW_EXAM" as const, value: 40, threshold: 50 }], overall: 40 },
      { reasons: [], overall: 90 },
      {
        reasons: [
          { code: "LOW_EXAM" as const, value: 40, threshold: 50 },
          { code: "LOW_ATTENDANCE" as const, value: 50, threshold: 75 }
        ],
        overall: 45
      }
    ]);
    expect(sorted.map((s) => s.reasons.length)).toEqual([2, 1, 0]);
  });
});
