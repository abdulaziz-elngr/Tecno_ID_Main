import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  applyStaffGroupPlan,
  findGroupTimeConflicts,
  planStaffGroupSync,
  releaseStaffGroups,
  staffGroupField
} from "./staff-groups";
import { BusinessRuleError } from "./api";

const ORG = "org-1";
const BRANCH = "branch-1";

// ---------------------------------------------------------------
// Pure overlap rule
// ---------------------------------------------------------------
describe("findGroupTimeConflicts", () => {
  const slot = (dayOfWeek: "SUNDAY" | "MONDAY", startMinutes: number, endMinutes: number) => ({
    dayOfWeek,
    startMinutes,
    endMinutes
  });

  it("flags overlapping slots on the same day", () => {
    const out = findGroupTimeConflicts([
      { id: "g1", name: "G1", schedules: [slot("SUNDAY", 960, 1050)] },
      { id: "g2", name: "G2", schedules: [slot("SUNDAY", 1000, 1100)] }
    ]);
    expect(out).toEqual([{ a: { id: "g1", name: "G1" }, b: { id: "g2", name: "G2" } }]);
  });
  it("allows back-to-back slots and different days", () => {
    expect(
      findGroupTimeConflicts([
        { id: "g1", name: "G1", schedules: [slot("SUNDAY", 960, 1050)] },
        { id: "g2", name: "G2", schedules: [slot("SUNDAY", 1050, 1140)] },
        { id: "g3", name: "G3", schedules: [slot("MONDAY", 960, 1050)] }
      ])
    ).toEqual([]);
  });
  it("groups without schedules never conflict", () => {
    expect(findGroupTimeConflicts([{ id: "a", name: "A", schedules: [] }, { id: "b", name: "B", schedules: [] }])).toEqual([]);
  });
});

describe("staffGroupField", () => {
  it("teachers use teacherId, assistants use assistantId", () => {
    expect(staffGroupField(false)).toBe("teacherId");
    expect(staffGroupField(true)).toBe("assistantId");
  });
});

// ---------------------------------------------------------------
// In-memory stand-in for the Prisma `group` delegate (only the query
// shapes staff-groups.ts uses), so the REAL plan/apply/release code runs.
// ---------------------------------------------------------------
interface FakeGroup {
  id: string;
  name: string;
  branchId: string;
  organizationId: string;
  deletedAt: Date | null;
  teacherId: string | null;
  assistantId: string | null;
  schedules: { dayOfWeek: "SUNDAY" | "MONDAY"; startMinutes: number; endMinutes: number }[];
}

const NAMES: Record<string, string> = { t1: "Teacher One", t2: "Teacher Two", a1: "Assistant One" };

interface FakeLink {
  groupId: string;
  teacherId: string;
  seq: number;
}

function makeClient(groups: FakeGroup[], links: FakeLink[] = []) {
  let seq = links.reduce((m, l) => Math.max(m, l.seq), 0);
  type Where = Record<string, unknown>;
  const matches = (g: FakeGroup, where: Where): boolean => {
    for (const [key, cond] of Object.entries(where)) {
      if (key === "id") {
        const c = cond as string | { in: string[]; not?: string };
        if (typeof c === "string" ? g.id !== c : !c.in.includes(g.id)) return false;
      } else if (key === "deletedAt") {
        if (cond === null && g.deletedAt !== null) return false;
      } else if (key === "branchId") {
        if (g.branchId !== cond) return false;
      } else if (key === "branch") {
        const org = (cond as { center: { organizationId: string } }).center.organizationId;
        if (g.organizationId !== org) return false;
      } else if (key === "teacherId" || key === "assistantId") {
        if (g[key] !== cond) return false;
      }
    }
    return true;
  };
  const project = (g: FakeGroup) => ({
    id: g.id,
    name: g.name,
    teacherId: g.teacherId,
    assistantId: g.assistantId,
    teacher: g.teacherId ? { id: g.teacherId, fullName: NAMES[g.teacherId] ?? g.teacherId } : null,
    assistant: g.assistantId ? { id: g.assistantId, fullName: NAMES[g.assistantId] ?? g.assistantId } : null,
    schedules: g.schedules
  });

  const linkMatches = (l: FakeLink, where: { teacherId?: string; groupId?: string | { in: string[] }; group?: { deletedAt: null } }) => {
    if (where.teacherId !== undefined && l.teacherId !== where.teacherId) return false;
    if (typeof where.groupId === "string" && l.groupId !== where.groupId) return false;
    if (where.groupId && typeof where.groupId === "object" && !where.groupId.in.includes(l.groupId)) return false;
    if (where.group && groups.find((g) => g.id === l.groupId)?.deletedAt) return false;
    return true;
  };

  const client = {
    groupAssistant: {
      findMany: async ({ where }: { where: Parameters<typeof linkMatches>[1] }) =>
        links.filter((l) => linkMatches(l, where)).map((l) => ({ groupId: l.groupId, teacherId: l.teacherId })),
      findFirst: async ({ where }: { where: { groupId: string } }) => {
        const first = links.filter((l) => l.groupId === where.groupId).sort((a, b) => a.seq - b.seq)[0];
        return first ? { teacherId: first.teacherId } : null;
      },
      deleteMany: async ({ where }: { where: Parameters<typeof linkMatches>[1] }) => {
        const hit = links.filter((l) => linkMatches(l, where));
        for (const l of hit) links.splice(links.indexOf(l), 1);
        return { count: hit.length };
      },
      createMany: async ({ data }: { data: { groupId: string; teacherId: string }[] }) => {
        for (const d of data) {
          if (!links.some((l) => l.groupId === d.groupId && l.teacherId === d.teacherId)) links.push({ ...d, seq: (seq += 1) });
        }
        return { count: data.length };
      }
    },
    group: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<Pick<FakeGroup, "teacherId" | "assistantId">> }) => {
        const g = groups.find((x) => x.id === where.id)!;
        Object.assign(g, data);
        return g;
      },
      findMany: async ({ where }: { where: Where }) => groups.filter((g) => matches(g, where)).map(project),
      updateMany: async ({ where, data }: { where: Where; data: Partial<Pick<FakeGroup, "teacherId" | "assistantId">> }) => {
        const hit = groups.filter((g) => matches(g, where));
        for (const g of hit) Object.assign(g, data);
        return { count: hit.length };
      }
    }
  };
  return client as unknown as Prisma.TransactionClient;
}

