import { describe, it, expect } from "vitest";
import {
  evaluateAttendance,
  attendanceRate,
  normalizeScanInput,
  DEFAULT_MAKEUP_RULES,
  type AttendanceFacts,
  type MakeUpRules
} from "./attendance";

function baseFacts(overrides: Partial<AttendanceFacts> = {}): AttendanceFacts {
  return {
    studentGroupId: "group-1",
    sessionGroupId: "group-1",
    groupCapacity: 20,
    currentAttendeeCount: 5,
    alreadyRecorded: false,
    makeUpsThisMonth: 0,
    daysSinceOriginSession: null,
    confirmMakeUp: false,
    minutesAfterStart: 0,
    sessionStatus: "OPEN",
    studentStatus: "ACTIVE",
    ...overrides
  };
}

describe("evaluateAttendance — hard blockers", () => {
  it("denies duplicate attendance (Rule 1)", () => {
    const result = evaluateAttendance(baseFacts({ alreadyRecorded: true }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("DUPLICATE");
  });

  it("denies attendance for a cancelled session", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "CANCELLED" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SESSION_CANCELLED");
  });

  it("denies attendance for an already-closed session", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "COMPLETED" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("SESSION_COMPLETED");
  });

  it("denies attendance for an inactive student", () => {
    const result = evaluateAttendance(baseFacts({ studentStatus: "SUSPENDED" }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("STUDENT_NOT_ACTIVE");
  });
});

describe("evaluateAttendance — own group (regular) path", () => {
  it("records REGULAR attendance within the late threshold", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 5 }));
    expect(result).toMatchObject({ allowed: true, type: "REGULAR", code: "OK_REGULAR", isMakeUp: false });
  });

  it("records LATE attendance past the late threshold", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 20 }));
    expect(result).toMatchObject({ allowed: true, type: "LATE", code: "OK_LATE" });
  });

  it("respects a custom late threshold from facts", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 10, lateThresholdMinutes: 5 }));
    expect(result.type).toBe("LATE");
  });

  it("is not late exactly at the threshold boundary", () => {
    const result = evaluateAttendance(baseFacts({ minutesAfterStart: 15 }));
    expect(result.type).toBe("REGULAR");
  });

  it("denies when the group is at capacity and capacity is enforced", () => {
    const result = evaluateAttendance(baseFacts({ currentAttendeeCount: 20, groupCapacity: 20 }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CAPACITY_FULL");
  });

  it("allows over capacity when explicitly overridden", () => {
    const result = evaluateAttendance(
      baseFacts({ currentAttendeeCount: 25, groupCapacity: 20, overrideCapacity: true })
    );
    expect(result.allowed).toBe(true);
  });

  it("allows over capacity when respectCapacity is disabled in rules", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, respectCapacity: false };
    const result = evaluateAttendance(baseFacts({ currentAttendeeCount: 25, groupCapacity: 20 }), rules);
    expect(result.allowed).toBe(true);
  });
});

describe("evaluateAttendance — cross-group make-up path (spec §10)", () => {
  function crossGroupFacts(overrides: Partial<AttendanceFacts> = {}): AttendanceFacts {
    return baseFacts({
      studentGroupId: "home-group",
      sessionGroupId: "other-group",
      ...overrides
    });
  }

  it("never auto-approves — returns DIFFERENT_GROUP + needsConfirmation when not yet confirmed", () => {
    const result = evaluateAttendance(crossGroupFacts());
    expect(result.allowed).toBe(false);
    expect(result.needsConfirmation).toBe(true);
    expect(result.code).toBe("DIFFERENT_GROUP");
  });

  it("records MAKE_UP once confirmMakeUp is true", () => {
    const result = evaluateAttendance(crossGroupFacts({ confirmMakeUp: true }));
    expect(result).toMatchObject({ allowed: true, type: "MAKE_UP", code: "OK_MAKE_UP", isMakeUp: true });
    expect(result.needsConfirmation).toBe(false);
  });

  it("still enforces capacity even when confirmed", () => {
    const result = evaluateAttendance(
      crossGroupFacts({ confirmMakeUp: true, currentAttendeeCount: 20, groupCapacity: 20 })
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("CAPACITY_FULL");
  });

  it("denies once the monthly make-up limit is reached", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, maxMakeUpsPerMonth: 4 };
    const result = evaluateAttendance(crossGroupFacts({ confirmMakeUp: true, makeUpsThisMonth: 4 }), rules);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("MAKEUP_LIMIT_REACHED");
  });

  it("allows unlimited make-ups when maxMakeUpsPerMonth is 0 (default)", () => {
    const result = evaluateAttendance(crossGroupFacts({ confirmMakeUp: true, makeUpsThisMonth: 50 }));
    expect(result.allowed).toBe(true);
  });

  it("denies once the make-up window has expired", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, maxDaysAfterOrigin: 14 };
    const result = evaluateAttendance(
      crossGroupFacts({ confirmMakeUp: true, daysSinceOriginSession: 20 }),
      rules
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("MAKEUP_WINDOW_EXPIRED");
  });

  it("does not enforce the window when no origin session is known", () => {
    const rules: MakeUpRules = { ...DEFAULT_MAKEUP_RULES, maxDaysAfterOrigin: 14 };
    const result = evaluateAttendance(
      crossGroupFacts({ confirmMakeUp: true, daysSinceOriginSession: null }),
      rules
    );
    expect(result.allowed).toBe(true);
  });
});

describe("attendanceRate", () => {
  it("returns 0 for zero total sessions", () => {
    expect(attendanceRate(0, 0)).toBe(0);
  });

  it("computes a rounded percentage to one decimal place", () => {
    expect(attendanceRate(2, 3)).toBe(66.7);
  });

  it("returns 100 when every session was present", () => {
    expect(attendanceRate(10, 10)).toBe(100);
  });
});

describe("evaluateAttendance — explicit lesson opening (Stage 2)", () => {
  it("refuses a scan for a numbered lesson that has not been opened", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "SCHEDULED", requiresExplicitOpen: true }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe("LESSON_NOT_OPEN");
  });

  it("accepts the same scan once the lesson is OPEN", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "OPEN", requiresExplicitOpen: true }));
    expect(result.allowed).toBe(true);
    expect(result.code).toBe("OK_REGULAR");
  });

  it("legacy sessions (no explicit open required) can still be scanned while SCHEDULED", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "SCHEDULED" }));
    expect(result.allowed).toBe(true);
  });

  it("a lesson stays scannable past its scheduled end — only lateness, never the clock, matters", () => {
    // 3 hours after the scheduled start the lesson is still OPEN: the student is LATE, not refused.
    const result = evaluateAttendance(baseFacts({ sessionStatus: "OPEN", requiresExplicitOpen: true, minutesAfterStart: 180 }));
    expect(result.allowed).toBe(true);
    expect(result.type).toBe("LATE");
  });

  it("a closed lesson refuses further scans (attendance is final)", () => {
    const result = evaluateAttendance(baseFacts({ sessionStatus: "COMPLETED", requiresExplicitOpen: true }));
    expect(result.code).toBe("SESSION_COMPLETED");
  });
});

describe("normalizeScanInput", () => {
  it("trims whitespace and uppercases the payload", () => {
    expect(normalizeScanInput("  abc123  ")).toBe("ABC123");
  });

  it("strips internal whitespace introduced by scanner noise", () => {
    expect(normalizeScanInput("ab c 123")).toBe("ABC123");
  });
});
