import { describe, expect, it } from "vitest";
import {
  describeGroupBlockers,
  evaluateGroupDeletion,
  normalizeSubjectCode,
  type GroupDependencyCounts
} from "./group-rules";

const EMPTY: GroupDependencyCounts = {
  students: 0,
  sessions: 0,
  attendance: 0,
  exams: 0,
  assignments: 0,
  subscriptions: 0
};

describe("evaluateGroupDeletion", () => {
  it("allows deleting a group nothing depends on", () => {
    const verdict = evaluateGroupDeletion(EMPTY);
    expect(verdict.canDelete).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.onlyStudentsBlock).toBe(false);
    expect(describeGroupBlockers(verdict)).toBe("");
  });

  it("blocks deletion while students are enrolled and says to move them", () => {
    const verdict = evaluateGroupDeletion({ ...EMPTY, students: 3 });
    expect(verdict.canDelete).toBe(false);
    expect(verdict.onlyStudentsBlock).toBe(true);
    expect(describeGroupBlockers(verdict)).toContain("3 enrolled students");
    expect(describeGroupBlockers(verdict)).toContain("Move the students");
  });

  it("blocks deletion for any historical record and tells the user to archive", () => {
    for (const key of ["sessions", "attendance", "exams", "assignments", "subscriptions"] as const) {
      const verdict = evaluateGroupDeletion({ ...EMPTY, [key]: 2 });
      expect(verdict.canDelete).toBe(false);
      expect(verdict.onlyStudentsBlock).toBe(false);
      expect(verdict.blockers).toEqual([{ key, count: 2 }]);
      expect(describeGroupBlockers(verdict)).toContain("Archive it instead");
    }
  });

  it("lists every blocker in a stable order, students first", () => {
    const verdict = evaluateGroupDeletion({ ...EMPTY, subscriptions: 1, attendance: 9, students: 4 });
    expect(verdict.blockers.map((b) => b.key)).toEqual(["students", "attendance", "subscriptions"]);
    expect(verdict.onlyStudentsBlock).toBe(false);
  });
});

describe("normalizeSubjectCode", () => {
  it("trims and upper-cases", () => {
    expect(normalizeSubjectCode("  math ")).toBe("MATH");
  });

  it("turns empty / whitespace / nullish into null", () => {
    expect(normalizeSubjectCode("")).toBeNull();
    expect(normalizeSubjectCode("   ")).toBeNull();
    expect(normalizeSubjectCode(null)).toBeNull();
    expect(normalizeSubjectCode(undefined)).toBeNull();
  });
});
