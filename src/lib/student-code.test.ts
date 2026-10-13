import { describe, it, expect } from "vitest";
import {
  buildQrPayload,
  formatStudentCode,
  isNumericStudentCode,
  isStudentCodeConflict,
  yearPrefix
} from "./student-code";

describe("buildQrPayload", () => {
  it("embeds the student code and a namespaced prefix", () => {
    const payload = buildQrPayload("STD-ABC12345");
    expect(payload.startsWith("TECNOID:STD-ABC12345:")).toBe(true);
  });

  it("produces different payloads for the same code on repeated calls (unguessable suffix)", () => {
    const a = buildQrPayload("STD-ABC12345");
    const b = buildQrPayload("STD-ABC12345");
    expect(a).not.toBe(b);
  });
});

describe("numeric student barcode format", () => {
  it("builds YY + 4-digit sequence", () => {
    expect(formatStudentCode("26", 1)).toBe("260001");
    expect(formatStudentCode("26", 42)).toBe("260042");
    expect(formatStudentCode("26", 9999)).toBe("269999");
  });
  it("keeps working past 9,999 enrollments in a year (width grows, uniqueness holds)", () => {
    expect(formatStudentCode("26", 10000)).toBe("2610000");
  });
  it("derives the prefix from the year", () => {
    expect(yearPrefix(new Date(Date.UTC(2026, 5, 1)))).toBe("26");
    expect(yearPrefix(new Date(Date.UTC(2005, 0, 1)))).toBe("05");
  });
  it("rejects invalid prefix or sequence", () => {
    expect(() => formatStudentCode("6", 1)).toThrow();
    expect(() => formatStudentCode("26", 0)).toThrow();
    expect(() => formatStudentCode("26", 1.5)).toThrow();
  });
  it("only produces numbers-only codes of at least 6 digits", () => {
    expect(isNumericStudentCode("260001")).toBe(true);
    expect(isNumericStudentCode("2610000")).toBe(true);
    expect(isNumericStudentCode("STD-ABC12345")).toBe(false);
    expect(isNumericStudentCode("26001")).toBe(false);
  });
});

describe("isStudentCodeConflict", () => {
  it("recognises a P2002 on the barcode columns", () => {
    expect(isStudentCodeConflict({ code: "P2002", meta: { target: ["studentCode"] } })).toBe(true);
    expect(isStudentCodeConflict({ code: "P2002", meta: { target: "Student_qrCode_key" } })).toBe(true);
  });
  it("ignores other errors and other unique violations", () => {
    expect(isStudentCodeConflict({ code: "P2002", meta: { target: ["phone"] } })).toBe(false);
    expect(isStudentCodeConflict({ code: "P2025" })).toBe(false);
    expect(isStudentCodeConflict(new Error("boom"))).toBe(false);
    expect(isStudentCodeConflict(null)).toBe(false);
  });
});
