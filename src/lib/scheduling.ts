import { db } from "./db";
import type { DayOfWeek } from "@prisma/client";

/**
 * Scheduling conflict rules (spec §4):
 *   - A teacher cannot be assigned to two groups at the same time.
 *   - A group cannot have overlapping/duplicate weekly schedules with
 *     itself.
 *
 * There is no Room concept anywhere in this system — group capacity
 * is the only capacity that exists, and scheduling conflicts are
 * purely about the group itself and its assigned teacher.
 *
 * The overlap test itself is a pure function (easy to unit test
 * exhaustively without a database); `findScheduleConflicts` wraps it
 * with the actual DB queries needed to check it against real data.
 */

export interface TimeRange {
  dayOfWeek: DayOfWeek;
  startMinutes: number;
  endMinutes: number;
}

/** Half-open interval overlap: [aStart, aEnd) intersects [bStart, bEnd). */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export function isValidTimeRange(startMinutes: number, endMinutes: number): boolean {
  return (
    Number.isInteger(startMinutes) &&
    Number.isInteger(endMinutes) &&
    startMinutes >= 0 &&
    endMinutes <= 24 * 60 &&
    startMinutes < endMinutes
  );
}

export interface ScheduleConflictInput extends TimeRange {
  groupId: string;
  teacherId: string | null;
  assistantId: string | null;
  /** When updating an existing schedule row, exclude it from the conflict check. */
  excludeScheduleId?: string;
}

export interface ScheduleConflict {
  type: "TEACHER" | "GROUP";
  scheduleId: string;
  groupId: string;
  groupName: string;
}

export async function findScheduleConflicts(
  input: ScheduleConflictInput
): Promise<ScheduleConflict[]> {
  const candidate: TimeRange = {
    dayOfWeek: input.dayOfWeek,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes
  };

  // Pull every active schedule on the same day that could plausibly
  // overlap (same group OR same teacher/assistant), then do the
  // precise overlap test in application code. Narrowing by day keeps
  // this cheap even with a large schedule table.
  const candidates = await db.schedule.findMany({
    where: {
      dayOfWeek: input.dayOfWeek,
      isActive: true,
      ...(input.excludeScheduleId ? { id: { not: input.excludeScheduleId } } : {}),
      OR: [
        { groupId: input.groupId },
        ...(input.teacherId
          ? [{ group: { teacherId: input.teacherId } }, { group: { assistantId: input.teacherId } }]
          : []),
        ...(input.assistantId
          ? [{ group: { teacherId: input.assistantId } }, { group: { assistantId: input.assistantId } }]
          : [])
      ]
    },
    include: { group: { select: { id: true, name: true, teacherId: true, assistantId: true } } }
  });

  const conflicts: ScheduleConflict[] = [];

  for (const existing of candidates) {
    const existingRange: TimeRange = {
      dayOfWeek: existing.dayOfWeek,
      startMinutes: existing.startMinutes,
      endMinutes: existing.endMinutes
    };
    if (!rangesOverlap(candidate, existingRange)) continue;

    if (existing.groupId === input.groupId) {
      conflicts.push({
        type: "GROUP",
        scheduleId: existing.id,
        groupId: existing.groupId,
        groupName: existing.group.name
      });
      continue;
    }
    const teacherIds = [input.teacherId, input.assistantId].filter(Boolean);
    const existingTeacherIds = [existing.group.teacherId, existing.group.assistantId].filter(Boolean);
    if (teacherIds.some((id) => existingTeacherIds.includes(id))) {
      conflicts.push({
        type: "TEACHER",
        scheduleId: existing.id,
        groupId: existing.groupId,
        groupName: existing.group.name
      });
    }
  }

  return conflicts;
}
