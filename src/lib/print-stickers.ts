import { encodeCode128 } from "@/lib/barcode";

export interface StickerInput {
  name: string;
  code: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stickerHtml({ name, code }: StickerInput): string {
  let barsSvg = "";
  try {
    const symbol = encodeCode128(code);
    const rects = symbol.bars
      .map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="1" fill="#000"/>`)
      .join("");
    barsSvg = `<svg viewBox="0 0 ${symbol.width} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><rect x="0" y="0" width="${symbol.width}" height="1" fill="#fff"/>${rects}</svg>`;
  } catch {
    barsSvg = "";
  }
  return `<div class="sticker">
      <p class="name" dir="auto">${escapeHtml(name)}</p>
      ${barsSvg}
      <div class="code">${escapeHtml(code)}</div>
    </div>`;
}

/**
 * Prints ONLY the stickers (name + barcode + ID) from a clean, minimal document
 * inside a hidden iframe — so none of the app's layout (sidebar, header, padding,
 * min-height…) can change the print shape.
 *
 * Each sticker is its own page, so label printers get exactly one label per
 * student. Paper size, orientation and margins come from the browser's print
 * dialog / printer settings. Everything is sized relative to the page width
 * (cqw), so it scales with whatever paper size is selected.
 */
export function printStickers(items: StickerInput[]) {
  if (items.length === 0) return;

  const title = items.length === 1 ? items[0]!.code : `${items.length} barcodes`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Tahoma, Arial, sans-serif; }
  .wrap { width: 100%; container-type: inline-size; }
  .sticker { width: 100%; padding: 2cqw 3cqw; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .sticker:not(:last-child) { break-after: page; page-break-after: always; }
  .name { font-size: 8cqw; font-weight: 700; line-height: 1.2; margin: 0 0 1.5cqw; overflow-wrap: anywhere; }
  svg { display: block; width: 100%; height: 24cqw; }
  .code { direction: ltr; font-family: "Courier New", monospace; font-weight: 700; font-size: 7cqw; letter-spacing: 0.2em; line-height: 1; margin-top: 1.5cqw; }
</style>
</head>
<body>
  <div class="wrap">
    ${items.map(stickerHtml).join("\n")}
  </div>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // Real size (off-screen) so width-relative units (cqw) resolve correctly while printing.
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  win.addEventListener("afterprint", cleanup);

  // Give the iframe a moment to lay out before opening the print dialog.
  setTimeout(() => {
    win.focus();
    win.print();
  }, 250);
}
