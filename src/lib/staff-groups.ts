import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { BusinessRuleError } from "./api";
import { rangesOverlap, type TimeRange } from "./scheduling";
import { diffIds } from "./staff";

/**
 * Group assignments for Teachers and Assistants.
 *
 * Data model (unchanged): `Group.teacherId` and `Group.assistantId` are the
 * single source of truth for "who is responsible for this group" — exams
 * authorization, session generation and the scheduling conflict rules all
 * read them. A teacher therefore already has MANY groups
 * (`Teacher.groupsAsTeacher`, `Teacher.groupsAsAssistant`); this module is the
 * one place that edits those rows, so the "teacher edit" form can add/remove
 * groups in a single transaction without a second, competing join table.
 *
 *  - a Teacher (isAssistant = false) owns groups through `teacherId`;
 *  - an Assistant (isAssistant = true) owns groups through `assistantId`.
 */

type Client = Prisma.TransactionClient | typeof db;

export type StaffGroupField = "teacherId" | "assistantId";

export function staffGroupField(isAssistant: boolean): StaffGroupField {
  return isAssistant ? "assistantId" : "teacherId";
}

export interface GroupWithSchedules {
  id: string;
  name: string;
  schedules: TimeRange[];
}

export interface GroupTimeConflict {
  a: { id: string; name: string };
  b: { id: string; name: string };
}

/**
 * Pairs of groups whose weekly schedules overlap — one person cannot be in two
 * groups at the same time (spec §4, same rule `findScheduleConflicts` applies
 * when a single schedule row is saved). Pure, so it is unit-tested directly.
 */
export function findGroupTimeConflicts(groups: readonly GroupWithSchedules[]): GroupTimeConflict[] {
  const conflicts: GroupTimeConflict[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i]!;
      const b = groups[j]!;
      const overlap = a.schedules.some((sa) => b.schedules.some((sb) => rangesOverlap(sa, sb)));
      if (overlap) conflicts.push({ a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name } });
    }
  }
  return conflicts;
}

export interface GroupTakeover {
  groupId: string;
  groupName: string;
  currentStaffId: string;
  currentStaffName: string;
}

export interface StaffGroupPlan {
  field: StaffGroupField;
  toAdd: string[];
  toRemove: string[];
  /** Groups that currently belong to someone else and would change hands. */
  takeovers: GroupTakeover[];
}

const GROUP_SELECT = {
  id: true,
  name: true,
  teacherId: true,
  assistantId: true,
  teacher: { select: { id: true, fullName: true } },
  assistant: { select: { id: true, fullName: true } },
  schedules: { where: { isActive: true }, select: { dayOfWeek: true, startMinutes: true, endMinutes: true } }
} satisfies Prisma.GroupSelect;

/**
 * Validates the requested group set and works out what has to change.
 * Throws a BusinessRuleError (-> 4xx JSON) for: unknown/foreign/other-branch
 * groups, schedule overlaps between the groups being added, and groups that
 * already belong to another person unless `allowReassign` was confirmed.
 * Run it inside the same transaction that applies the plan.
 */
export async function planStaffGroupSync(
  client: Client,
  params: {
    organizationId: string;
    staff: { id: string; branchId: string; isAssistant: boolean };
    groupIds: readonly string[];
    allowReassign: boolean;
  }
): Promise<StaffGroupPlan> {
  const { organizationId, staff, groupIds, allowReassign } = params;
  const field = staffGroupField(staff.isAssistant);

  const wanted = groupIds.length
    ? await client.group.findMany({
        where: {
          id: { in: [...groupIds] },
          deletedAt: null,
          // A group must be in this organization AND in the staff member's own branch.
          branchId: staff.branchId,
          branch: { center: { organizationId } }
        },
        select: GROUP_SELECT
      })
    : [];
  if (wanted.length !== groupIds.length) {
    throw new BusinessRuleError("One or more selected groups are invalid or belong to another branch.", {
      status: 400,
      code: "INVALID_GROUPS"
    });
  }

  const currentRows = await client.group.findMany({
    where: { deletedAt: null, [field]: staff.id },
    select: { id: true }
  });
  const { toAdd, toRemove } = diffIds(
    currentRows.map((g) => g.id),
    groupIds
  );

  const addedGroups = wanted.filter((g) => toAdd.includes(g.id));

  const takeovers: GroupTakeover[] = [];
  for (const g of addedGroups) {
    const owner = staff.isAssistant ? g.assistant : g.teacher;
    if (owner && owner.id !== staff.id) {
      takeovers.push({ groupId: g.id, groupName: g.name, currentStaffId: owner.id, currentStaffName: owner.fullName });
    }
  }
  if (takeovers.length > 0 && !allowReassign) {
    throw new BusinessRuleError("Some selected groups are already assigned to someone else.", {
      status: 409,
      code: "GROUP_ALREADY_ASSIGNED",
      details: { code: "GROUP_ALREADY_ASSIGNED", groups: takeovers }
    });
  }

  // Only conflicts that involve a group being ADDED are blocking, so old data
  // that already overlaps never prevents editing the teacher's other details.
  const timeConflicts = findGroupTimeConflicts(
    wanted.map((g) => ({ id: g.id, name: g.name, schedules: g.schedules }))
  ).filter((c) => toAdd.includes(c.a.id) || toAdd.includes(c.b.id));
  if (timeConflicts.length > 0) {
    throw new BusinessRuleError("Some selected groups meet at overlapping times.", {
      status: 409,
      code: "SCHEDULE_CONFLICT",
      details: { code: "SCHEDULE_CONFLICT", conflicts: timeConflicts }
    });
  }

  return { field, toAdd, toRemove, takeovers };
}

/** Applies a plan: removes first, then adds (so a swap {G2,G3} -> {G1,G4} is consistent). */
export async function applyStaffGroupPlan(
  tx: Prisma.TransactionClient,
  staffId: string,
  plan: StaffGroupPlan
): Promise<void> {
  if (plan.toRemove.length > 0) {
    await tx.group.updateMany({
      where: { id: { in: plan.toRemove }, [plan.field]: staffId },
      data: { [plan.field]: null }
    });
  }
  if (plan.toAdd.length > 0) {
    await tx.group.updateMany({
      where: { id: { in: plan.toAdd }, deletedAt: null },
      data: { [plan.field]: staffId }
    });
  }
}

/** Frees every group a staff member currently holds (used when they are deleted). Returns the freed group ids. */
export async function releaseStaffGroups(
  tx: Prisma.TransactionClient,
  staff: { id: string; isAssistant: boolean }
): Promise<string[]> {
  const field = staffGroupField(staff.isAssistant);
  const rows = await tx.group.findMany({ where: { [field]: staff.id }, select: { id: true } });
  if (rows.length > 0) {
    await tx.group.updateMany({ where: { [field]: staff.id }, data: { [field]: null } });
  }
  return rows.map((r) => r.id);
}
