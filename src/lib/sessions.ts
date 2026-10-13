import { db } from "./db";
import type { DayOfWeek } from "@prisma/client";
import { DEFAULT_TIME_ZONE, sessionStartInstant } from "./tz";

/**
 * Turns recurring weekly Schedule rows into concrete, dated
 * ClassSession rows (spec §16).
 *
 * Generation is idempotent: ClassSession has a unique constraint on
 * (groupId, date, startMinutes) and we use `skipDuplicates`, so running
 * the generator twice for the same window never creates doubles.
 */

const DAY_INDEX: DayOfWeek[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY"
];

export function dayOfWeekFromDate(date: Date): DayOfWeek {
  // getUTCDay() always returns 0–6, which is always a valid index into
  // DAY_INDEX (7 entries), so the non-null assertion is safe here.
  return DAY_INDEX[date.getUTCDay()]!;
}

/** Returns a UTC-midnight Date, which is what `@db.Date` columns store. */
export function toDateOnly(value: Date | string): Date {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function eachDayInRange(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cursor = toDateOnly(from);
  const end = toDateOnly(to);
  // Hard cap so an accidental 10-year range can't lock up the database.
  let guard = 0;
  while (cursor <= end && guard < 400) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return days;
}

export interface GenerateSessionsParams {
  organizationId: string;
  /** Branch scope: undefined means "all branches in the organization". */
  branchIds?: string[];
  from: Date;
  to: Date;
  groupId?: string;
}

export interface GenerateSessionsResult {
  created: number;
  skipped: number;
  daysCovered: number;
}

export async function generateSessions(
  params: GenerateSessionsParams
): Promise<GenerateSessionsResult> {
  const days = eachDayInRange(params.from, params.to);
  if (days.length === 0) return { created: 0, skipped: 0, daysCovered: 0 };

  const schedules = await db.schedule.findMany({
    where: {
      isActive: true,
      ...(params.groupId ? { groupId: params.groupId } : {}),
      group: {
        isActive: true,
        deletedAt: null,
        branch: {
          deletedAt: null,
          center: { organizationId: params.organizationId },
          ...(params.branchIds ? { id: { in: params.branchIds } } : {})
        }
      }
    },
    include: {
      group: {
        select: {
          id: true,
          branchId: true,
          teacherId: true,
          assistantId: true
        }
      }
    }
  });

  if (schedules.length === 0) return { created: 0, skipped: 0, daysCovered: days.length };

  const rows: {
    organizationId: string;
    branchId: string;
    groupId: string;
    scheduleId: string;
    teacherId: string | null;
    assistantId: string | null;
    date: Date;
    startMinutes: number;
    endMinutes: number;
  }[] = [];

  for (const day of days) {
    const dow = dayOfWeekFromDate(day);
    for (const schedule of schedules) {
      if (schedule.dayOfWeek !== dow) continue;
      rows.push({
        organizationId: params.organizationId,
        branchId: schedule.group.branchId,
        groupId: schedule.groupId,
        scheduleId: schedule.id,
        teacherId: schedule.group.teacherId,
        assistantId: schedule.group.assistantId,
        date: day,
        startMinutes: schedule.startMinutes,
        endMinutes: schedule.endMinutes
      });
    }
  }

  if (rows.length === 0) return { created: 0, skipped: 0, daysCovered: days.length };

  const result = await db.classSession.createMany({ data: rows, skipDuplicates: true });

  return {
    created: result.count,
    skipped: rows.length - result.count,
    daysCovered: days.length
  };
}

/**
 * Minutes elapsed since a session's scheduled start, at `now` (can be
 * negative before the start). Start time is local wall-clock time of the
 * centre, so it is converted with the centre's time zone — see tz.ts.
 */
export function minutesAfterStart(
  sessionDate: Date,
  startMinutes: number,
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE
): number {
  const start = sessionStartInstant(sessionDate, startMinutes, timeZone);
  return Math.round((now.getTime() - start.getTime()) / 60000);
}
