"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode
} from "react";

/**
 * Shared UI primitives (spec §53, §70).
 *
 * Deliberately small and dependency-free so the whole system shares one
 * visual language: cards, tables, skeletons, empty states, toasts and
 * confirmation dialogs with mandatory reasons for critical actions.
 * Everything is keyboard accessible and works in both RTL and LTR
 * because layout uses logical properties (start/end), never left/right.
 */

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-600 dark:text-red-400"
        : tone === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : "";

  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-black/50 dark:text-white/50">{hint}</p>}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
    >
      {message}
    </p>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-black/55 dark:text-white/55">{description}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-black/5 dark:border-white/5">
          <td className="p-3" colSpan={columns}>
            <span className="block h-4 w-full animate-pulse rounded bg-black/10 dark:bg-white/10" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function DataTable({
  columns,
  loading,
  isEmpty,
  emptyTitle,
  emptyDescription,
  children
}: {
  columns: string[];
  loading: boolean;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  children: ReactNode;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-start text-sm">
        <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="p-3 text-start font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows columns={columns.length} />}
          {!loading && isEmpty && (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          )}
          {!loading && !isEmpty && children}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onChange
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center gap-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
        className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
      >
        ‹
      </button>
      <span className="text-sm">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
        className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
      >
        ›
      </button>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "brand" }) {
  const tones: Record<string, string> = {
    neutral: "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70",
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    danger: "bg-red-500/15 text-red-700 dark:text-red-300",
    brand: "bg-tecno-gold/15 text-tecno-gold-dark dark:text-tecno-gold"
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Field({
  label,
  children,
  hint,
  required
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-black/50 dark:text-white/50">{hint}</p>}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl dark:bg-surface-dark-muted">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-xl leading-none text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
          >
            ×
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Confirmation for destructive actions (§63). When `requireReason` is set
 * the operator must type a reason — that reason travels to the API and
 * lands in the audit log.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  requireReason = false,
  busy = false,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  requireReason?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const blocked = busy || (requireReason && reason.trim().length < 3);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm text-black/70 dark:text-white/70">{message}</p>
      {requireReason && (
        <Field label="Reason (recorded in the audit log)" required>
          {(id) => (
            <textarea
              id={id}
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this change is being made"
            />
          )}
        </Field>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast["tone"]) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push(message, "success"),
      error: (message) => push(message, "error")
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[60] flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${
              toast.tone === "success"
                ? "bg-emerald-600 text-white"
                : "bg-red-600 text-white"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  // Falling back to a no-op keeps components usable in isolation/tests.
  return ctx ?? { success: () => {}, error: () => {} };
}

/**
 * Dependency-free SVG bar chart. Two series max — enough for
 * revenue/expenses and present/absent comparisons — and it inherits the
 * page's theme colours so dark mode needs no special handling.
 */
export function BarChart({
  data,
  height = 160,
  currency
}: {
  data: { label: string; primary: number; secondary?: number }[];
  height?: number;
  currency?: string;
}) {
  if (data.length === 0) {
    return <EmptyState title="No data for this period." />;
  }

  const max = Math.max(1, ...data.flatMap((d) => [d.primary, d.secondary ?? 0]));
  const barGroupWidth = 100 / data.length;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label="Bar chart"
      >
        {data.map((d, i) => {
          const x = i * barGroupWidth;
          const primaryHeight = (d.primary / max) * (height - 12);
          const secondaryHeight = ((d.secondary ?? 0) / max) * (height - 12);
          const hasSecondary = d.secondary !== undefined;
          const barWidth = hasSecondary ? barGroupWidth * 0.3 : barGroupWidth * 0.5;

          return (
            <g key={d.label}>
              <rect
                x={x + barGroupWidth * 0.2}
                y={height - primaryHeight}
                width={barWidth}
                height={primaryHeight}
                fill="#F0B429"
                rx="0.5"
              />
              {hasSecondary && (
                <rect
                  x={x + barGroupWidth * 0.52}
                  y={height - secondaryHeight}
                  width={barWidth}
                  height={secondaryHeight}
                  fill="currentColor"
                  opacity="0.25"
                  rx="0.5"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-black/50 dark:text-white/50">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate text-center">
            {d.label}
          </span>
        ))}
      </div>
      {currency && (
        <p className="mt-1 text-center text-[10px] text-black/40 dark:text-white/40">
          Values in {currency}
        </p>
      )}
    </div>
  );
}
