import { describe, expect, it } from "vitest";
import { mergeSubjectTeachers, summarizeSubjectGroups, type SummaryGroup } from "./subject-summary";

const secondary = { id: "st2", name: "Secondary", order: 2 };
const prep = { id: "st1", name: "Preparatory", order: 1 };

function group(id: string, over: Partial<SummaryGroup> = {}): SummaryGroup {
  return {
    id,
    name: id.toUpperCase(),
    capacity: 30,
    isActive: true,
    studentCount: 10,
    grade: { id: "gr3", name: "Grade 3", order: 3, stage: secondary },
    teacher: null,
    ...over
  };
}

describe("mergeSubjectTeachers", () => {
  it("unions declared teachers with group teachers without duplicating anyone", () => {
    const merged = mergeSubjectTeachers(
      [{ id: "tA", fullName: "Teacher A" }],
      [
        { id: "g1", teacher: { id: "tA", fullName: "Teacher A" } },
        { id: "g2", teacher: { id: "tA", fullName: "Teacher A" } },
        { id: "g3", teacher: { id: "tB", fullName: "Teacher B" } }
      ]
    );
    expect(merged).toHaveLength(2);
    const a = merged.find((t) => t.id === "tA")!;
    expect(a.declared).toBe(true);
    expect(a.groupIds).toEqual(["g1", "g2"]);
    const b = merged.find((t) => t.id === "tB")!;
    expect(b.declared).toBe(false);
    expect(b.groupIds).toEqual(["g3"]);
  });

  it("keeps a declared teacher that has no groups yet, and ignores groups without a teacher", () => {
    const merged = mergeSubjectTeachers([{ id: "tA", fullName: "Teacher A" }], [{ id: "g1", teacher: null }]);
    expect(merged).toEqual([{ id: "tA", fullName: "Teacher A", declared: true, groupIds: [] }]);
  });

  it("sorts alphabetically", () => {
    const merged = mergeSubjectTeachers(
      [
        { id: "z", fullName: "Zed" },
        { id: "a", fullName: "Amr" }
      ],
      []
    );
    expect(merged.map((t) => t.fullName)).toEqual(["Amr", "Zed"]);
  });
});

describe("summarizeSubjectGroups", () => {
  it("totals students/capacity and counts active groups", () => {
    const totals = summarizeSubjectGroups([
      group("g1", { studentCount: 12, capacity: 30 }),
      group("g2", { studentCount: 5, capacity: 20, isActive: false })
    ]);
    expect(totals.groups).toBe(2);
    expect(totals.activeGroups).toBe(1);
    expect(totals.students).toBe(17);
    expect(totals.capacity).toBe(50);
  });

  it("returns distinct stages and grades ordered stage -> grade", () => {
    const totals = summarizeSubjectGroups([
      group("g1"),
      group("g2"),
      group("g3", { grade: { id: "gr1", name: "Grade 1", order: 1, stage: prep } }),
      group("g4", { grade: { id: "gr2", name: "Grade 2", order: 2, stage: secondary } })
    ]);
    expect(totals.stages.map((s) => s.name)).toEqual(["Preparatory", "Secondary"]);
    expect(totals.grades.map((g) => `${g.stageName}/${g.name}`)).toEqual([
      "Preparatory/Grade 1",
      "Secondary/Grade 2",
      "Secondary/Grade 3"
    ]);
  });

  it("handles a subject with no groups", () => {
    const totals = summarizeSubjectGroups([]);
    expect(totals).toEqual({ groups: 0, activeGroups: 0, students: 0, capacity: 0, stages: [], grades: [] });
  });
});
