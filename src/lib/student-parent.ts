import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { isParentSharedWithOtherOrg, upsertParentForOrg } from "./scope";
import { normalizeWhatsAppNumber, phoneLookupVariants, toLocalPhone } from "./wa-link";

/**
 * Student <-> Parent ("guardian") rules shared by the create and edit
 * endpoints, so both enforce exactly the same thing.
 *
 * Data model (unchanged): `Parent` is a global row with a unique `phone` and
 * an optional `whatsappNumber`; `StudentParent` links it to a student. The
 * WhatsApp chat URL is NEVER stored — only the number — and is built where
 * it is needed with `buildWhatsAppLink()` (src/lib/wa-link.ts).
 *
 * The parent's WhatsApp number is REQUIRED whenever a student is created.
 * It is stored as international digits (201012345678) so every existing
 * `buildWhatsAppLink(parent.whatsappNumber || parent.phone)` call yields a
 * valid wa.me link no matter how the number was typed.
 */

type Client = Prisma.TransactionClient | typeof db;

export const WHATSAPP_REQUIRED_MESSAGE = "Parent WhatsApp number is required.";
export const WHATSAPP_INVALID_MESSAGE =
  "Enter a valid WhatsApp number, e.g. 01012345678 or +201012345678.";

/** Required + valid. Same check (normalizeWhatsAppNumber) the form runs in the browser. */
export const parentWhatsappSchema = z
  .string({ required_error: WHATSAPP_REQUIRED_MESSAGE, invalid_type_error: WHATSAPP_INVALID_MESSAGE })
  .trim()
  .min(1, WHATSAPP_REQUIRED_MESSAGE)
  .max(30, WHATSAPP_INVALID_MESSAGE)
  .refine((value) => normalizeWhatsAppNumber(value) !== null, WHATSAPP_INVALID_MESSAGE);

/** Converts a value that already passed `parentWhatsappSchema` to its stored form. */
export function toStoredWhatsappNumber(validated: string): string {
  const normalized = normalizeWhatsAppNumber(validated);
  if (!normalized) throw new GuardianInputError(WHATSAPP_INVALID_MESSAGE);
  return normalized;
}

/** A guardian-related input problem; routes turn it into a 400 with a field error. */
export class GuardianInputError extends Error {
  field: "parentWhatsappNumber" | "parentName" | "parentPhone";
  constructor(message: string, field: GuardianInputError["field"] = "parentWhatsappNumber") {
    super(message);
    this.name = "GuardianInputError";
    this.field = field;
  }
}

/**
 * True for the unique-constraint error (P2002) on `Parent.phone`: two
 * enrollments for the same brand-new guardian ran at the same moment. A retry
 * finds the row the other request just created and links to it.
 */
export function isParentPhoneConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.some((f) => f.includes("phone"));
}

export interface GuardianInput {
  fullName?: string;
  /** Guardian's phone as typed; defaults to the WhatsApp number when omitted. */
  phone?: string;
  /** Already normalized (see toStoredWhatsappNumber). */
  whatsappNumber: string;
}

/**
 * Finds or creates the Parent for a new student link, without creating a
 * duplicate when the same person already exists under another spelling of
 * the same number ("0101…", "+20101…", "20101…").
 */
export async function upsertGuardian(client: Client, organizationId: string, input: GuardianInput) {
  const typedPhone = input.phone?.trim() || undefined;
  const variants = phoneLookupVariants(typedPhone ?? input.whatsappNumber);

  let existing =
    variants.length > 0
      ? await client.parent.findFirst({ where: { phone: { in: variants } }, select: { phone: true } })
      : null;

  // No separate guardian phone given: a sibling's guardian may already be
  // stored with this same WhatsApp number.
  if (!existing && !typedPhone && variants.length > 0) {
    existing = await client.parent.findFirst({
      where: { whatsappNumber: { in: variants } },
      select: { phone: true }
    });
  }

  const phone = existing?.phone ?? typedPhone ?? toLocalPhone(input.whatsappNumber);

  return upsertParentForOrg(client, organizationId, {
    phone,
    fullName: input.fullName,
    whatsappNumber: input.whatsappNumber
  });
}

export interface GuardianUpdateInput {
  fullName?: string;
  /** Only used when the student has no guardian yet; an existing guardian's phone is not edited here. */
  phone?: string;
  /** Already normalized. */
  whatsappNumber?: string;
}

interface GuardianSnapshot {
  id: string;
  fullName: string;
  phone: string;
  whatsappNumber: string | null;
}

/**
 * Applies guardian fields from the student edit form.
 *
 *  - student has a guardian  -> that Parent row is updated in place
 *    (siblings share it, so they see the new number too — which is the point);
 *  - no guardian yet         -> one is found/created and linked as primary;
 *  - guardian shared with another organization -> never rewritten (see
 *    scope.ts); asking for a different value is reported instead of silently
 *    ignored;
 *  - the guardian must end up with a WhatsApp number.
 */
export async function applyGuardianUpdate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  studentId: string,
  input: GuardianUpdateInput
): Promise<{ before: GuardianSnapshot | null; after: GuardianSnapshot }> {
  const link = await tx.studentParent.findFirst({
    where: { studentId },
    orderBy: { isPrimary: "desc" },
    include: { parent: true }
  });

  if (!link) {
    if (!input.whatsappNumber) throw new GuardianInputError(WHATSAPP_REQUIRED_MESSAGE);
    const parent = await upsertGuardian(tx, organizationId, {
      fullName: input.fullName,
      phone: input.phone,
      whatsappNumber: input.whatsappNumber
    });
    await tx.studentParent.upsert({
      where: { studentId_parentId: { studentId, parentId: parent.id } },
      update: { isPrimary: true },
      create: { studentId, parentId: parent.id, relationship: "Guardian", isPrimary: true }
    });
    return { before: null, after: snapshot(parent) };
  }

  const current = link.parent;
  const before = snapshot(current);
  if (!input.whatsappNumber && !current.whatsappNumber) {
    throw new GuardianInputError(WHATSAPP_REQUIRED_MESSAGE);
  }

  const nameChanged = input.fullName !== undefined && input.fullName !== current.fullName;
  const whatsappChanged = input.whatsappNumber !== undefined && input.whatsappNumber !== current.whatsappNumber;
  if (!nameChanged && !whatsappChanged) {
    return { before, after: before };
  }

  if (await isParentSharedWithOtherOrg(current.id, organizationId, tx)) {
    throw new GuardianInputError(
      "This guardian is also registered at another center, so their contact details cannot be changed here."
    );
  }

  const updated = await tx.parent.update({
    where: { id: current.id },
    data: {
      fullName: nameChanged ? input.fullName : undefined,
      whatsappNumber: whatsappChanged ? input.whatsappNumber : undefined
    }
  });
  return { before, after: snapshot(updated) };
}

function snapshot(parent: GuardianSnapshot): GuardianSnapshot {
  return {
    id: parent.id,
    fullName: parent.fullName,
    phone: parent.phone,
    whatsappNumber: parent.whatsappNumber
  };
}
