import { encodeCode128 } from "@/lib/barcode";

/**
 * Printable Code 128 barcode for a student's barcode value.
 *
 * - Vector SVG: stays sharp at any print size and on thermal printers.
 * - Always black bars on a white background with the symbology's quiet
 *   zones, regardless of the light/dark theme — scanners need that contrast.
 * - The value is printed in digits underneath so staff can type it by hand.
 * - Width follows the container (bars scale proportionally, never distort
 *   relative to each other); height is fixed.
 */
export function Barcode({
  value,
  height = 44,
  showText = true,
  invalidLabel = "Barcode unavailable",
  className = ""
}: {
  value: string;
  height?: number;
  showText?: boolean;
  /** Shown instead of the bars if the value cannot be encoded. */
  invalidLabel?: string;
  className?: string;
}) {
  let symbol: ReturnType<typeof encodeCode128> | null = null;
  try {
    symbol = encodeCode128(value);
  } catch {
    symbol = null;
  }

  if (!symbol) {
    return (
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
        {invalidLabel}
      </p>
    );
  }

  return (
    <figure className={`m-0 flex w-full flex-col items-center rounded bg-white px-1 py-1 text-black ${className}`}>
      <svg
        viewBox={`0 0 ${symbol.width} 1`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Barcode ${value}`}
      >
        <rect x={0} y={0} width={symbol.width} height={1} fill="#ffffff" />
        {symbol.bars.map((bar) => (
          <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={1} fill="#000000" />
        ))}
      </svg>
      {showText && (
        <figcaption dir="ltr" className="mt-0.5 font-mono text-[11px] font-semibold leading-none tracking-[0.25em]">
          {value}
        </figcaption>
      )}
    </figure>
  );
}
