import { describe, it, expect } from "vitest";
import {
  CODE128_PATTERNS,
  CODE128_QUIET_ZONE,
  CODE128_STOP,
  code128Values,
  encodeCode128,
  type Code128Symbol
} from "./barcode";

/**
 * Independent decoder used only by the tests: it rebuilds the bar/space run
 * lengths from the rendered geometry, looks each 6-element group up in the
 * pattern table, verifies the checksum and returns the decoded text — i.e.
 * what a scanner would read from the printed bars.
 */
function decodeSymbol(symbol: Code128Symbol, quietZone = CODE128_QUIET_ZONE): string {
  const elements: number[] = [];
  let cursor = quietZone;
  for (const bar of symbol.bars) {
    if (bar.x > cursor) elements.push(bar.x - cursor); // space
    elements.push(bar.width); // bar
    cursor = bar.x + bar.width;
  }
  expect(symbol.width).toBe(cursor + quietZone);

  const values: number[] = [];
  let i = 0;
  while (elements.length - i > 7) {
    const pattern = elements.slice(i, i + 6).join("");
    const value = CODE128_PATTERNS.indexOf(pattern);
    expect(value).toBeGreaterThanOrEqual(0);
    values.push(value);
    i += 6;
  }
  expect(elements.slice(i).join("")).toBe(CODE128_PATTERNS[CODE128_STOP]);

  const [start, ...rest] = values;
  const checksum = rest.pop()!;
  let sum = start!;
  rest.forEach((v, idx) => (sum += v * (idx + 1)));
  expect(sum % 103).toBe(checksum);

  let set: "B" | "C" = start === 105 ? "C" : "B";
  let text = "";
  for (const v of rest) {
    if (set === "C") {
      if (v === 100) set = "B";
      else text += String(v).padStart(2, "0");
    } else if (v === 99) {
      set = "C";
    } else {
      text += String.fromCharCode(v + 32);
    }
  }
  return text;
}

describe("Code 128 pattern table", () => {
  it("has 107 entries (0–105 data/start, 106 stop)", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });
  it("every symbol is 11 modules wide (stop is 13) and patterns are unique", () => {
    CODE128_PATTERNS.forEach((p, i) => {
      const width = p.split("").reduce((sum, d) => sum + Number(d), 0);
      expect(width).toBe(i === 106 ? 13 : 11);
    });
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });
  it("all data symbols have even bar parity (a built-in Code 128 invariant)", () => {
    for (let i = 0; i < 106; i++) {
      const p = CODE128_PATTERNS[i]!;
      expect((Number(p[0]) + Number(p[2]) + Number(p[4])) % 2).toBe(0);
    }
  });
});

describe("code128Values", () => {
  it("uses Code Set C for numeric barcodes: 260001 -> START_C, 26, 00, 01, checksum, STOP", () => {
    // checksum = (105 + 26*1 + 0*2 + 1*3) % 103 = 31
    expect(code128Values("260001")).toEqual([105, 26, 0, 1, 31, 106]);
  });
  it("uses Code Set B for alphanumeric legacy codes", () => {
    const values = code128Values("STD-AB12CD34");
    expect(values[0]).toBe(104);
    expect(values[values.length - 1]).toBe(106);
    expect(values).toHaveLength(1 + 12 + 1 + 1);
  });
  it("switches to Code Set B for the trailing digit of an odd-length numeric value", () => {
    // 2600015 -> C: 26 00 01, then CODE_B, '5' (value 21)
    const values = code128Values("2600015");
    expect(values.slice(0, 6)).toEqual([105, 26, 0, 1, 100, 21]);
  });
  it("keeps very short numeric values in Code Set B (not worth a set switch)", () => {
    expect(code128Values("123")[0]).toBe(104);
  });
  it("rejects empty and non-encodable input instead of printing a wrong barcode", () => {
    expect(() => code128Values("")).toThrow();
    expect(() => code128Values("طالب")).toThrow();
  });
});

describe("encodeCode128", () => {
  it("round-trips to the original text for numeric, odd numeric and alphanumeric values", () => {
    for (const value of ["260001", "269999", "2610000", "2600015", "123", "STD-AB12CD34", "A"]) {
      expect(decodeSymbol(encodeCode128(value))).toBe(value);
    }
  });
  it("is 68 modules + quiet zones for a 6-digit barcode (compact enough for a 40 mm label)", () => {
    // start(11) + 3 data(33) + checksum(11) + stop(13) = 68
    expect(encodeCode128("260001").width).toBe(68 + 2 * CODE128_QUIET_ZONE);
  });
  it("starts and ends with a bar, bars never overlap and stay inside the quiet zones", () => {
    const symbol = encodeCode128("260001");
    expect(symbol.bars[0]!.x).toBe(CODE128_QUIET_ZONE);
    const last = symbol.bars[symbol.bars.length - 1]!;
    expect(last.x + last.width).toBe(symbol.width - CODE128_QUIET_ZONE);
    for (let i = 1; i < symbol.bars.length; i++) {
      const prev = symbol.bars[i - 1]!;
      expect(symbol.bars[i]!.x).toBeGreaterThan(prev.x + prev.width - 1);
    }
  });
});
