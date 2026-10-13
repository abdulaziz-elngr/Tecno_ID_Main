"use client";

import Link from "next/link";
import { useState } from "react";
import { hasDictKey, useI18n } from "@/lib/i18n";
import { apiPost, useApi } from "@/lib/client";
import {
  fmt,
  formatClock,
  formatLessonDate,
  formatTimeRange,
  localizeError,
  monthLabel,
  weekdayLabel
} from "@/lib/lesson-format";
import { Badge, ConfirmDialog, ErrorNotice, StatCard, useToast } from "@/components/ui";
import { attendanceTone, feeTone } from "@/components/StudentSnapshotCard";
import { renderTemplate } from "@/lib/templates";
import { buildWhatsAppLink } from "@/lib/wa-link";

/**
 * Complete snapshot of ONE lesson (Stage 2): details, counts, present / late /
 * absent / unpaid lists, open + close actions and a professional print layout.
 * Used by the Lessons page and by the lesson detail route.
 */

interface ReportStudent {
  studentId: string;
  fullName: string;
  studentCode: string;
  type: string | null;
  recordedAt: string | null;
  lateMinutes: number | null;
  isMakeUp: boolean;
  parent: { fullName: string; phone: string; whatsappNumber: string | null } | null;
}

interface Report {
  lesson: {
    id: string;
    lessonNumber: number | null;
    totalLessons: number | null;
    date: string;
    startMinutes: number;
    endMinutes: number;
    status: "SCHEDULED" | "OPEN" | "COMPLETED" | "CANCELLED";
    openedAt: string | null;
    closedAt: string | null;
    year: number;
    month: number;
  };
  group: { id: string; name: string; capacity: number };
  stage: { name: string };
  grade: { name: string };
  subject: { name: string } | null;
  teacher: { fullName: string } | null;
  center: { name: string; address: string | null; phone: string | null };
  counts: {
    enrolled: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    makeUp: number;
    pending: number;
    unpaid: number | null;
    attendanceRate: number;
  };
  present: ReportStudent[];
  late: ReportStudent[];
  absent: ReportStudent[];
  excused: ReportStudent[];
  pending: ReportStudent[];
  unpaid: (ReportStudent & { feeState: string; remaining: number })[] | null;
  unpaidHidden: boolean;
  navigation: { previous: { id: string; lessonNumber: number | null } | null; next: { id: string; lessonNumber: number | null } | null };
}

interface WATemplate {
  key: string;
  locale: string;
  body: string;
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  if (status === "OPEN") return "brand" as const;
  return "neutral" as const;
}

