"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { currentMonth, qs, useApi } from "@/lib/client";
import { fmt, formatLessonDate, monthLabel, parseMonthInput, weekdayLabel } from "@/lib/lesson-format";
import { Badge, ErrorNotice, Field, PageHeader } from "@/components/ui";
import { GroupPicker } from "@/components/GroupPicker";
import { LessonReportView } from "@/components/LessonReportView";

/**
 * Lessons — the lesson history / archive (Stage 2).
 *
 * Month → Group (Stage › Grade › Subject › Group) → Lesson number, then the
 * full lesson record: details, present / absent / late / unpaid students and
 * a printable report. Because every attendance record belongs to a lesson,
 * all historical attendance is reachable from here.
 */

interface LessonRow {
  id: string;
  lessonNumber: number | null;
  date: string;
  startMinutes: number;
  endMinutes: number;
  status: "SCHEDULED" | "OPEN" | "COMPLETED" | "CANCELLED";
  _count: { attendances: number };
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  if (status === "OPEN") return "brand" as const;
  return "neutral" as const;
}

function LessonsInner() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();

  const [monthValue, setMonthValue] = useState(() => {
    const y = Number(search.get("year"));
    const m = Number(search.get("month"));
    return y && m ? `${y}-${String(m).padStart(2, "0")}` : currentMonth();
  });
  const [groupId, setGroupId] = useState(search.get("groupId") ?? "");
  const [lessonId, setLessonId] = useState(search.get("lesson") ?? "");
  const ym = parseMonthInput(monthValue);

  // Keep the URL shareable / refresh-safe.
  useEffect(() => {
    if (!ym) return;
    const next = qs({ year: ym.year, month: ym.month, groupId, lesson: lessonId });
    router.replace(`/dashboard/academic/sessions${next}`, { scroll: false });
  }, [ym?.year, ym?.month, groupId, lessonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lessons = useApi<{ sessions: LessonRow[] }>(
    groupId && ym ? `/api/sessions${qs({ groupId, year: ym.year, month: ym.month, pageSize: 100 })}` : null
  );
  const rows = lessons.data?.sessions ?? [];

  // Drop a selected lesson that does not belong to the current list.
  useEffect(() => {
    if (lessonId && lessons.data && !rows.some((r) => r.id === lessonId)) setLessonId("");
  }, [lessons.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("sessions.title")}
        description={t("lesson.pickPrompt")}
        actions={
          <Link href="/dashboard/academic/lesson-formation" className="btn-secondary">
            {t("nav.lessonFormation")}
          </Link>
        }
      />

      <div className="card space-y-3 p-4">
        <div className="max-w-xs">
          <Field label={t("lf.month")} required>
            {(id) => (
              <input
                id={id}
                type="month"
                className="input"
                value={monthValue}
                onChange={(e) => {
                  setMonthValue(e.target.value);
                  setLessonId("");
                }}
              />
            )}
          </Field>
        </div>
        <GroupPicker
          groupId={groupId}
          includeInactive
          onChange={(id) => {
            setGroupId(id);
            setLessonId("");
          }}
        />
      </div>

      <ErrorNotice message={lessons.error} />

      {groupId && ym && !lessons.loading && rows.length === 0 && !lessons.error && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>
            {t("lesson.noPlan")} ({monthLabel(ym.year, ym.month, locale)})
          </span>
          <Link href="/dashboard/academic/lesson-formation" className="btn-primary">
            {t("lesson.formNow")}
          </Link>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-sm font-medium">{t("lesson.pickLesson")}</p>
          <div className="flex flex-wrap gap-2">
            {rows.map((row) => {
              const selected = row.id === lessonId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setLessonId(row.id)}
                  aria-pressed={selected}
                  className={`min-w-[8.5rem] rounded-lg border px-3 py-2 text-start text-sm transition ${
                    selected
                      ? "border-tecno-gold bg-tecno-gold/10"
                      : "border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {row.lessonNumber !== null ? fmt(t("lesson.label"), { n: row.lessonNumber }) : t("lesson.legacy")}
                    </span>
                    <Badge tone={statusTone(row.status)}>{t(`lesson.status.${row.status}` as Parameters<typeof t>[0])}</Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-black/55 dark:text-white/55">
                    {weekdayLabel(row.date, locale)} {formatLessonDate(row.date)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {lessonId && <LessonReportView key={lessonId} sessionId={lessonId} onNavigate={setLessonId} onChanged={lessons.reload} />}
    </div>
  );
}

export default function LessonsPage() {
  return (
    <Suspense fallback={null}>
      <LessonsInner />
    </Suspense>
  );
}