function seed(): FakeGroup[] {
  const mk = (id: string, day: "SUNDAY" | "MONDAY", start: number, end: number, extra: Partial<FakeGroup> = {}): FakeGroup => ({
    id,
    name: id.toUpperCase(),
    branchId: BRANCH,
    organizationId: ORG,
    deletedAt: null,
    teacherId: null,
    assistantId: null,
    schedules: [{ dayOfWeek: day, startMinutes: start, endMinutes: end }],
    ...extra
  });
  return [
    mk("g1", "SUNDAY", 960, 1050),
    mk("g2", "MONDAY", 960, 1050, { teacherId: "t1" }),
    mk("g3", "MONDAY", 1100, 1200, { teacherId: "t1" }),
    mk("g4", "SUNDAY", 1100, 1200)
  ];
}

const teacher = { id: "t1", branchId: BRANCH, isAssistant: false };
const owned = (groups: FakeGroup[], id: string, field: "teacherId" | "assistantId" = "teacherId") =>
  groups.filter((g) => g[field] === id).map((g) => g.id).sort();

describe("planStaffGroupSync + applyStaffGroupPlan", () => {
  it("syncs {G2,G3} -> {G1,G4}: adds the new groups and frees the removed ones", async () => {
    const groups = seed();
    const tx = makeClient(groups);
    const plan = await planStaffGroupSync(tx, {
      organizationId: ORG,
      staff: teacher,
      groupIds: ["g1", "g4"],
      allowReassign: false
    });
    expect(plan.toAdd.sort()).toEqual(["g1", "g4"]);
    expect(plan.toRemove.sort()).toEqual(["g2", "g3"]);
    await applyStaffGroupPlan(tx, "t1", plan);
    expect(owned(groups, "t1")).toEqual(["g1", "g4"]);
    expect(groups.find((g) => g.id === "g2")?.teacherId).toBeNull();
  });

  it("is a no-op when the selection is unchanged", async () => {
    const groups = seed();
    const tx = makeClient(groups);
    const plan = await planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: ["g2", "g3"], allowReassign: false });
    expect(plan.toAdd).toEqual([]);
    expect(plan.toRemove).toEqual([]);
    await applyStaffGroupPlan(tx, "t1", plan);
    expect(owned(groups, "t1")).toEqual(["g2", "g3"]);
  });

  it("removes every group for an empty selection", async () => {
    const groups = seed();
    const tx = makeClient(groups);
    const plan = await planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: [], allowReassign: false });
    await applyStaffGroupPlan(tx, "t1", plan);
    expect(owned(groups, "t1")).toEqual([]);
  });

  it("rejects unknown, deleted, foreign-org and other-branch groups (400)", async () => {
    const groups = seed();
    groups.push({ ...seed()[0]!, id: "gdel", deletedAt: new Date() });
    groups.push({ ...seed()[0]!, id: "gorg", organizationId: "other-org" });
    groups.push({ ...seed()[0]!, id: "gbr", branchId: "branch-2" });
    const tx = makeClient(groups);
    for (const bad of ["nope", "gdel", "gorg", "gbr"]) {
      await expect(
        planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: [bad], allowReassign: false })
      ).rejects.toMatchObject({ status: 400, code: "INVALID_GROUPS" });
    }
  });

  it("blocks taking a group that belongs to someone else unless reassign is confirmed", async () => {
    const groups = seed();
    groups.find((g) => g.id === "g1")!.teacherId = "t2";
    const tx = makeClient(groups);
    const attempt = planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: ["g2", "g3", "g1"], allowReassign: false });
    await expect(attempt).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt).rejects.toMatchObject({ status: 409, code: "GROUP_ALREADY_ASSIGNED" });

    const plan = await planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: ["g2", "g3", "g1"], allowReassign: true });
    expect(plan.takeovers).toEqual([
      { groupId: "g1", groupName: "G1", currentStaffId: "t2", currentStaffName: "Teacher Two" }
    ]);
    await applyStaffGroupPlan(tx, "t1", plan);
    expect(owned(groups, "t1")).toEqual(["g1", "g2", "g3"]);
    expect(owned(groups, "t2")).toEqual([]);
  });

  it("blocks adding a group whose time overlaps another selected group (409)", async () => {
    const groups = seed();
    // g5 overlaps g1 (SUNDAY 16:00-17:30)
    groups.push({ ...seed()[0]!, id: "g5", name: "G5", schedules: [{ dayOfWeek: "SUNDAY", startMinutes: 1000, endMinutes: 1100 }] });
    const tx = makeClient(groups);
    await expect(
      planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: ["g1", "g5"], allowReassign: false })
    ).rejects.toMatchObject({ status: 409, code: "SCHEDULE_CONFLICT" });
  });

  it("does not block editing when an OLD pair already overlaps and nothing overlapping is added", async () => {
    const groups = seed();
    groups.find((g) => g.id === "g3")!.schedules = [{ dayOfWeek: "MONDAY", startMinutes: 1000, endMinutes: 1100 }]; // overlaps g2
    const tx = makeClient(groups);
    const plan = await planStaffGroupSync(tx, { organizationId: ORG, staff: teacher, groupIds: ["g2", "g3"], allowReassign: false });
    expect(plan.toAdd).toEqual([]);
  });

  it("assistants join through GroupAssistant and never touch teacherId", async () => {
    const groups = seed();
    const links: FakeLink[] = [];
    const assistant = { id: "a1", branchId: BRANCH, isAssistant: true };
    const tx = makeClient(groups, links);
    const plan = await planStaffGroupSync(tx, { organizationId: ORG, staff: assistant, groupIds: ["g2"], allowReassign: false });
    expect(plan.field).toBe("assistantId");
    await applyStaffGroupPlan(tx, "a1", plan);
    expect(links.map((l) => [l.groupId, l.teacherId])).toEqual([["g2", "a1"]]);
    expect(owned(groups, "a1", "assistantId")).toEqual(["g2"]); // mirror of the first assistant
    expect(groups.find((g) => g.id === "g2")?.teacherId).toBe("t1"); // the teacher keeps the group
  });

  it("several assistants can share one group without a takeover; the mirror follows the first", async () => {
    const groups = seed();
    const links: FakeLink[] = [];
    const a1 = { id: "a1", branchId: BRANCH, isAssistant: true };
    const a2 = { id: "a2", branchId: BRANCH, isAssistant: true };
    const tx = makeClient(groups, links);

    await applyStaffGroupPlan(tx, "a1", await planStaffGroupSync(tx, { organizationId: ORG, staff: a1, groupIds: ["g1"], allowReassign: false }));
    // a2 joins the SAME group: allowed even though a1 already is its assistant.
    const plan2 = await planStaffGroupSync(tx, { organizationId: ORG, staff: a2, groupIds: ["g1"], allowReassign: false });
    expect(plan2.takeovers).toEqual([]);
    await applyStaffGroupPlan(tx, "a2", plan2);
    expect(links.filter((l) => l.groupId === "g1").map((l) => l.teacherId).sort()).toEqual(["a1", "a2"]);
    expect(groups.find((g) => g.id === "g1")?.assistantId).toBe("a1");

    // The first assistant leaves: the other one stays and becomes the mirror.
    const leave = await planStaffGroupSync(tx, { organizationId: ORG, staff: a1, groupIds: [], allowReassign: false });
    await applyStaffGroupPlan(tx, "a1", leave);
    expect(links.map((l) => l.teacherId)).toEqual(["a2"]);
    expect(groups.find((g) => g.id === "g1")?.assistantId).toBe("a2");
  });
});

describe("releaseStaffGroups", () => {
  it("frees all of a deleted teacher's groups and reports them", async () => {
    const groups = seed();
    const tx = makeClient(groups);
    const freed = await releaseStaffGroups(tx, { id: "t1", isAssistant: false });
    expect(freed.sort()).toEqual(["g2", "g3"]);
    expect(owned(groups, "t1")).toEqual([]);
  });

  it("deleting an assistant only removes him: co-assistants keep the group", async () => {
    const groups = seed();
    groups.find((g) => g.id === "g1")!.assistantId = "a1";
    const links: FakeLink[] = [
      { groupId: "g1", teacherId: "a1", seq: 1 },
      { groupId: "g1", teacherId: "a2", seq: 2 }
    ];
    const tx = makeClient(groups, links);
    const freed = await releaseStaffGroups(tx, { id: "a1", isAssistant: true });
    expect(freed).toEqual(["g1"]);
    expect(links.map((l) => l.teacherId)).toEqual(["a2"]);
    expect(groups.find((g) => g.id === "g1")?.assistantId).toBe("a2");
  });
});
