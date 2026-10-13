"use client";

import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { ErrorNotice, PageHeader } from "@/components/ui";
import { Barcode } from "@/components/Barcode";
import { encodeCode128 } from "@/lib/barcode";

interface ProfileData {
  student: {
    id: string;
    studentCode: string;
    fullName: string;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Prints ONLY the sticker (name + barcode + ID) from a clean, minimal document
 * inside a hidden iframe — so none of the app's layout (sidebar, header, padding,
 * min-height…) can change the print shape.
 *
 * Paper size, orientation and margins come from the browser's print dialog /
 * printer settings. Everything is sized relative to the page width (cqw), so it
 * scales with whatever paper size is selected.
 */
function printSticker(name: string, code: string) {
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

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(code)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Tahoma, Arial, sans-serif; }
  .wrap { width: 100%; container-type: inline-size; }
  .sticker { width: 100%; padding: 2cqw 3cqw; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .name { font-size: 8cqw; font-weight: 700; line-height: 1.2; margin: 0 0 1.5cqw; overflow-wrap: anywhere; }
  svg { display: block; width: 100%; height: 24cqw; }
  .code { direction: ltr; font-family: "Courier New", monospace; font-weight: 700; font-size: 7cqw; letter-spacing: 0.2em; line-height: 1; margin-top: 1.5cqw; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="sticker">
      <p class="name" dir="auto">${escapeHtml(name)}</p>
      ${barsSvg}
      <div class="code">${escapeHtml(code)}</div>
    </div>
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

/** Student barcode sticker (spec §6, §7): barcode + name + ID only. */
export default function StudentCardPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { data, loading, error } = useApi<ProfileData>(`/api/students/${params.id}/profile`);

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("students.card")} />
        <ErrorNotice message={error} />
        {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  const { student } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t("students.card")} />
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.push(`/dashboard/students/${student.id}`)}>
            {t("common.back")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => printSticker(student.fullName, student.studentCode)}
          >
            {t("common.print")}
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />

      {/* On-screen preview only — printing uses the clean document built in printSticker(). */}
      <div className="card mx-auto flex w-full max-w-xs flex-col items-center justify-center gap-1 bg-white p-3 text-center text-black">
        <p className="w-full break-words text-sm font-bold leading-tight">{student.fullName}</p>
        <Barcode value={student.studentCode} invalidLabel={t("students.barcodeInvalid")} />
      </div>
    </div>
  );
}
