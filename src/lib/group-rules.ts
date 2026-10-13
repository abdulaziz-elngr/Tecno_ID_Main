/**
 * Pure (database-free) rules for Group deletion safety and Subject codes.
 * Kept in their own module so they can be unit tested without Prisma.
 * The database-backed counting lives in ./group-safety.
 *
 * A group is the anchor for students, class sessions, attendance, exams,
 * assignments and subscriptions. Removing it would orphan or hide that
 * history, so deletion is only allowed for a group that has NEVER been used.
 * Anything else must be archived (isActive = false), which keeps every
 * historical record intact and reachable.
 */

export interface GroupDependencyCounts {
  /** Non-deleted students still enrolled (any status) — they point at this group. */
  students: number;
  sessions: number;
  attendance: number;
  exams: number;
  assignments: number;
  subscriptions: number;
}

export type GroupDependencyKey = keyof GroupDependencyCounts;

export interface GroupDeletionVerdict {
  canDelete: boolean;
  /** Dependencies with a non-zero count, in a stable display order. */
  blockers: { key: GroupDependencyKey; count: number }[];
  /** True when only students (no history) block deletion — "move the students" fixes it. */
  onlyStudentsBlock: boolean;
}

const ORDER: GroupDependencyKey[] = [
  "students",
  "sessions",
  "attendance",
  "exams",
  "assignments",
  "subscriptions"
];

/** Pure decision function — unit tested directly. */
export function evaluateGroupDeletion(counts: GroupDependencyCounts): GroupDeletionVerdict {
  const blockers = ORDER.filter((key) => counts[key] > 0).map((key) => ({ key, count: counts[key] }));
  return {
    canDelete: blockers.length === 0,
    blockers,
    onlyStudentsBlock: blockers.length > 0 && blockers.every((b) => b.key === "students")
  };
}

const LABELS: Record<GroupDependencyKey, string> = {
  students: "enrolled students",
  sessions: "class sessions",
  attendance: "attendance records",
  exams: "exams",
  assignments: "assignments",
  subscriptions: "subscriptions"
};

/** Human-readable English explanation used in the API error message. */
export function describeGroupBlockers(verdict: GroupDeletionVerdict): string {
  if (verdict.canDelete) return "";
  const parts = verdict.blockers.map((b) => `${b.count} ${LABELS[b.key]}`).join(", ");
  if (verdict.onlyStudentsBlock) {
    return `This group still has ${parts}. Move the students to another group first, or archive the group instead.`;
  }
  return `This group has history (${parts}) that must be preserved, so it cannot be deleted. Archive it instead — it will be hidden from active use but all records stay intact.`;
}

/** Normalises an optional subject code: trimmed, upper-cased, empty -> null. */
export function normalizeSubjectCode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const cleaned = code.trim().toUpperCase();
  return cleaned === "" ? null : cleaned;
}
