/**
 * Client-safe formatting helpers for the lesson screens (dates are calendar
 * dates stored at UTC midnight, so everything here reads UTC components —
 * a lesson on "03/10/2026" must never slide to the 2nd or 4th because of the
 * viewer's time zone).
 */

type Loc = "ar" | "en";

function asDate(value: string | Date): Date {
  return typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
}

/** dd/mm/yyyy — the format used in the brief ("Saturday 03/10/2026"). */
export function formatLessonDate(value: string | Date): string {
  const d = asDate(value);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export function weekdayLabel(value: string | Date, locale: Loc): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(
    asDate(value)
  );
}

/** Minutes-from-midnight → "05:00 PM" / "٠٥:٠٠ م" (12-hour clock). */
export function formatMinutes(minutes: number, locale: Loc): string {
  const d = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC"
  }).format(d);
}

export function formatTimeRange(start: number, end: number, locale: Loc): string {
  return `${formatMinutes(start, locale)} – ${formatMinutes(end, locale)}`;
}

/** Time of day of an instant, in the browser's local zone (check-in / arrival times). */
export function formatClock(value: string | Date | null | undefined, locale: Loc): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(d);
}

export function monthLabel(year: number, month: number, locale: Loc): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** "{n} lessons" style interpolation for dictionary strings. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

/** Current year/month as the value of an <input type="month"> ("2026-10"). */
export function parseMonthInput(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

const DAY_INDEX: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6
};

/** Localized weekday name for a DayOfWeek enum value ("SATURDAY" → "السبت"). */
export function dayName(day: string, locale: Loc): string {
  const index = DAY_INDEX[day] ?? 0;
  // 2026-10-04 is a Sunday.
  return weekdayLabel(new Date(Date.UTC(2026, 9, 4 + index)), locale);
}

/**
 * Turns an API failure into a localized sentence: known business-rule codes
 * map to the `err.<CODE>` dictionary entries, anything else falls back to the
 * server's own message.
 */
export function localizeError(
  err: unknown,
  t: (key: never) => string,
  has: (key: string) => boolean
): string {
  const code = (err as { code?: string } | null)?.code;
  if (code && has(`err.${code}`)) return t(`err.${code}` as never);
  return err instanceof Error ? err.message : "Something went wrong.";
}
