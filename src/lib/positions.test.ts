import { describe, expect, it } from "vitest";
import {
  POSITION_LABEL_KEYS,
  POSITION_MAX_LENGTH,
  SUGGESTED_POSITIONS,
  isSuggestedPosition,
  normalizePosition,
  positionSchema
} from "./positions";

describe("normalizePosition", () => {
  it("maps blanks to null", () => {
    expect(normalizePosition("")).toBeNull();
    expect(normalizePosition("   ")).toBeNull();
    expect(normalizePosition(null)).toBeNull();
    expect(normalizePosition(undefined)).toBeNull();
  });
  it("canonicalises suggested values case-insensitively", () => {
    expect(normalizePosition("accountant")).toBe("Accountant");
    expect(normalizePosition("  ATTENDANCE   officer ")).toBe("Attendance Officer");
  });
  it("keeps custom positions as typed (whitespace collapsed)", () => {
    expect(normalizePosition("  Lab   Technician ")).toBe("Lab Technician");
    expect(normalizePosition("أمين مكتبة")).toBe("أمين مكتبة");
  });
});

describe("positionSchema", () => {
  it("undefined = unchanged, null/'' = clear, text = set", () => {
    expect(positionSchema.parse(undefined)).toBeUndefined();
    expect(positionSchema.parse(null)).toBeNull();
    expect(positionSchema.parse("")).toBeNull();
    expect(positionSchema.parse("receptionist")).toBe("Receptionist");
    expect(positionSchema.parse("Librarian")).toBe("Librarian");
  });
  it("rejects positions longer than the limit", () => {
    expect(positionSchema.safeParse("x".repeat(POSITION_MAX_LENGTH + 1)).success).toBe(false);
    expect(positionSchema.safeParse("x".repeat(POSITION_MAX_LENGTH)).success).toBe(true);
  });
});

describe("suggested positions", () => {
  it("has a translation key for every suggestion", () => {
    for (const p of SUGGESTED_POSITIONS) expect(POSITION_LABEL_KEYS[p]).toMatch(/^employees\.position\./);
  });
  it("isSuggestedPosition only matches the canonical spelling", () => {
    expect(isSuggestedPosition("Accountant")).toBe(true);
    expect(isSuggestedPosition("accountant")).toBe(false);
    expect(isSuggestedPosition(null)).toBe(false);
  });
});
