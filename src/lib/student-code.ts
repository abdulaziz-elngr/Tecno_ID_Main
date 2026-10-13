import { customAlphabet } from "nanoid";
import { db } from "./db";

/**
 * Student barcode / Student ID.
 *
 * New students receive a short, numeric, human-typable code:
 *
 *     YY + 4-digit sequence    ->   260001, 260002, … 269999
 *
 * - YY is the 2-digit enrollment year, so codes restart at 0001 each year
 *   and a printed card tells staff roughly when the student joined.
 * - The sequence only grows past 4 digits after 9,999 enrollments in one
 *   year (2610000 …), which keeps working: uniqueness never depends on width.
 * - Uniqueness is guaranteed by the database (`Student.studentCode @unique`).
 *   The generator below only picks the next free number; the caller retries
 *   on the unique-constraint error if two enrollments race (see
 *   `isStudentCodeConflict`).
 * - Soft-deleted students keep their code reserved (the query below does not
 *   filter `deletedAt`), so a printed card of a removed student can never be
 *   re-issued to someone else.
 *
 * Legacy students keep their existing `STD-XXXXXXXX` code untouched: it is
 * still stored in `studentCode`, still scannable and still printable.
 */

// Unambiguous alphabet (no 0/O, 1/I) — only used for the legacy QR payload now.
const codeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

const MIN_SEQUENCE_DIGITS = 4;
const MAX_CANDIDATE_PROBES = 50;

/** Two-digit enrollment-year prefix, e.g. 2026 -> "26". */
export function yearPrefix(date: Date = new Date()): string {
  return String(date.getUTCFullYear() % 100).padStart(2, "0");
}

/** formatStudentCode("26", 1) -> "260001". */
export function formatStudentCode(prefix: string, sequence: number): string {
  if (!/^\d{2}$/.test(prefix)) {
    throw new Error("Student code prefix must be two digits.");
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Student code sequence must be a positive integer.");
  }
  return `${prefix}${String(sequence).padStart(MIN_SEQUENCE_DIGITS, "0")}`;
}

/** True for codes issued by this generator (digits only, at least 6 long). */
export function isNumericStudentCode(code: string): boolean {
  return /^\d{6,}$/.test(code);
}

/** Highest sequence already issued for a year prefix (0 when none). */
async function lastSequenceForPrefix(prefix: string): Promise<number> {
  const pattern = `^${prefix}[0-9]{${MIN_SEQUENCE_DIGITS},12}$`;
  // The prefix is always 2 characters, hence SUBSTRING … FROM 3.
  const rows = await db.$queryRaw<{ max: bigint | number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("studentCode" FROM 3) AS BIGINT)) AS "max"
    FROM "Student"
    WHERE "studentCode" ~ ${pattern}
  `;
  const max = rows[0]?.max;
  return max === null || max === undefined ? 0 : Number(max);
}

/**
 * Returns the next free numeric student code.
 *
 * `skip` lets a caller that just lost a race jump past the number it
 * collided on, instead of re-reading the same "next" value.
 */
export async function generateStudentCode(skip = 0): Promise<string> {
  const prefix = yearPrefix();
  let sequence = (await lastSequenceForPrefix(prefix)) + 1 + skip;

  for (let probe = 0; probe < MAX_CANDIDATE_PROBES; probe++, sequence++) {
    const candidate = formatStudentCode(prefix, sequence);
    // Also check qrCode: new students store the same value there.
    const taken = await db.student.findFirst({
      where: { OR: [{ studentCode: candidate }, { qrCode: candidate }] },
      select: { id: true }
    });
    if (!taken) return candidate;
  }
  throw new Error("Could not generate a unique student code, please retry.");
}

/**
 * True when a Prisma error is the unique-constraint violation (P2002) on the
 * student barcode columns — i.e. another enrollment took the same number
 * between our read and our insert. Duck-typed so this module stays free of
 * Prisma runtime imports.
 */
export function isStudentCodeConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.some((f) => f.includes("studentCode") || f.includes("qrCode"));
}

/**
 * @deprecated The QR code was replaced by the printed barcode. New students
 * store their (numeric) `studentCode` in `qrCode` as well so the two columns
 * can never disagree. Kept for `prisma/seed.ts` and for the legacy
 * `/api/students/[id]/qr` endpoint; scanning still matches old payloads.
 */
export function buildQrPayload(studentCode: string): string {
  // The QR/barcode encodes the student code plus a short random
  // suffix so the printed code itself isn't trivially guessable
  // from a sequential Student ID.
  return `TECNOID:${studentCode}:${codeAlphabet()}`;
}
