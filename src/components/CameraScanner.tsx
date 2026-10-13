"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Phone-camera barcode / QR scanner.
 *
 * - Uses the browser's native BarcodeDetector when available (Chrome/Edge on
 *   Android — fast), otherwise falls back to @zxing (iOS Safari, Firefox…),
 *   which is loaded lazily so it never weighs on pages that don't scan.
 * - Reads Code 128 (the printed student barcode) and QR codes.
 * - Stays open between scans (staff scan student after student). The same
 *   code is ignored for `cooldownMs` to avoid double submissions, and
 *   detection is ignored while `paused` (request in flight / waiting for the
 *   make-up confirmation).
 * - The camera needs HTTPS (or localhost) and the user's permission.
 */

interface Labels {
  starting: string;
  denied: string;
  unsupported: string;
  noCamera: string;
  insecure: string;
  hint: string;
  close: string;
}

type Detected = { rawValue: string };
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<Detected[]>;
}

export function CameraScanner({
  onDetect,
  onClose,
  paused = false,
  cooldownMs = 2500,
  labels
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
  paused?: boolean;
  cooldownMs?: number;
  labels: Labels;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string | null>(null);

  // Keep the latest props reachable from the long-lived scan loop.
  const pausedRef = useRef(paused);
  const onDetectRef = useRef(onDetect);
  pausedRef.current = paused;
  onDetectRef.current = onDetect;
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    let cancelled = false;
    let stopFn: (() => void) | null = null;

    function handle(raw: string) {
      const code = raw.trim();
      if (!code || pausedRef.current) return;
      const now = Date.now();
      if (lastRef.current.code === code && now - lastRef.current.at < cooldownMs) return;
      lastRef.current = { code, at: now };
      try {
        navigator.vibrate?.(60);
      } catch {
        /* vibration is optional */
      }
      onDetectRef.current(code);
    }

    async function start() {
      if (typeof window === "undefined") return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(labels.insecure);
        setStatus("error");
        return;
      }
      const video = videoRef.current;
      if (!video) return;

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
      };

      try {
        const Native = (window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => NativeDetector;
        }).BarcodeDetector;

        let useNative = false;
        if (Native) {
          try {
            const supported: string[] = (await (Native as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats?.()) ?? [];
            useNative = supported.includes("code_128");
          } catch {
            useNative = false;
          }
        }

        if (useNative && Native) {
          const detector = new Native({ formats: ["code_128", "qr_code"] });
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          await video.play().catch(() => {});
          setStatus("ready");
          let busy = false;
          const timer = window.setInterval(async () => {
            if (busy || video.readyState < 2) return;
            busy = true;
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) handle(found[0].rawValue);
            } catch {
              /* ignore frame errors */
            } finally {
              busy = false;
            }
          }, 180);
          stopFn = () => {
            window.clearInterval(timer);
            stream.getTracks().forEach((t) => t.stop());
            video.srcObject = null;
          };
          return;
        }

        // Fallback: ZXing (works on iOS Safari too).
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library")
        ]);
        if (cancelled) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
          if (result) handle(result.getText());
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        setStatus("ready");
        stopFn = () => controls.stop();
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") setError(labels.denied);
        else if (name === "NotFoundError" || name === "OverconstrainedError") setError(labels.noCamera);
        else setError(labels.unsupported);
        setStatus("error");
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopFn?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-4 space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover sm:aspect-video" />
        {status === "ready" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-1/2 w-4/5 rounded-lg border-2 border-tecno-gold/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            <div className="absolute h-0.5 w-4/5 bg-red-500/80" />
          </div>
        )}
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">{labels.starting}</div>
        )}
        {paused && status === "ready" && <div className="absolute inset-0 bg-black/50" />}
      </div>
      {status === "error" && error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {status === "ready" && <p className="text-center text-xs text-black/55 dark:text-white/55">{labels.hint}</p>}
      <button type="button" className="btn-secondary w-full" onClick={onClose}>
        {labels.close}
      </button>
    </div>
  );
}
