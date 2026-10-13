import { describe, expect, it } from "vitest";
import {
  buildSnapshotWarnings,
  countAttendance,
  isFeeUnpaid,
  resolveFeeState,
  rosterAttendanceRate,
  scorePercent
} from "./lesson-snapshot";

describe("resolveFeeState", () => {
  it("prefers the subscription billed for this group", () => {
    const state = resolveFeeState(
      [
        { groupId: "other", status: "PAID", remaining: 0 },
        { groupId: "g1", status: "UNPAID", remaining: 300 }
      ],
      "g1"
    );
    expect(state).toEqual({ state: "UNPAID", remaining: 300 });
  });

  it("falls back to a general (group-less) subscription", () => {
    expect(resolveFeeState([{ groupId: null, status: "PAID", remaining: 0 }], "g1").state).toBe("PAID");
  });

  it("ignores subscriptions billed for a different group and reports NOT_BILLED", () => {
    expect(resolveFeeState([{ groupId: "other", status: "PAID", remaining: 0 }], "g1").state).toBe("NOT_BILLED");
    expect(resolveFeeState([], "g1").state).toBe("NOT_BILLED");
  });
});

describe("isFeeUnpaid", () => {
  it("treats PAID and WAIVED as settled and everything else as unpaid", () => {
    expect(isFeeUnpaid("PAID")).toBe(false);
    expect(isFeeUnpaid("WAIVED")).toBe(false);
    for (const state of ["PARTIAL", "UNPAID", "OVERDUE", "NOT_BILLED"] as const) {
      expect(isFeeUnpaid(state)).toBe(true);
    }
  });
});

describe("scorePercent", () => {
  it("computes a one-decimal percentage and handles missing scores", () => {
    expect(scorePercent(8.5, 10)).toBe(85);
    expect(scorePercent(46, 50)).toBe(92);
    expect(scorePercent(1, 3)).toBe(33.3);
    expect(scorePercent(null, 10)).toBeNull();
    expect(scorePercent(5, 0)).toBeNull();
  });
});

describe("countAttendance / rosterAttendanceRate", () => {
  it("counts make-up attendees as present and also as make-up", () => {
    expect(countAttendance(["REGULAR", "MAKE_UP", "LATE", "ABSENT", "ABSENT", "EXCUSED"])).toEqual({
      present: 2,
      late: 1,
      absent: 2,
      excused: 1,
      makeUp: 1
    });
  });

  it("rate is bounded by the roster size and safe for empty groups", () => {
    expect(rosterAttendanceRate(20, 15)).toBe(75);
    expect(rosterAttendanceRate(10, 12)).toBe(100);
    expect(rosterAttendanceRate(0, 0)).toBe(0);
  });
});

describe("buildSnapshotWarnings", () => {
  const base = {
    studentStatus: "ACTIVE",
    studentGroupId: "g1",
    lessonGroupId: "g1",
    alreadyRecorded: false,
    consecutiveAbsences: 0,
    repeatedAbsenceThreshold: 3
  };

  it("is empty for a healthy student", () => {
    expect(buildSnapshotWarnings({ ...base, feeState: "PAID" })).toEqual([]);
  });

  it("flags repeated absence at the configured threshold", () => {
    expect(buildSnapshotWarnings({ ...base, consecutiveAbsences: 3 })).toEqual([
      { code: "REPEATED_ABSENCE", severity: "critical", count: 3 }
    ]);
    expect(buildSnapshotWarnings({ ...base, consecutiveAbsences: 2 })).toEqual([]);
  });

  it("flags inactive students, other-group students and duplicates", () => {
    const codes = buildSnapshotWarnings({
      ...base,
      studentStatus: "SUSPENDED",
      studentGroupId: "g2",
      alreadyRecorded: true
    }).map((w) => w.code);
    expect(codes).toEqual(["NOT_ACTIVE", "DIFFERENT_GROUP", "ALREADY_RECORDED"]);
  });

  it("only mentions fees when the viewer is allowed to see them", () => {
    expect(buildSnapshotWarnings({ ...base, feeState: "UNPAID" }).map((w) => w.code)).toEqual(["FEES_UNPAID"]);
    expect(buildSnapshotWarnings({ ...base }).map((w) => w.code)).toEqual([]);
  });
});
