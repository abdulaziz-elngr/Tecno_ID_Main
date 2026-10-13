"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { currentMonth, qs, useApi } from "@/lib/client";
import { toAsciiDigits } from "@/lib/wa-link";
import { weekdayLabel, formatLessonDate, fmt, monthLabel, parseMonthInput } from "@/lib/lesson-format";
import { Field } from "@/components/ui";
import type { PickerGroup } from "@/components/GroupPicker";

/**
 * Pieces shared by the Exams, Recitation, Homework and Student performance pages.
 */

/** The signed-in user's permission keys (from /api/auth/me) — used only to hide buttons; the API still enforces them. */
export function useMyPermissions(): { has: (key: string) => boolean; loaded: boolean } {
  const [keys, setKeys] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (alive) setKeys(new Set<string>(me?.permissions ?? []));
      })
      .catch(() => {
        if (alive) setKeys(new Set());
      });
    return () => {
      alive = false;
    };
  }, []);
  return { has: (key) => keys?.has(key) ?? false, loaded: keys !== null };
}

/** Looks a group up by id (the page may receive only an id from the URL). */
export function useGroupInfo(groupId: string): PickerGroup | null {
  const { data } = useApi<PickerGroup[]>(groupId ? "/api/groups" : null, [groupId]);
  return useMemo(() => data?.find((g) => g.id === groupId) ?? null, [data, groupId]);
}

/** Lower-cases, strips Arabic diacritics/tatweel, unifies alef/ya/ta-marbuta and Arabic digits. */
export function normalizeSearch(input: string): string {
  return toAsciiDigits(input)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name or student code contains the query (instant, client-side — no reload). */
export function matchesStudent(student: { fullName: string; studentCode: string }, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(student.fullName).includes(q) || normalizeSearch(student.studentCode).includes(q);
}

export function StudentSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <input
        type="search"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("perf.searchPlaceholder")}
        aria-label={t("perf.searchPlaceholder")}
        autoComplete="off"
      />
    </div>
  );
}

/** Opens WhatsApp with the prepared message (click-to-chat link; nothing is sent automatically). */
export function WhatsAppButton({
  url,
  issue,
  label,
  noResultYet = false
}: {
  url: string | null;
  issue: "NO_PARENT" | "INVALID_PHONE" | null;
  label: string;
  /** True when there is no message to prepare yet (e.g. student not graded). */
  noResultYet?: boolean;
}) {
  const { t } = useI18n();
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
      >
        <span aria-hidden>💬</span>
        {label}
      </a>
    );
  }
  const reason = noResultYet
    ? t("perf.noResultYet")
    : issue === "NO_PARENT"
      ? t("perf.noParent")
      : issue === "INVALID_PHONE"
        ? t("perf.invalidPhone")
        : t("perf.noResultYet");
  return (
    <span
      title={reason}
      className="inline-flex cursor-not-allowed items-center justify-center gap-1 rounded-lg bg-black/5 px-3 py-1.5 text-xs font-medium text-black/45 dark:bg-white/10 dark:text-white/45"
    >
      <span aria-hidden>💬</span>
      {label}
      <span className="sr-only"> — {reason}</span>
    </span>
  );
}

/** Small explanatory line shown under a disabled WhatsApp button. */
export function ParentIssueHint({ issue }: { issue: "NO_PARENT" | "INVALID_PHONE" | null }) {
  const { t } = useI18n();
  if (!issue) return null;
  return (
    <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
      {issue === "NO_PARENT" ? t("perf.noParent") : t("perf.invalidPhone")}
    </p>
  );
}

export function Section({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-black/5 p-4 dark:border-white/10">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-black/55 dark:text-white/55">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function GroupBadgeLine({ group }: { group: { name: string; gradeName: string; stageName: string } }) {
  return (
    <span>
      {group.stageName} · {group.gradeName} · {group.name}
    </span>
  );
}

/** Parses a score typed by the user. Returns the number, or an i18n error key. */
export function parseScoreInput(
  raw: string,
  max: number
): { ok: true; value: number } | { ok: false; error: "perf.err.required" | "perf.err.number" | "perf.err.negative" | "perf.err.max" } {
  const text = toAsciiDigits(raw).trim().replace(",", ".");
  if (text === "") return { ok: false, error: "perf.err.required" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: "perf.err.number" };
  if (value < 0) return { ok: false, error: "perf.err.negative" };
  if (value > max) return { ok: false, error: "perf.err.max" };
  return { ok: true, value };
}

export interface LessonRow {
  id: string;
  lessonNumber: number | null;
  date: string;
  status: string;
}

/**
 * Month + lesson chooser. Lessons come from "Lesson formation" (ClassSession) of the
 * selected group, so whatever is created here is tied to a real, numbered lesson.
 */
export function LessonPicker({
  groupId,
  value,
  onChange,
  disabledLessonIds = []
}: {
  groupId: string;
  value: string;
  onChange: (sessionId: string, lesson?: LessonRow) => void;
  /** Lessons that cannot be chosen (e.g. already have a recitation). */
  disabledLessonIds?: string[];
}) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(currentMonth());
  const ym = parseMonthInput(month);
  const lessons = useApi<{ sessions: LessonRow[] }>(
    groupId && ym ? `/api/sessions${qs({ groupId, year: ym.year, month: ym.month, pageSize: 100 })}` : null
  );
  const rows = (lessons.data?.sessions ?? []).filter((s) => s.status !== "CANCELLED");

  return (
    <div className="space-y-3">
      <Field label={t("lf.month")} required>
        {(id) => (
          <input
            id={id}
            type="month"
            className="input"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              onChange("");
            }}
          />
        )}
      </Field>
      <Field label={t("perf.lesson")} required>
        {(id) => (
          <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value, rows.find((r) => r.id === e.target.value))} required>
            <option value="">{lessons.loading ? t("common.loading") : t("common.select")}</option>
            {rows.map((s) => (
              <option key={s.id} value={s.id} disabled={disabledLessonIds.includes(s.id)}>
                {s.lessonNumber !== null ? fmt(t("lesson.label"), { n: s.lessonNumber }) : t("lesson.legacy")} ·{" "}
                {weekdayLabel(s.date, locale)} {formatLessonDate(s.date)}
                {disabledLessonIds.includes(s.id) ? ` (${t("perf.alreadyCreated")})` : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      {lessons.data && rows.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("perf.noLessons")} {ym && `(${monthLabel(ym.year, ym.month, locale)})`}
        </p>
      )}
    </div>
  );
}

/** Simple two/three-way tab switcher in the app's visual language. */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string }[];
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/10">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            value === tab.id ? "bg-white shadow-sm dark:bg-surface-dark-muted" : "text-black/60 hover:text-black dark:text-white/60"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
