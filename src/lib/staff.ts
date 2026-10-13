import { z } from "zod";
import { toAsciiDigits } from "./wa-link";

/**
 * Validation + pure helpers shared by the Teachers/Assistants and Employees
 * endpoints AND their pages (no server imports here, so it is safe in client
 * components — the browser and the API run exactly the same rules).
 */

export const STAFF_PHONE_INVALID = "Enter a valid phone number, e.g. 01012345678 or +201012345678.";
export const STAFF_EMAIL_INVALID = "Enter a valid email address.";

/**
 * Normalizes a contact phone for storage: Arabic-Indic digits become ASCII,
 * spaces/dashes/dots/parentheses are dropped, an optional leading "+" is kept.
 * Returns null when the result is not 6-15 digits. (A contact phone is NOT
 * forced into international format — staff phones are only displayed/searched;
 * WhatsApp links are built elsewhere with `buildWhatsAppLink`.)
 */
export function normalizeStaffPhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = toAsciiDigits(raw).trim().replace(/[\s\-().]/g, "");
  return /^\+?\d{6,15}$/.test(cleaned) ? cleaned : null;
}

/** string -> trimmed string, "" -> null, undefined stays undefined (= "leave unchanged"). */
function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Optional phone. "" / null clear the column; anything else must pass normalizeStaffPhone. */
export const optionalPhoneSchema = z
  .string()
  .max(40, STAFF_PHONE_INVALID)
  .nullable()
  .optional()
  .transform((value, ctx): string | null | undefined => {
    const v = blankToNull(value);
    if (v === undefined || v === null) return v;
    const normalized = normalizeStaffPhone(v);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: STAFF_PHONE_INVALID });
      return z.NEVER;
    }
    return normalized;
  });

/** Optional email. "" / null clear the column; anything else must be a valid address (stored lowercase). */
export const optionalEmailSchema = z
  .string()
  .max(200, STAFF_EMAIL_INVALID)
  .nullable()
  .optional()
  .transform((value, ctx): string | null | undefined => {
    const v = blankToNull(value);
    if (v === undefined || v === null) return v;
    if (!z.string().email().safeParse(v).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: STAFF_EMAIL_INVALID });
      return z.NEVER;
    }
    return v.toLowerCase();
  });

export const fullNameSchema = z.string().trim().min(2).max(200);

/** De-duplicated list of group ids (a repeated id must never produce two assignments). */
export const groupIdsSchema = z
  .array(z.string().uuid())
  .max(100)
  .transform((ids) => Array.from(new Set(ids)));

export const teacherCreateSchema = z.object({
  branchId: z.string().uuid(),
  fullName: fullNameSchema,
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  isAssistant: z.boolean().default(false),
  /** Groups this teacher (or assistant) is responsible for. */
  groupIds: groupIdsSchema.default([]),
  /** Explicit confirmation to take groups away from another teacher. */
  allowReassign: z.boolean().default(false)
});

/** `isAssistant` and `branchId` are deliberately not editable (they decide which group column is used). */
export const teacherUpdateSchema = z.object({
  fullName: fullNameSchema.optional(),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  isActive: z.boolean().optional(),
  /** Omit = leave assignments untouched. [] = remove every group. */
  groupIds: groupIdsSchema.optional(),
  allowReassign: z.boolean().optional()
});

export const deleteReasonSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

export interface IdDiff {
  toAdd: string[];
  toRemove: string[];
  unchanged: string[];
}

/** Difference between the current and the requested id sets (order-independent, duplicate-safe). */
export function diffIds(current: readonly string[], next: readonly string[]): IdDiff {
  const cur = new Set(current);
  const nxt = new Set(next);
  return {
    toAdd: Array.from(nxt).filter((id) => !cur.has(id)),
    toRemove: Array.from(cur).filter((id) => !nxt.has(id)),
    unchanged: Array.from(cur).filter((id) => nxt.has(id))
  };
}

/**
 * Optional hire date. Accepts "YYYY-MM-DD" (the <input type="date"> value) or
 * a full ISO datetime. "" / null clear it; undefined leaves it unchanged.
 * Output is a Date (stored at UTC midnight for plain dates) or null.
 */
export const hireDateSchema = z
  .string()
  .max(40)
  .nullable()
  .optional()
  .transform((value, ctx): Date | null | undefined => {
    const v = blankToNull(value);
    if (v === undefined || v === null) return v;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : new Date(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid hire date." });
      return z.NEVER;
    }
    return date;
  });
