import { describe, expect, it } from "vitest";
import {
  diffIds,
  hireDateSchema,
  normalizeStaffPhone,
  optionalEmailSchema,
  optionalPhoneSchema,
  teacherCreateSchema,
  teacherUpdateSchema,
  deleteReasonSchema
} from "./staff";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("normalizeStaffPhone", () => {
  it("keeps plain local and international numbers", () => {
    expect(normalizeStaffPhone("01012345678")).toBe("01012345678");
    expect(normalizeStaffPhone("+201012345678")).toBe("+201012345678");
  });
  it("strips spaces, dashes, dots and parentheses", () => {
    expect(normalizeStaffPhone(" +20 (101) 234-5678 ")).toBe("+201012345678");
    expect(normalizeStaffPhone("0101.234.5678")).toBe("01012345678");
  });
  it("converts Arabic-Indic and Persian digits", () => {
    expect(normalizeStaffPhone("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(normalizeStaffPhone("۰۱۰۱۲۳۴۵۶۷۸")).toBe("01012345678");
  });
  it("rejects letters, too short/long numbers and a misplaced plus", () => {
    expect(normalizeStaffPhone("abc")).toBeNull();
    expect(normalizeStaffPhone("12345")).toBeNull();
    expect(normalizeStaffPhone("1".repeat(16))).toBeNull();
    expect(normalizeStaffPhone("0101+2345678")).toBeNull();
    expect(normalizeStaffPhone(null)).toBeNull();
  });
});

describe("optionalPhoneSchema / optionalEmailSchema", () => {
  it("undefined stays undefined (= leave unchanged); blank/null clear", () => {
    expect(optionalPhoneSchema.parse(undefined)).toBeUndefined();
    expect(optionalPhoneSchema.parse("")).toBeNull();
    expect(optionalPhoneSchema.parse("   ")).toBeNull();
    expect(optionalPhoneSchema.parse(null)).toBeNull();
    expect(optionalEmailSchema.parse("")).toBeNull();
  });
  it("normalizes valid values and rejects invalid ones", () => {
    expect(optionalPhoneSchema.parse("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    expect(optionalPhoneSchema.safeParse("nope").success).toBe(false);
    expect(optionalEmailSchema.parse(" Teacher@Example.COM ")).toBe("teacher@example.com");
    expect(optionalEmailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("teacherCreateSchema", () => {
  const base = { branchId: UUID_A, fullName: "Mona Adel" };

  it("accepts a minimal teacher and applies defaults", () => {
    const parsed = teacherCreateSchema.parse(base);
    expect(parsed.isAssistant).toBe(false);
    expect(parsed.groupIds).toEqual([]);
    expect(parsed.allowReassign).toBe(false);
  });

  it("accepts an empty email string (the old schema rejected it, which broke the form)", () => {
    const parsed = teacherCreateSchema.parse({ ...base, email: "", phone: "" });
    expect(parsed.email).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it("de-duplicates group ids and rejects non-uuids", () => {
    expect(teacherCreateSchema.parse({ ...base, groupIds: [UUID_A, UUID_B, UUID_A] }).groupIds).toEqual([UUID_A, UUID_B]);
    expect(teacherCreateSchema.safeParse({ ...base, groupIds: ["x"] }).success).toBe(false);
  });

  it("requires a branch and a real name", () => {
    expect(teacherCreateSchema.safeParse({ fullName: "Mona Adel" }).success).toBe(false);
    expect(teacherCreateSchema.safeParse({ ...base, fullName: "M" }).success).toBe(false);
  });
});

describe("teacherUpdateSchema", () => {
  it("leaves groupIds undefined when omitted, so assignments are untouched", () => {
    expect(teacherUpdateSchema.parse({ fullName: "New Name" }).groupIds).toBeUndefined();
  });
  it("treats [] as 'remove every group'", () => {
    expect(teacherUpdateSchema.parse({ groupIds: [] }).groupIds).toEqual([]);
  });
  it("does not accept role/branch changes (they are stripped)", () => {
    const parsed = teacherUpdateSchema.parse({ isAssistant: true, branchId: UUID_A, fullName: "Same Name" });
    expect(parsed).not.toHaveProperty("isAssistant");
    expect(parsed).not.toHaveProperty("branchId");
  });
});

describe("deleteReasonSchema", () => {
  it("requires at least 3 non-space characters", () => {
    expect(deleteReasonSchema.safeParse({ reason: "  ab " }).success).toBe(false);
    expect(deleteReasonSchema.safeParse({}).success).toBe(false);
    expect(deleteReasonSchema.safeParse({ reason: "Left the center" }).success).toBe(true);
  });
});

describe("hireDateSchema", () => {
  it("parses a date-input value at UTC midnight and clears on blank", () => {
    expect(hireDateSchema.parse("2024-03-05")?.toISOString()).toBe("2024-03-05T00:00:00.000Z");
    expect(hireDateSchema.parse("")).toBeNull();
    expect(hireDateSchema.parse(undefined)).toBeUndefined();
  });
  it("accepts an ISO datetime and rejects garbage", () => {
    expect(hireDateSchema.parse("2024-03-05T10:00:00.000Z")).toBeInstanceOf(Date);
    expect(hireDateSchema.safeParse("not a date").success).toBe(false);
  });
});

describe("diffIds", () => {
  it("computes the {G2,G3} -> {G1,G4} swap", () => {
    expect(diffIds(["G2", "G3"], ["G1", "G4"])).toEqual({
      toAdd: ["G1", "G4"],
      toRemove: ["G2", "G3"],
      unchanged: []
    });
  });
  it("keeps unchanged ids and ignores order and duplicates", () => {
    expect(diffIds(["G1", "G2"], ["G2", "G3", "G3"])).toEqual({ toAdd: ["G3"], toRemove: ["G1"], unchanged: ["G2"] });
  });
  it("handles empty sets", () => {
    expect(diffIds([], [])).toEqual({ toAdd: [], toRemove: [], unchanged: [] });
    expect(diffIds(["G1"], []).toRemove).toEqual(["G1"]);
  });
});
