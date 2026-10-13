import { describe, expect, it } from "vitest";
import {
  canCancelLesson,
  canCloseLesson,
  canOpenLesson,
  currentLesson,
  isPlanDeletable,
  lateMinutes,
  nextLesson,
  planProgress,
  type LessonRef
} from "./lesson-flow";
import { sessionStartInstant, zonedMinutesToUtc } from "./tz";
import { minutesAfterStart } from "./sessions";

const L = (n: number, status: LessonRef["status"]): LessonRef => ({ id: `l${n}`, lessonNumber: n, status });

describe("canOpenLesson", () => {
  it("lets the first lesson open", () => {
    const plan = [L(1, "SCHEDULED"), L(2, "SCHEDULED"), L(3, "SCHEDULED")];
    expect(canOpenLesson({ lesson: plan[0]!, planLessons: plan, openElsewhere: [] })).toEqual({ allowed: true });
  });

  it("refuses to skip ahead: lesson 3 cannot open while lesson 2 is not finished", () => {
    const plan = [L(1, "COMPLETED"), L(2, "SCHEDULED"), L(3, "SCHEDULED")];
    const decision = canOpenLesson({ lesson: plan[2]!, planLessons: plan, openElsewhere: [] });
    expect(decision).toMatchObject({ allowed: false, code: "PREVIOUS_LESSON_NOT_FINISHED", blockingLessonNumber: 2 });
  });

  it("lesson 2 opens once lesson 1 is COMPLETED", () => {
    const plan = [L(1, "COMPLETED"), L(2, "SCHEDULED")];
    expect(canOpenLesson({ lesson: plan[1]!, planLessons: plan, openElsewhere: [] }).allowed).toBe(true);
  });

  it("a CANCELLED earlier lesson does not block the next one", () => {
    const plan = [L(1, "CANCELLED"), L(2, "SCHEDULED")];
    expect(canOpenLesson({ lesson: plan[1]!, planLessons: plan, openElsewhere: [] }).allowed).toBe(true);
  });

  it("refuses when another lesson of the group is already OPEN", () => {
    const plan = [L(1, "OPEN"), L(2, "SCHEDULED")];
    const decision = canOpenLesson({ lesson: plan[1]!, planLessons: plan, openElsewhere: [plan[0]!] });
    expect(decision).toMatchObject({ allowed: false, code: "ANOTHER_LESSON_OPEN", blockingLessonNumber: 1 });
  });

  it("refuses to re-open an OPEN, COMPLETED or CANCELLED lesson", () => {
    for (const status of ["OPEN", "COMPLETED", "CANCELLED"] as const) {
      const lesson = L(1, status);
      expect(canOpenLesson({ lesson, planLessons: [lesson], openElsewhere: [] })).toEqual({
        allowed: false,
        code: "NOT_SCHEDULED"
      });
    }
  });

  it("legacy sessions without a lesson number only obey the status / single-open rules", () => {
    const legacy: LessonRef = { id: "x", lessonNumber: null, status: "SCHEDULED" };
    expect(canOpenLesson({ lesson: legacy, planLessons: [], openElsewhere: [] }).allowed).toBe(true);
  });
});

describe("nextLesson / currentLesson", () => {
  it("next is the first unfinished lesson when it is SCHEDULED", () => {
    const plan = [L(1, "COMPLETED"), L(2, "SCHEDULED"), L(3, "SCHEDULED")];
    expect(nextLesson(plan)?.lessonNumber).toBe(2);
  });

  it("there is no 'next' while a lesson is open (it is the current lesson)", () => {
    const plan = [L(1, "COMPLETED"), L(2, "OPEN"), L(3, "SCHEDULED")];
    expect(nextLesson(plan)).toBeNull();
    expect(currentLesson(plan)?.lessonNumber).toBe(2);
  });

  it("skips cancelled lessons and returns null when everything is finished", () => {
    expect(nextLesson([L(1, "CANCELLED"), L(2, "SCHEDULED")])?.lessonNumber).toBe(2);
    expect(nextLesson([L(1, "COMPLETED"), L(2, "COMPLETED")])).toBeNull();
  });

  it("sorts by lesson number, not array order", () => {
    expect(nextLesson([L(3, "SCHEDULED"), L(1, "COMPLETED"), L(2, "SCHEDULED")])?.lessonNumber).toBe(2);
  });
});

describe("close / cancel / progress", () => {
  it("only an OPEN lesson can be closed — never by the clock", () => {
    expect(canCloseLesson("OPEN")).toEqual({ allowed: true });
    for (const status of ["SCHEDULED", "COMPLETED", "CANCELLED"] as const) {
      expect(canCloseLesson(status)).toEqual({ allowed: false, code: "NOT_OPEN" });
    }
  });

  it("COMPLETED lessons are locked against cancelling", () => {
    expect(canCancelLesson("SCHEDULED")).toBe(true);
    expect(canCancelLesson("OPEN")).toBe(true);
    expect(canCancelLesson("COMPLETED")).toBe(false);
    expect(canCancelLesson("CANCELLED")).toBe(false);
  });

  it("planProgress counts each status", () => {
    expect(planProgress([L(1, "COMPLETED"), L(2, "OPEN"), L(3, "SCHEDULED"), L(4, "CANCELLED")])).toEqual({
      total: 4,
      completed: 1,
      open: 1,
      scheduled: 1,
      cancelled: 1
    });
  });

  it("a plan is only deletable while it has no history", () => {
    expect(isPlanDeletable([{ status: "SCHEDULED", attendanceCount: 0 }])).toBe(true);
    expect(isPlanDeletable([{ status: "SCHEDULED", attendanceCount: 1 }])).toBe(false);
    expect(isPlanDeletable([{ status: "OPEN", attendanceCount: 0 }])).toBe(false);
    expect(isPlanDeletable([{ status: "COMPLETED", attendanceCount: 0 }])).toBe(false);
  });
});

describe("lateness uses the centre's real local start time", () => {
  const sessionDate = new Date("2026-10-03T00:00:00Z"); // stored as UTC midnight

  it("Cairo is UTC+3 on 3 Oct 2026 (Egyptian DST) so a 17:00 start is 14:00 UTC", () => {
    expect(sessionStartInstant(sessionDate, 17 * 60, "Africa/Cairo").toISOString()).toBe("2026-10-03T14:00:00.000Z");
  });

  it("a student scanned at 17:20 Cairo time is 20 minutes late; at 16:55 they are early", () => {
    const start = sessionStartInstant(sessionDate, 17 * 60, "Africa/Cairo");
    expect(lateMinutes(start, new Date("2026-10-03T14:20:00Z"))).toBe(20);
    expect(lateMinutes(start, new Date("2026-10-03T13:55:00Z"))).toBe(0);
    expect(minutesAfterStart(sessionDate, 17 * 60, new Date("2026-10-03T13:55:00Z"), "Africa/Cairo")).toBe(-5);
  });

  it("winter time (no DST) is UTC+2", () => {
    expect(zonedMinutesToUtc(2026, 1, 10, 17 * 60, "Africa/Cairo").toISOString()).toBe("2026-01-10T15:00:00.000Z");
  });
});
