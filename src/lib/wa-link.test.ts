import { describe, expect, it } from "vitest";
import {
  buildWhatsAppLink,
  normalizeWhatsAppNumber,
  phoneLookupVariants,
  toAsciiDigits,
  toLocalPhone
} from "./wa-link";

describe("normalizeWhatsAppNumber (Egypt)", () => {
  it("converts a local mobile number to international format", () => {
    expect(normalizeWhatsAppNumber("01012345678")).toBe("201012345678");
  });
  it("accepts +20, 0020 and already-international forms", () => {
    expect(normalizeWhatsAppNumber("+201012345678")).toBe("201012345678");
    expect(normalizeWhatsAppNumber("00201012345678")).toBe("201012345678");
    expect(normalizeWhatsAppNumber("201012345678")).toBe("201012345678");
  });
  it("ignores spaces, dashes and parentheses", () => {
    expect(normalizeWhatsAppNumber("010 1234-5678")).toBe("201012345678");
    expect(normalizeWhatsAppNumber("(+20) 10 1234 5678")).toBe("201012345678");
  });
  it("rejects empty or implausible numbers", () => {
    expect(normalizeWhatsAppNumber("")).toBeNull();
    expect(normalizeWhatsAppNumber(null)).toBeNull();
    expect(normalizeWhatsAppNumber("123")).toBeNull();
    expect(normalizeWhatsAppNumber("abc")).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("builds a plain wa.me link", () => {
    expect(buildWhatsAppLink("01012345678")).toBe("https://wa.me/201012345678");
  });
  it("adds a URL-encoded pre-filled message", () => {
    expect(buildWhatsAppLink("01012345678", "Hello & مرحبا")).toBe(
      `https://wa.me/201012345678?text=${encodeURIComponent("Hello & مرحبا")}`
    );
  });
  it("returns null for an invalid number instead of a broken link", () => {
    expect(buildWhatsAppLink("xx")).toBeNull();
  });
});

describe("normalizeWhatsAppNumber (Arabic digits and common typing mistakes)", () => {
  it("accepts Arabic-Indic and Persian digits", () => {
    expect(toAsciiDigits("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(toAsciiDigits("۰۱۰۱۲۳۴۵۶۷۸")).toBe("01012345678");
    expect(normalizeWhatsAppNumber("٠١٠١٢٣٤٥٦٧٨")).toBe("201012345678");
    expect(normalizeWhatsAppNumber("+٢٠ ١٠ ١٢٣٤ ٥٦٧٨")).toBe("201012345678");
  });
  it("drops the stray trunk 0 after the country code (+20 010…)", () => {
    expect(normalizeWhatsAppNumber("+2001012345678")).toBe("201012345678");
    expect(normalizeWhatsAppNumber("002001012345678")).toBe("201012345678");
  });
  it("still rejects clearly invalid input", () => {
    expect(normalizeWhatsAppNumber("+20")).toBeNull();
    expect(normalizeWhatsAppNumber("12 34")).toBeNull();
  });
  it("keeps numbers of other countries intact", () => {
    expect(normalizeWhatsAppNumber("+447911123456")).toBe("447911123456");
  });
});

describe("toLocalPhone / phoneLookupVariants", () => {
  it("converts Egyptian international digits to the local form", () => {
    expect(toLocalPhone("201012345678")).toBe("01012345678");
    expect(toLocalPhone("447911123456")).toBe("447911123456");
  });
  it("returns every spelling a phone may be stored under, without duplicates", () => {
    expect(phoneLookupVariants("+201012345678").sort()).toEqual(
      ["+201012345678", "01012345678", "201012345678"].sort()
    );
    // a guardian saved as "+2010…" must be found from a number typed as "010…"
    expect(phoneLookupVariants("01012345678").sort()).toEqual(
      ["+201012345678", "01012345678", "201012345678"].sort()
    );
  });
  it("returns an empty list for empty input and just the typed value for unparseable input", () => {
    expect(phoneLookupVariants("")).toEqual([]);
    expect(phoneLookupVariants(undefined)).toEqual([]);
    expect(phoneLookupVariants("abc")).toEqual(["abc"]);
  });
});
