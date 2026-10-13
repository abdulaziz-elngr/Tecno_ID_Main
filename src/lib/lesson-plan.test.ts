import { describe, expect, it } from "vitest";
import {
  generateMonthlyLessons,
  numberLessons,
  slotOccurrencesInMonth,
  startOfWeek,
  validateConfirmedLessons,
  type ScheduleSlot
} from "./lesson-plan";

const SAT_TUE: ScheduleSlot[] = [
  { dayOfWeek: "SATURDAY", startMinutes: 17 * 60, endMinutes: 19 * 60 },
  { dayOfWeek: "TUESDAY", startMinutes: 18 * 60, endMinutes: 20 * 60 }
];

const dates = (r: ReturnType<typeof generateMonthlyLessons>) => r.lessons.map((l) => l.date);

describe("generateMonthlyLessons", () => {
  it("October 2026, Saturday + Tuesday, 2 lessons/week → the real calendar dates, numbered 1..n", () => {
    const result = generateMonthlyLessons({ year: 2026, month: 10, slots: SAT_TUE, lessonsPerWeek: 2 });
    expect(dates(result)).toEqual([
      "2026-10-03", // Sat — matches the example in the brief
      "2026-10-06", // Tue
      "2026-10-10",
      "2026-10-13",
      "2026-10-17",
      "2026-10-20",
      "2026-10-24",
      "2026-10-27",
      "2026-10-31"
    ]);
    expect(result.lessons.map((l) => l.lessonNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.lessons[0]).toMatchObject({ dayOfWeek: "SATURDAY", startMinutes: 1020, endMinutes: 1140 });
    expect(result.lessons[1]).toMatchObject({ dayOfWeek: "TUESDAY", startMinutes: 1080, endMinutes: 1200 });
    expect(result.appliedLessonsPerWeek).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it("1 lesson/week keeps the first configured day of each week (Saturday) — and October has 5 Saturdays, not 4", () => {
    const result = generateMonthlyLessons({ year: 2026, month: 10, slots: SAT_TUE, lessonsPerWeek: 1 });
    expect(dates(result)).toEqual(["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"]);
  });

  it("only ever produces dates that fall on a configured weekday", () => {
    for (const month of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const result = generateMonthlyLessons({ year: 2026, month, slots: SAT_TUE, lessonsPerWeek: 2 });
      for (const lesson of result.lessons) {
        const dow = new Date(`${lesson.date}T00:00:00Z`).getUTCDay();
        expect([6, 2]).toContain(dow);
        expect(lesson.date.startsWith(`2026-${String(month).padStart(2, "0")}`)).toBe(true);
      }
    }
  });

  it("does not assume four weeks: February 2026 (28 days) vs. a 5-Saturday month", () => {
    const feb = generateMonthlyLessons({ year: 2026, month: 2, slots: SAT_TUE, lessonsPerWeek: 2 });
    expect(dates(feb)).toEqual([
      "2026-02-03", "2026-02-07", "2026-02-10", "2026-02-14", "2026-02-17", "2026-02-21", "2026-02-24", "2026-02-28"
    ]);
    const oct = generateMonthlyLessons({ year: 2026, month: 10, slots: SAT_TUE, lessonsPerWeek: 2 });
    expect(oct.lessons.length).not.toBe(feb.lessons.length);
  });

  it("a week that straddles two months is neither double-counted nor skipped (1 lesson/week)", () => {
    // Week Sat 31 Oct → Fri 6 Nov: the single weekly lesson is Sat 31 Oct, so November gets none from that week.
    const oct = generateMonthlyLessons({ year: 2026, month: 10, slots: SAT_TUE, lessonsPerWeek: 1 });
    const nov = generateMonthlyLessons({ year: 2026, month: 11, slots: SAT_TUE, lessonsPerWeek: 1 });
    expect(dates(oct)).toContain("2026-10-31");
    expect(dates(nov)).not.toContain("2026-11-03");
    expect(dates(nov)[0]).toBe("2026-11-07");
    // …and with 2/week both months share the straddling week: Sat in Oct, Tue in Nov.
    const nov2 = generateMonthlyLessons({ year: 2026, month: 11, slots: SAT_TUE, lessonsPerWeek: 2 });
    expect(dates(nov2)[0]).toBe("2026-11-03");
  });

  it("caps lessons/week at the number of configured weekly slots and says so", () => {
    const result = generateMonthlyLessons({
      year: 2026,
      month: 10,
      slots: [SAT_TUE[0]!],
      lessonsPerWeek: 3
    });
    expect(result.appliedLessonsPerWeek).toBe(1);
    expect(result.warnings).toEqual([{ code: "LESSONS_PER_WEEK_CAPPED", requested: 3, applied: 1 }]);
    expect(result.lessons).toHaveLength(5);
  });

  it("returns no lessons and a NO_SCHEDULE warning when the group has no schedule", () => {
    const result = generateMonthlyLessons({ year: 2026, month: 10, slots: [], lessonsPerWeek: 2 });
    expect(result.lessons).toEqual([]);
    expect(result.warnings).toEqual([{ code: "NO_SCHEDULE" }]);
  });

  it("handles leap-year February and year boundaries", () => {
    const feb = generateMonthlyLessons({ year: 2028, month: 2, slots: [{ dayOfWeek: "TUESDAY", startMinutes: 600, endMinutes: 660 }], lessonsPerWeek: 1 });
    expect(dates(feb)).toEqual(["2028-02-01", "2028-02-08", "2028-02-15", "2028-02-22", "2028-02-29"]);
    const dec = generateMonthlyLessons({ year: 2026, month: 12, slots: SAT_TUE, lessonsPerWeek: 2 });
    expect(dec.lessons.every((l) => l.date.startsWith("2026-12"))).toBe(true);
  });

  it("two slots on the same day yield two lessons that day, ordered by start time", () => {
    const slots: ScheduleSlot[] = [
      { dayOfWeek: "MONDAY", startMinutes: 900, endMinutes: 960 },
      { dayOfWeek: "MONDAY", startMinutes: 600, endMinutes: 660 }
    ];
    const result = generateMonthlyLessons({ year: 2026, month: 10, slots, lessonsPerWeek: 2 });
    expect(result.lessons.slice(0, 2).map((l) => [l.date, l.startMinutes])).toEqual([
      ["2026-10-05", 600],
      ["2026-10-05", 900]
    ]);
  });
});

describe("helpers", () => {
  it("startOfWeek uses Saturday as the first day of the week", () => {
    expect(startOfWeek(new Date("2026-10-06T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(startOfWeek(new Date("2026-10-03T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(startOfWeek(new Date("2026-10-02T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-26");
  });

  it("numberLessons orders chronologically before numbering", () => {
    const numbered = numberLessons([
      { date: "2026-10-06", dayOfWeek: "TUESDAY", startMinutes: 0, endMinutes: 60 },
      { date: "2026-10-03", dayOfWeek: "SATURDAY", startMinutes: 0, endMinutes: 60 }
    ]);
    expect(numbered.map((l) => [l.lessonNumber, l.date])).toEqual([
      [1, "2026-10-03"],
      [2, "2026-10-06"]
    ]);
  });

  it("slotOccurrencesInMonth lists every matching date", () => {
    expect(slotOccurrencesInMonth(2026, 10, SAT_TUE)).toHaveLength(9);
  });
});

describe("validateConfirmedLessons (server-side guard on the reviewed preview)", () => {
  it("accepts a subset of real slot dates and renumbers from 1", () => {
    const result = validateConfirmedLessons({
      year: 2026,
      month: 10,
      slots: SAT_TUE,
      confirmed: [
        { date: "2026-10-10", startMinutes: 1020 },
        { date: "2026-10-03", startMinutes: 1020 }
      ]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lessons.map((l) => [l.lessonNumber, l.date, l.endMinutes])).toEqual([
        [1, "2026-10-03", 1140],
        [2, "2026-10-10", 1140]
      ]);
    }
  });

  it("rejects a date that is not a configured group day", () => {
    const result = validateConfirmedLessons({
      year: 2026,
      month: 10,
      slots: SAT_TUE,
      confirmed: [{ date: "2026-10-04", startMinutes: 1020 }]
    });
    expect(result).toEqual({ ok: false, reason: "NOT_A_SCHEDULED_DAY", date: "2026-10-04" });
  });

  it("rejects a right day with a start time the group does not have", () => {
    const result = validateConfirmedLessons({
      year: 2026,
      month: 10,
      slots: SAT_TUE,
      confirmed: [{ date: "2026-10-03", startMinutes: 600 }]
    });
    expect(result.ok).toBe(false);
  });

  it("rejects dates outside the month, duplicates and empty submissions", () => {
    expect(
      validateConfirmedLessons({ year: 2026, month: 10, slots: SAT_TUE, confirmed: [{ date: "2026-11-03", startMinutes: 1080 }] }).ok
    ).toBe(false);
    expect(
      validateConfirmedLessons({
        year: 2026,
        month: 10,
        slots: SAT_TUE,
        confirmed: [
          { date: "2026-10-03", startMinutes: 1020 },
          { date: "2026-10-03", startMinutes: 1020 }
        ]
      })
    ).toEqual({ ok: false, reason: "DUPLICATE_DATE", date: "2026-10-03" });
    expect(validateConfirmedLessons({ year: 2026, month: 10, slots: SAT_TUE, confirmed: [] })).toEqual({
      ok: false,
      reason: "NO_LESSONS"
    });
  });
});
