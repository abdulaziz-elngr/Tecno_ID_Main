import { describe, expect, it, beforeAll } from "vitest";
import {
  normalizeStudentCodeInput,
  signParentToken,
  verifyParentToken
} from "./parent-portal-auth";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-1234567890";
});

describe("normalizeStudentCodeInput", () => {
  it("converts Arabic digits and trims", () => {
    expect(normalizeStudentCodeInput(" ٢٦٠٠٠١ ")).toBe("260001");
  });
  it("uppercases legacy codes", () => {
    expect(normalizeStudentCodeInput("std-ab12")).toBe("STD-AB12");
  });
});

describe("parent token", () => {
  it("round-trips the student id", async () => {
    const token = await signParentToken("student-1");
    expect(await verifyParentToken(token)).toBe("student-1");
  });
  it("rejects garbage and missing tokens", async () => {
    expect(await verifyParentToken("nope")).toBeNull();
    expect(await verifyParentToken(undefined)).toBeNull();
  });
});
