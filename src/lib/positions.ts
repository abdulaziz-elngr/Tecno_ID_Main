import { z } from "zod";

/**
 * Employee job positions.
 *
 * `Employee.position` already exists in the schema as a free `String?`, so a
 * position is just text. These are SUGGESTED values (shown first in the
 * selector, translated in the UI); any other text is accepted too ("Other"),
 * and positions already used by the organization are offered back as options.
 * That keeps the field extensible without a DB enum or a migration.
 */
export const SUGGESTED_POSITIONS = [
  "Accountant",
  "Receptionist",
  "Administrator",
  "Attendance Officer",
  "Center Manager"
] as const;

export type SuggestedPosition = (typeof SUGGESTED_POSITIONS)[number];

/** i18n keys for the suggested positions (the stored value stays the English canonical text). */
export const POSITION_LABEL_KEYS = {
  Accountant: "employees.position.accountant",
  Receptionist: "employees.position.receptionist",
  Administrator: "employees.position.administrator",
  "Attendance Officer": "employees.position.attendanceOfficer",
  "Center Manager": "employees.position.centerManager"
} as const satisfies Record<SuggestedPosition, string>;

export const POSITION_MAX_LENGTH = 100;

/**
 * Trims, collapses inner whitespace and maps a case-insensitive match of a
 * suggested value to its canonical spelling ("accountant" -> "Accountant").
 * Empty input -> null (= no position).
 */
export function normalizePosition(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  const canonical = SUGGESTED_POSITIONS.find((p) => p.toLowerCase() === collapsed.toLowerCase());
  return canonical ?? collapsed;
}

export function isSuggestedPosition(value: string | null | undefined): value is SuggestedPosition {
  return value !== null && value !== undefined && (SUGGESTED_POSITIONS as readonly string[]).includes(value);
}

/** undefined = leave unchanged, null/"" = clear, text = set. */
export const positionSchema = z
  .string()
  .max(POSITION_MAX_LENGTH * 2)
  .nullable()
  .optional()
  .transform((value, ctx): string | null | undefined => {
    if (value === undefined) return undefined;
    const normalized = normalizePosition(value);
    if (normalized !== null && normalized.length > POSITION_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Position must be at most ${POSITION_MAX_LENGTH} characters.`
      });
      return z.NEVER;
    }
    return normalized;
  });
