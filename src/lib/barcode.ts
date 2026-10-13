/**
 * Code 128 barcode encoder (ISO/IEC 15417) — dependency free, pure functions.
 *
 * Why Code 128: it is what USB/Bluetooth scanner guns and thermal label
 * printers read out of the box, it is compact, and it encodes digits
 * two-per-symbol (Code Set C) so a 6-digit student barcode stays short
 * enough to print legibly on a 40 mm label.
 *
 * Output is geometry only (bars in "module" units); rendering lives in
 * src/components/Barcode.tsx. Nothing here touches the DOM or the network,
 * so it is safe in client components and trivially unit-testable.
 */

/** Bar/space widths (in modules) for symbol values 0–106. Alternates bar, space, bar… */
export const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222",
  "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221",
  "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131",
  "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124",
  "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111",
  "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141",
  "411131", "211412", "211214", "211232", "2331112"
];

export const CODE128_START_B = 104;
export const CODE128_START_C = 105;
export const CODE128_CODE_B = 100; // "Code B" shift, valid from Code Set C
export const CODE128_STOP = 106;

/** Minimum quiet zone required on each side by the symbology (10 modules). */
export const CODE128_QUIET_ZONE = 10;

export interface Code128Bar {
  /** Offset from the left edge of the symbol (including quiet zone), in modules. */
  x: number;
  /** Width in modules. */
  width: number;
}

export interface Code128Symbol {
  /** Symbol character values: start, data…, checksum, stop. */
  values: number[];
  bars: Code128Bar[];
  /** Total width in modules, including both quiet zones. */
  width: number;
}

/**
 * Chooses Code Set C for all-digit values of 4+ digits (two digits per
 * symbol — this is what keeps "260001" to 3 data symbols) and Code Set B
 * (printable ASCII 32–126) for everything else, e.g. legacy "STD-AB12CD34".
 */
export function code128Values(value: string): number[] {
  if (value.length === 0) {
    throw new Error("Cannot encode an empty barcode value.");
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error("Barcode value contains a character Code 128 (set B) cannot encode.");
    }
  }

  let start: number;
  const data: number[] = [];

  if (/^\d{4,}$/.test(value)) {
    start = CODE128_START_C;
    const pairs = Math.floor(value.length / 2);
    for (let i = 0; i < pairs; i++) {
      data.push(parseInt(value.slice(i * 2, i * 2 + 2), 10));
    }
    if (value.length % 2 === 1) {
      // Odd digit count: the last digit has no partner, so drop to Code Set B for it.
      data.push(CODE128_CODE_B);
      data.push(value.charCodeAt(value.length - 1) - 32);
    }
  } else {
    start = CODE128_START_B;
    for (let i = 0; i < value.length; i++) {
      data.push(value.charCodeAt(i) - 32);
    }
  }

  let checksum = start;
  data.forEach((v, i) => {
    checksum += v * (i + 1);
  });
  checksum %= 103;

  return [start, ...data, checksum, CODE128_STOP];
}

/** Encodes a value into bar geometry measured in modules. */
export function encodeCode128(value: string, quietZone: number = CODE128_QUIET_ZONE): Code128Symbol {
  const values = code128Values(value);
  const bars: Code128Bar[] = [];
  let x = quietZone;

  for (const symbolValue of values) {
    const pattern = CODE128_PATTERNS[symbolValue]!;
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern.charCodeAt(i) - 48;
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }

  return { values, bars, width: x + quietZone };
}
