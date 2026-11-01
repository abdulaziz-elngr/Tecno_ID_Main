/**
 * Prints a payment receipt right away, without leaving the page and without
 * opening a new tab: the receipt page is loaded in a hidden iframe
 * (`?print=1&embed=1`), prints itself, tells us when it is done and the iframe
 * is removed. Reprinting only re-renders the ORIGINAL payment (GET) — it never
 * creates or changes a payment.
 *
 * NOTE: a browser always shows its print dialog unless it is started in kiosk
 * printing mode (Chrome/Edge flag `--kiosk-printing`); that is the only way to
 * make the paper come out with no click at all.
 */
export function printReceiptSilently(paymentId: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  iframe.src = `/dashboard/finance/payments/${encodeURIComponent(paymentId)}?print=1&embed=1`;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    if (timer) clearTimeout(timer);
    iframe.remove();
  };
  function onMessage(event: MessageEvent) {
    const data = event.data as { type?: string; id?: string } | null;
    if (event.origin === window.location.origin && data?.type === "receipt-printed" && data.id === paymentId) {
      cleanup();
    }
  }

  window.addEventListener("message", onMessage);
  // Safety net: never leave the hidden frame behind.
  timer = setTimeout(cleanup, 120_000);
  document.body.appendChild(iframe);
}