export function LessonReportView({
  sessionId,
  onNavigate,
  onChanged
}: {
  sessionId: string;
  /** When given, previous/next lesson links call this instead of changing the URL. */
  onNavigate?: (sessionId: string) => void;
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Report>(`/api/sessions/${sessionId}/report`);
  const { data: templates } = useApi<WATemplate[]>("/api/whatsapp/templates");

  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const errText = (err: unknown) => localizeError(err, t as (key: never) => string, hasDictKey);

  if (loading && !data) return <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>;
  if (error || !data) return <ErrorNotice message={error ?? "Lesson not found."} />;

  const { lesson, counts } = data;
  const statusLabel = t(`lesson.status.${lesson.status}` as Parameters<typeof t>[0]);
  const title = lesson.lessonNumber !== null ? fmt(t("lesson.label"), { n: lesson.lessonNumber }) : t("lesson.legacy");

  async function act(kind: "open" | "close") {
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "open") {
        await apiPost(`/api/sessions/${sessionId}/open`);
        toast.success(t("lesson.opened"));
      } else {
        const result = await apiPost<{ absentMarked: number; nextLesson: { lessonNumber: number | null } | null }>(
          `/api/sessions/${sessionId}/close`
        );
        const next = result.nextLesson?.lessonNumber;
        toast.success(
          `${fmt(t("lesson.closed"), { absent: result.absentMarked })} ${
            next ? fmt(t("lesson.nextIs"), { n: next }) : t("lesson.noNext")
          }`
        );
      }
      setConfirmClose(false);
      reload();
      onChanged?.();
    } catch (err) {
      setConfirmClose(false);
      setActionError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  function sendWhatsApp(student: ReportStudent, kind: "absent" | "late") {
    const parent = student.parent;
    if (!parent) {
      window.alert("No parent phone number on file for this student.");
      return;
    }
    const key = kind === "absent" ? "attendance.absent" : "attendance.late";
    const template = (templates ?? []).find((tpl) => tpl.key === key && tpl.locale === locale);
    const vars = {
      student_name: student.fullName,
      parent_name: parent.fullName,
      group_name: data!.group.name,
      grade_name: data!.grade.name,
      stage_name: data!.stage.name,
      date: lesson.date.slice(0, 10),
      time: formatClock(new Date(Date.UTC(2000, 0, 1, Math.floor(lesson.startMinutes / 60), lesson.startMinutes % 60)), "en"),
      late_minutes: student.lateMinutes ?? 0,
      center_name: data!.center.name
    };
    const message = template
      ? renderTemplate(template.body, vars)
      : kind === "absent"
        ? `Dear ${parent.fullName}, ${student.fullName} was absent from the session on ${vars.date}.`
        : `Dear ${parent.fullName}, ${student.fullName} arrived late to the session on ${vars.date}.`;
    const link = buildWhatsAppLink(parent.whatsappNumber || parent.phone, message);
    if (!link) {
      window.alert("The parent's phone number is not valid.");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }

  const navButton = (target: { id: string; lessonNumber: number | null } | null, label: string) =>
    target ? (
      onNavigate ? (
        <button type="button" className="btn-secondary" onClick={() => onNavigate(target.id)}>
          {label}
        </button>
      ) : (
        <Link href={`/dashboard/academic/sessions/${target.id}`} className="btn-secondary">
          {label}
        </Link>
      )
    ) : null;

  const th = "p-2 text-start font-semibold";
  const td = "p-2 align-top";

  return (
    <div className="print-report space-y-5">
      {/* A4 page setup applies to the lesson report only (kept out of globals.css so it can't affect other printouts). */}
      <style>{`@media print { @page { size: A4; margin: 12mm; } }`}</style>
      {/* ---- Print-only letterhead ---- */}
      <div className="hidden print:block">
        <div className="border-b border-black pb-2 text-center">
          <p className="text-xl font-bold">{data.center.name}</p>
          {(data.center.address || data.center.phone) && (
            <p className="text-xs">{[data.center.address, data.center.phone].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <h1 className="mt-3 text-center text-lg font-bold">{t("lesson.report")}</h1>
      </div>

      {/* ---- Header / actions ---- */}
      <div className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">
              {title}
              {lesson.totalLessons ? <span className="text-base font-normal text-black/50 dark:text-white/50"> / {lesson.totalLessons}</span> : null}
            </h2>
            <Badge tone={statusTone(lesson.status)}>{statusLabel}</Badge>
          </div>
          <p className="text-sm text-black/60 dark:text-white/60">
            {monthLabel(lesson.year, lesson.month, locale)} · {data.stage.name} › {data.grade.name} ›{" "}
            {data.subject?.name ?? "—"} › {data.group.name}
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          {navButton(data.navigation.previous, t("lesson.prev"))}
          {navButton(data.navigation.next, t("lesson.nextLabel"))}
          {lesson.status === "SCHEDULED" && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => act("open")}>
              {busy ? t("common.loading") : t("lesson.open")}
            </button>
          )}
          {lesson.status === "OPEN" && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => setConfirmClose(true)}>
              {t("lesson.close")}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            {t("lesson.print")}
          </button>
        </div>
      </div>

      <ErrorNotice message={actionError} />
      {lesson.status === "OPEN" && (
        <p className="no-print rounded-lg bg-tecno-gold/10 px-3 py-2 text-sm">{t("lesson.openHint")}</p>
      )}

      {/* ---- Lesson details ---- */}
      <section className="card p-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            [t("lesson.number"), lesson.lessonNumber ?? "—"],
            [t("common.date"), formatLessonDate(lesson.date)],
            [t("lesson.day"), weekdayLabel(lesson.date, locale)],
            [t("lesson.time"), formatTimeRange(lesson.startMinutes, lesson.endMinutes, locale)],
            [t("lesson.subject"), data.subject?.name ?? "—"],
            [t("common.teacher"), data.teacher?.fullName ?? "—"],
            [t("common.group"), data.group.name],
            [t("common.status"), statusLabel],
            ...(lesson.openedAt ? [[t("lesson.opened.at"), formatClock(lesson.openedAt, locale)]] : []),
            ...(lesson.closedAt ? [[t("lesson.closed.at"), formatClock(lesson.closedAt, locale)]] : [])
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="text-black/55 dark:text-white/55">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- Summary ---- */}
      <section>
        <h3 className="mb-2 font-semibold">{t("lesson.summary")}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label={t("lesson.total")} value={counts.enrolled} />
          <StatCard label={t("lesson.present")} value={counts.present} tone="positive" />
          <StatCard label={t("lesson.absent")} value={counts.absent} tone="negative" />
          <StatCard label={t("lesson.late")} value={counts.late} tone="warning" />
          <StatCard label={t("lesson.unpaid")} value={counts.unpaid ?? "—"} tone={counts.unpaid ? "warning" : "default"} />
          <StatCard label={t("lesson.makeUp")} value={counts.makeUp} />
          <StatCard label={t("lesson.rate")} value={`${counts.attendanceRate}%`} />
        </div>
        {counts.pending > 0 && (
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            {t("lesson.pending")}: <strong>{counts.pending}</strong>
          </p>
        )}
      </section>

      {/* ---- Present ---- */}
      <ListSection title={`${t("lesson.present")} (${data.present.length})`} empty={data.present.length === 0}>
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10">
            <th className={th}>#</th>
            <th className={th}>{t("common.student")}</th>
            <th className={th}>{t("lesson.checkIn")}</th>
          </tr>
        </thead>
        <tbody>
          {data.present.map((s, i) => (
            <tr key={s.studentId} className="border-b border-black/5 dark:border-white/5">
              <td className={td}>{i + 1}</td>
              <td className={td}>
                {s.fullName} <Code>{s.studentCode}</Code>
                {s.isMakeUp && <Badge tone="brand">{t("lesson.makeUp")}</Badge>}
              </td>
              <td className={td}>{formatClock(s.recordedAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </ListSection>

      {/* ---- Late ---- */}
      <ListSection title={`${t("lesson.late")} (${data.late.length})`} empty={data.late.length === 0}>
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10">
            <th className={th}>#</th>
            <th className={th}>{t("common.student")}</th>
            <th className={th}>{t("lesson.arrival")}</th>
            <th className={th}>{t("lesson.lateBy")}</th>
            <th className={`${th} no-print`} />
          </tr>
        </thead>
        <tbody>
          {data.late.map((s, i) => (
            <tr key={s.studentId} className="border-b border-black/5 dark:border-white/5">
              <td className={td}>{i + 1}</td>
              <td className={td}>
                {s.fullName} <Code>{s.studentCode}</Code>
              </td>
              <td className={td}>{formatClock(s.recordedAt, locale)}</td>
              <td className={td}>{s.lateMinutes ?? "—"}</td>
              <td className={`${td} no-print`}>
                {s.parent && (
                  <button type="button" className="text-xs text-emerald-600 hover:underline dark:text-emerald-400" onClick={() => sendWhatsApp(s, "late")}>
                    WhatsApp
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </ListSection>

      {/* ---- Absent ---- */}
      <ListSection title={`${t("lesson.absent")} (${data.absent.length})`} empty={data.absent.length === 0}>
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10">
            <th className={th}>#</th>
            <th className={th}>{t("common.student")}</th>
            <th className={`${th} no-print`} />
          </tr>
        </thead>
        <tbody>
          {data.absent.map((s, i) => (
            <tr key={s.studentId} className="border-b border-black/5 dark:border-white/5">
              <td className={td}>{i + 1}</td>
              <td className={td}>
                {s.fullName} <Code>{s.studentCode}</Code>
              </td>
              <td className={`${td} no-print`}>
                {s.parent && (
                  <button type="button" className="text-xs text-emerald-600 hover:underline dark:text-emerald-400" onClick={() => sendWhatsApp(s, "absent")}>
                    WhatsApp
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </ListSection>

      {data.excused.length > 0 && (
        <ListSection title={`${t("lesson.excused")} (${data.excused.length})`} empty={false}>
          <tbody>
            {data.excused.map((s, i) => (
              <tr key={s.studentId} className="border-b border-black/5 dark:border-white/5">
                <td className={td}>{i + 1}</td>
                <td className={td}>
                  {s.fullName} <Code>{s.studentCode}</Code>
                </td>
              </tr>
            ))}
          </tbody>
        </ListSection>
      )}

      {data.pending.length > 0 && (
        <ListSection title={`${t("lesson.pending")} (${data.pending.length})`} empty={false}>
          <tbody>
            {data.pending.map((s, i) => (
              <tr key={s.studentId} className="border-b border-black/5 dark:border-white/5">
                <td className={td}>{i + 1}</td>
                <td className={td}>
                  {s.fullName} <Code>{s.studentCode}</Code>
                </td>
              </tr>
            ))}
          </tbody>
        </ListSection>
      )}

      {/* ---- Unpaid ---- */}
      {data.unpaidHidden ? (
        <section className="card p-4 text-sm text-black/50 dark:text-white/50">
          {t("lesson.unpaid")}: {t("lesson.restricted")}
        </section>
      ) : (
        <ListSection
          title={`${t("lesson.unpaid")} (${data.unpaid?.length ?? 0}) — ${monthLabel(lesson.year, lesson.month, locale)}`}
          empty={(data.unpaid?.length ?? 0) === 0}
          emptyText={t("lesson.allPaid")}
        >
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className={th}>#</th>
              <th className={th}>{t("common.student")}</th>
              <th className={th}>{t("common.status")}</th>
              <th className={th}>{t("lesson.remaining")}</th>
            </tr>
          </thead>
          <tbody>
            {data.unpaid?.map((s, i) => (
              <tr key={s.studentId} className="border-b border-black/5 dark:border-white/5">
                <td className={td}>{i + 1}</td>
                <td className={td}>
                  {s.fullName} <Code>{s.studentCode}</Code>
                </td>
                <td className={td}>
                  <Badge tone={feeTone(s.feeState)}>{t(`fee.${s.feeState}` as Parameters<typeof t>[0])}</Badge>
                </td>
                <td className={td}>{s.remaining > 0 ? s.remaining.toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </ListSection>
      )}

      {/* ---- Print-only footer ---- */}
      <div className="hidden print:block">
        <div className="mt-8 flex justify-between text-xs">
          <span>
            {t("lesson.printedAt")}: {new Date().toLocaleString(locale === "ar" ? "ar-EG" : "en-GB")}
          </span>
          <span>{t("lesson.signature")}: ____________________</span>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClose}
        title={t("lesson.closeTitle")}
        message={t("lesson.closeMessage")}
        confirmLabel={t("lesson.close")}
        busy={busy}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => act("close")}
      />
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="ms-1 font-mono text-xs text-black/45 dark:text-white/45">{children}</span>;
}

function ListSection({
  title,
  empty,
  emptyText,
  children
}: {
  title: string;
  empty: boolean;
  emptyText?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-x-auto p-4">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {empty ? (
        <p className="text-sm text-black/50 dark:text-white/50">{emptyText ?? "—"}</p>
      ) : (
        <table className="w-full text-start text-sm">{children}</table>
      )}
    </section>
  );
}
