"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thin client for the TecnoID REST API.
 *
 * Every route answers with `{ data }` on success and `{ error, details }`
 * on failure (see src/lib/api.ts). These helpers surface the server's
 * human-readable message and never expose internals to the user.
 */

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  /** Machine-readable code of a business-rule failure (e.g. "PLAN_EXISTS"), when the API sent one. */
  code?: string;

  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

async function parse(response: Response) {
  const body = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    throw new ApiError(
      typeof body.error === "string" ? body.error : "Something went wrong. Please try again.",
      response.status,
      body.details,
      typeof body.code === "string" ? body.code : undefined
    );
  }
  return body;
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<{ data: T; pagination?: Pagination }> {
  const body = await parse(await fetch(url, { signal, cache: "no-store" }));
  return body as { data: T; pagination?: Pagination };
}

async function send<T>(method: string, url: string, payload?: unknown): Promise<T> {
  const body = await parse(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    })
  );
  return (body as { data: T }).data;
}

export const apiPost = <T,>(url: string, payload?: unknown) => send<T>("POST", url, payload);
export const apiPut = <T,>(url: string, payload?: unknown) => send<T>("PUT", url, payload);
export const apiPatch = <T,>(url: string, payload?: unknown) => send<T>("PATCH", url, payload);
export const apiDelete = <T,>(url: string, payload?: unknown) => send<T>("DELETE", url, payload);

export interface QueryState<T> {
  data: T | null;
  pagination?: Pagination;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Aborts in-flight requests on unmount / url change so fast typing never races. */
export function useApi<T>(url: string | null, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [pagination, setPagination] = useState<Pagination | undefined>();
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiGet<T>(url, controller.signal)
      .then((body) => {
        setData(body.data);
        setPagination(body.pagination);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, nonce, ...deps]);

  return { data, pagination, loading, error, reload };
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function formatMoneyClient(amount: number, currency = "EGP"): string {
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}
