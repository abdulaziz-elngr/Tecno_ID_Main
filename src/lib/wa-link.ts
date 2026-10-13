/**
 * WhatsApp click-to-chat links (https://wa.me/<number>?text=<message>).
 *
 * This is the ONLY WhatsApp integration in the app: staff click a button
 * and WhatsApp opens a chat with the parent. Nothing is ever sent
 * automatically and no WhatsApp Business / Meta API credentials exist.
 *
 * Pure functions, no environment access, so it is safe in client
 * components. Default country code is Egypt ("20").
 */

const DEFAULT_COUNTRY_CODE = "20";

/**
 * Converts Arabic-Indic (٠-٩) and Eastern Arabic-Indic / Persian (۰-۹)
 * digits to ASCII so a number typed on an Arabic keyboard validates and
 * is stored in the same form as one typed on an English keyboard.
 */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Normalizes a phone number to international digits (no "+", no spaces).
 *   01012345678   -> 201012345678
 *   +201012345678 -> 201012345678
 *   00201012345678-> 201012345678
 *   201012345678  -> 201012345678
 *   +2001012345678-> 201012345678   (stray trunk "0" after the country code)
 *   ٠١٠١٢٣٤٥٦٧٨   -> 201012345678   (Arabic-Indic digits)
 * Returns null when the result is not a plausible international number.
 */
export function normalizeWhatsAppNumber(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  if (!raw) return null;
  let digits = toAsciiDigits(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  digits = digits.replace(/\D/g, "");
  // "+20 010…" — people keep the local leading 0 after the country code.
  if (digits.startsWith(`${countryCode}0`)) {
    digits = countryCode + digits.slice(countryCode.length + 1);
  }
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Builds a wa.me link, optionally with a pre-filled message. Null if the number is invalid. */
export function buildWhatsAppLink(
  rawNumber: string | null | undefined,
  text?: string,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  const number = normalizeWhatsAppNumber(rawNumber, countryCode);
  if (!number) return null;
  const base = `https://wa.me/${number}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Converts normalized international digits back to the local dialing form
 * (201012345678 -> 01012345678). Numbers of other countries are returned
 * unchanged.
 */
export function toLocalPhone(
  normalized: string,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string {
  return normalized.startsWith(countryCode) ? `0${normalized.slice(countryCode.length)}` : normalized;
}

/**
 * Every spelling under which the same phone may already be stored
 * (as typed, international digits with/without "+", local form). Used to find an existing
 * Parent row before creating a new one, so "0101…" and "+20101…" do not
 * produce two guardians for the same person.
 */
export function phoneLookupVariants(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string[] {
  const typed = raw ? toAsciiDigits(raw).trim() : "";
  if (!typed) return [];
  const variants = new Set<string>([typed]);
  const normalized = normalizeWhatsAppNumber(typed, countryCode);
  if (normalized) {
    variants.add(normalized);
    variants.add(`+${normalized}`);
    variants.add(toLocalPhone(normalized, countryCode));
  }
  return Array.from(variants);
}
