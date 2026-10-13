"use client";

import { useI18n } from "@/lib/i18n";
import { formatClock, fmt } from "@/lib/lesson-format";
import { formatLessonDate } from "@/lib/lesson-format";
import { Badge } from "@/components/ui";

/**
 * The info card shown immediately after a student is scanned or selected in
 * the attendance screen (Stage 2): last attendance, latest recitation, latest
 * exam, this month's fees and any warning. Sections the viewer's role may not
 * see are shown as "restricted" instead of silently looking empty.
 */

export interface StudentSnapshot {
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    status: string;
    group: { id: string; name: string } | null;
  };
  lesson: { id: string; lessonNumber: number | null };
  thisLesson: { type: string; recordedAt: string } | null;
  lastAttendance: { type: string; date: string; lessonNumber: number | null; groupName: string } | null;
  recitation: {
    date: string;
    status: string;
    score: number | null;
    maxScore: number;
    percent: number | null;
    content: string;
  } | null;
  exam: { name: string; date: string; score: number; maxScore: number; percent: number | null } | null;
  fees: { state: string; remaining: number; periodYear: number; periodMonth: number } | null;
  paymentWarning?: {
    currency: string;
    totalDue: number;
    months: { year: number; month: number; labelEn: string; labelAr: string; remaining: number; status: string }[];
  } | null;
  hidden: { recitation: boolean; exam: boolean; fees: boolean };
  warnings: { code: string; severity: "info" | "warning" | "critical"; count?: number }[];
}

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

export function attendanceTone(type: string): Tone {
  if (type === "ABSENT") return "danger";
  if (type === "LATE") return "warning";
  if (type === "MAKE_UP") return "brand";
  if (type === "EXCUSED") return "neutral";
  return "success";
}

export function feeTone(state: string): Tone {
  if (state === "PAID" || state === "WAIVED") return "success";
  if (state === "OVERDUE") return "danger";
  return "warning";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-black/55 dark:text-white/55">{label}</dt>
      <dd className="min-w-0 text-end font-medium">{children}</dd>
    </div>
  );
}

export function StudentSnapshotCard({ snapshot }: { snapshot: StudentSnapshot }) {
  const { t, locale } = useI18n();
  const restricted = <span className="text-xs text-black/40 dark:text-white/40">{t("lesson.restricted")}</span>;
  const none = <span className="text-black/40 dark:text-white/40">{t("lesson.none")}</span>;

  const warningText = (w: StudentSnapshot["warnings"][number]) => {
    const key = `scanner.warn.${w.code}` as Parameters<typeof t>[0];
    return fmt(t(key), { count: w.count ?? 0 });
  };

  return (
    <div className="card p-4" aria-live="polite">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold">{snapshot.student.fullName}</h3>
          <p className="font-mono text-xs text-black/50 dark:text-white/50">
            {snapshot.student.studentCode} · {snapshot.student.group?.name ?? "—"}
          </p>
        </div>
        <span className="text-xs text-black/50 dark:text-white/50">{t("scanner.studentCard")}</span>
      </div>

      {snapshot.paymentWarning && snapshot.paymentWarning.months.length > 0 && (
        <div
          role="alert"
          className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          <p className="font-bold">
            ⚠️ {locale === "ar" ? "اشتراكات شهرية غير مسددة" : "Unpaid Monthly Subscription"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {snapshot.paymentWarning.months.map((m) => (
              <li key={`${m.year}-${m.month}`}>
                {locale === "ar" ? m.labelAr : m.labelEn} — {m.remaining} {snapshot.paymentWarning!.currency}
              </li>
            ))}
          </ul>
          {snapshot.paymentWarning.months.length > 1 && (
            <p className="mt-1 text-xs font-semibold">
              {locale === "ar" ? "الإجمالي المستحق" : "Total due"}: {snapshot.paymentWarning.totalDue} {snapshot.paymentWarning.currency}
            </p>
          )}
        </div>
      )}

      {snapshot.warnings.length > 0 && (
        <ul className="mb-2 space-y-1">
          {snapshot.warnings.map((w) => (
            <li
              key={w.code}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                w.severity === "critical"
                  ? "bg-red-500/10 text-red-700 dark:text-red-300"
                  : w.severity === "warning"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/70"
              }`}
            >
              {warningText(w)}
            </li>
          ))}
        </ul>
      )}

      <dl className="divide-y divide-black/5 text-sm dark:divide-white/10">
        <Row label={t("scanner.info.lastAttendance")}>
          {snapshot.lastAttendance ? (
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              <Badge tone={attendanceTone(snapshot.lastAttendance.type)}>
                {t(`att.${snapshot.lastAttendance.type}` as Parameters<typeof t>[0])}
              </Badge>
              {snapshot.lastAttendance.lessonNumber !== null && (
                <span>{fmt(t("lesson.label"), { n: snapshot.lastAttendance.lessonNumber })}</span>
              )}
            </span>
          ) : (
            none
          )}
        </Row>
        <Row label={t("scanner.info.lastDate")}>
          {snapshot.lastAttendance ? formatLessonDate(snapshot.lastAttendance.date) : none}
        </Row>
        <Row label={t("scanner.info.recitation")}>
          {snapshot.hidden.recitation ? (
            restricted
          ) : snapshot.recitation ? (
            snapshot.recitation.percent !== null ? (
              <span>{snapshot.recitation.percent}%</span>
            ) : (
              <span>{snapshot.recitation.status}</span>
            )
          ) : (
            none
          )}
        </Row>
        <Row label={t("scanner.info.exam")}>
          {snapshot.hidden.exam ? (
            restricted
          ) : snapshot.exam ? (
            <span>
              {snapshot.exam.percent !== null ? `${snapshot.exam.percent}%` : snapshot.exam.score}
              <span className="ms-2 text-xs font-normal text-black/50 dark:text-white/50">{snapshot.exam.name}</span>
            </span>
          ) : (
            none
          )}
        </Row>
        <Row label={t("scanner.info.fees")}>
          {snapshot.hidden.fees ? (
            restricted
          ) : snapshot.fees ? (
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              <Badge tone={feeTone(snapshot.fees.state)}>{t(`fee.${snapshot.fees.state}` as Parameters<typeof t>[0])}</Badge>
              {snapshot.fees.remaining > 0 && (
                <span className="text-xs font-normal text-black/50 dark:text-white/50">
                  {t("lesson.remaining")}: {snapshot.fees.remaining.toLocaleString()}
                </span>
              )}
            </span>
          ) : (
            none
          )}
        </Row>
        {snapshot.thisLesson && (
          <Row label={t("scanner.info.thisLesson")}>
            <span className="inline-flex items-center gap-2">
              <Badge tone={attendanceTone(snapshot.thisLesson.type)}>
                {t(`att.${snapshot.thisLesson.type}` as Parameters<typeof t>[0])}
              </Badge>
              {formatClock(snapshot.thisLesson.recordedAt, locale)}
            </span>
          </Row>
        )}
      </dl>
    </div>
  );
}
