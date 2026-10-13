import { db } from "./db";
import { buildWhatsAppLink, normalizeWhatsAppNumber } from "./wa-link";
import type { MessageLocale } from "./parent-messages";

/**
 * Server-side lookup of the parent/guardian to contact for each student.
 *
 * The click-to-chat link is built HERE and only the finished link is sent to the
 * browser — the parent's raw phone number never appears in these API responses.
 * Pages show "no parent" / "invalid number" instead of a link when it can't be built.
 */

export type ParentIssue = "NO_PARENT" | "INVALID_PHONE";

export interface ParentContact {
  parentName: string | null;
  locale: MessageLocale;
  /** International digits ready for wa.me, or null when there is no usable number. */
  number: string | null;
  issue: ParentIssue | null;
}

export async function loadParentContacts(studentIds: string[]): Promise<Map<string, ParentContact>> {
  const result = new Map<string, ParentContact>();
  if (studentIds.length === 0) return result;

  const rows = await db.studentParent.findMany({
    where: { studentId: { in: studentIds } },
    orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
    select: {
      studentId: true,
      parent: { select: { fullName: true, phone: true, whatsappNumber: true, preferredLanguage: true } }
    }
  });

  for (const row of rows) {
    const number =
      normalizeWhatsAppNumber(row.parent.whatsappNumber) ?? normalizeWhatsAppNumber(row.parent.phone);
    const locale: MessageLocale = row.parent.preferredLanguage === "en" ? "en" : "ar";
    const existing = result.get(row.studentId);
    if (!existing) {
      result.set(row.studentId, {
        parentName: row.parent.fullName,
        locale,
        number,
        issue: number ? null : "INVALID_PHONE"
      });
    } else if (!existing.number && number) {
      // Prefer the first guardian that has a usable number.
      result.set(row.studentId, { parentName: row.parent.fullName, locale, number, issue: null });
    }
  }

  for (const id of studentIds) {
    if (!result.has(id)) result.set(id, { parentName: null, locale: "ar", number: null, issue: "NO_PARENT" });
  }
  return result;
}

/** wa.me link with the prepared text, or null when the parent has no usable number. */
export function whatsappUrl(contact: ParentContact | undefined, text: string): string | null {
  if (!contact?.number) return null;
  return buildWhatsAppLink(contact.number, text);
}
