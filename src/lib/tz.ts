/**
 * Time-zone helpers.
 *
 * ClassSession.date is a calendar DATE (stored at UTC midnight) and
 * startMinutes/endMinutes are LOCAL wall-clock minutes of the centre
 * (Center.timezone, default Africa/Cairo). To compare them with a real
 * instant such as Attendance.recordedAt, the local start time has to be
 * converted to a UTC instant first — treating "17:00" as 17:00 UTC (what the
 * code did before Stage 2) shifts every lateness calculation by the UTC offset.
 */

export const DEFAULT_TIME_ZONE = "Africa/Cairo";

/** Offset (zone − UTC) in milliseconds that `timeZone` has at the UTC instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock of `timeZone` reads `minutes` on the given calendar day. */
export function zonedMinutesToUtc(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timeZone: string = DEFAULT_TIME_ZONE
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const firstOffset = zoneOffsetMs(guess, timeZone);
  let utc = guess - firstOffset;
  // Re-check once so a DST change between the guess and the real instant is honoured.
  const secondOffset = zoneOffsetMs(utc, timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

/** Instant a session starts: its calendar date (UTC midnight) + local start minutes in `timeZone`. */
export function sessionStartInstant(
  sessionDate: Date,
  startMinutes: number,
  timeZone: string = DEFAULT_TIME_ZONE
): Date {
  return zonedMinutesToUtc(
    sessionDate.getUTCFullYear(),
    sessionDate.getUTCMonth() + 1,
    sessionDate.getUTCDate(),
    startMinutes,
    timeZone
  );
}
