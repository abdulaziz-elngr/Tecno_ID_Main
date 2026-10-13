"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDate, qs, todayISO, useApi } from "@/lib/client";
import { fmt } from "@/lib/lesson-format";
import { Badge, ErrorNotice, Field, Modal, PageHeader, Pager, StatCard, useToast } from "@/components/ui";
import type { PickerGroup } from "@/components/GroupPicker";
import { ParentIssueHint, Section, WhatsAppButton, useMyPermissions } from "@/components/performance/shared";

/**
 * Student consistency & performance. Ranks students from their real exam, homework,
 * recitation and attendance data (methodology: src/lib/performance.ts, summarised in
 * the panel on this page), lets staff recognise top students, and lists the students
 * who need attention with the reasons and a WhatsApp link to the parent.
 */

type ReasonCode = "LOW_EXAM" | "LOW_HOMEWORK" | "LOW_RECITATION" | "LOW_ATTENDANCE" | "MISSED_EXAMS" | "LOW_OVERALL";

interface Reason {
  code: ReasonCode;
  value: number;
  threshold: number;
}

interface PerfStudent {
  id: string;
  fullName: string;
  studentCode: string;
  gradeName: string;
  groupName: string;
  subjectName: string | null;
  examAvg: number | null;
  examsTaken: number;
  examsAbsent: number;
  homeworkPct: number | null;
  homeworkRecorded: number;
  recitationAvg: number | null;
  recitationCount: number;
  attendancePct: number | null;
  lessonsHeld: number;
  overall: number | null;
  reasons: Reason[];
  recognitionCount: number;
  lastRecognizedAt: string | null;
}

interface PerfData {
  period: { days: number };
  weights: { exams: number; attendance: number; homework: number; recitation: number };
  thresholds: { exams: number; homework: number; recitation: number; attendance: number; overall: number; missedExams: number };
  minimums: { exams: number; homework: number; recitation: number; attendance: number; categoriesForRanking: number };
  summary: { students: number; ranked: number; withoutData: number; needAttention: number; truncated: boolean };
  top: (PerfStudent & { rank: number })[];
  needsImprovement: (PerfStudent & { whatsappUrl: string | null; parentIssue: "NO_PARENT" | "INVALID_PHONE" | null })[];
}

interface StageOption {
  id: string;
  name: string;
  isActive: boolean;
  grades: { id: string; name: string; isActive: boolean }[];
}

interface RecognitionRow {
  id: string;
  reason: string;
  date: string;
  notes: string | null;
  recordedBy: string | null;
  student: { id: string; fullName: string; studentCode: string; gradeName: string; groupName: string };
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export default function StudentPerformancePage() {
  const { t } = useI18n();
  const toast = useToast();
  const perms = useMyPermissions();

  const { data: stages } = useApi<StageOption[]>("/api/stages");
  const { data: groups } = useApi<PickerGroup[]>("/api/groups");

  const [stageId, setStageId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [days, setDays] = useState("90");
  const [historyPage, setHistoryPage] = useState(1);

  const gradeOptions = stages?.find((s) => s.id === stageId)?.grades.filter((g) => g.isActive) ?? [];
  const groupOptions = useMemo(
    () => (groups ?? []).filter((g) => g.isActive && g.gradeId === gradeId),
    [groups, gradeId]
  );

  const perf = useApi<PerfData>(`/api/student-performance${qs({ stageId, gradeId, groupId, days })}`, [stageId, gradeId, groupId, days]);
  const history = useApi<{ recognitions: RecognitionRow[]; pagination: { totalPages: number } }>(
    `/api/student-recognitions${qs({ groupId, page: historyPage, pageSize: 10 })}`,
    [groupId, historyPage]
  );

  const [target, setTarget] = useState<PerfStudent | null>(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openRecognize(student: PerfStudent) {
    setTarget(student);
    setReason(t("sp.reasonDefault"));
    setDate(todayISO());
    setNotes("");
    setFormError(null);
  }

  async function submitRecognition(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiPost("/api/student-recognitions", {
        studentId: target.id,
        reason: reason.trim(),
        date,
        notes: notes.trim() || undefined
      });
      toast.success(t("sp.recognized"));
      setTarget(null);
      setHistoryPage(1);
      perf.reload();
      history.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("perf.err.generic"));
    } finally {
      setSaving(false);
    }
  }

  function reasonText(r: Reason): string {
    switch (r.code) {
      case "LOW_EXAM":
        return fmt(t("sp.reason.exam"), { v: r.value, th: r.threshold });
      case "LOW_HOMEWORK":
        return fmt(t("sp.reason.homework"), { v: r.value, th: r.threshold });
      case "LOW_RECITATION":
        return fmt(t("sp.reason.recitation"), { v: r.value, th: r.threshold });
      case "LOW_ATTENDANCE":
        return fmt(t("sp.reason.attendance"), { v: r.value, th: r.threshold });
      case "MISSED_EXAMS":
        return fmt(t("sp.reason.missedExams"), { v: r.value });
      case "LOW_OVERALL":
        return fmt(t("sp.reason.overall"), { v: r.value, th: r.threshold });
    }
  }

  const data = perf.data;
  const loadingPerf = perf.loading && !data;

  return (
    <div className="space-y-5">
      <PageHeader title={t("sp.title")} description={t("sp.subtitle")} />

      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("nav.stages")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={stageId}
              onChange={(e) => {
                setStageId(e.target.value);
                setGradeId("");
                setGroupId("");
                setHistoryPage(1);
              }}
            >
              <option value="">{t("common.all")}</option>
              {(stages ?? [])
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label={t("grades.title")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={gradeId}
              disabled={!stageId}
              onChange={(e) => {
                setGradeId(e.target.value);
                setGroupId("");
                setHistoryPage(1);
              }}
            >
              <option value="">{t("common.all")}</option>
              {gradeOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("nav.groups")}>
          {(id) => (
            <select
              id={id}
              className="input"
              value={groupId}
              disabled={!gradeId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setHistoryPage(1);
              }}
            >
              <option value="">{t("common.all")}</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.subject ? `${g.subject.name} · ` : ""}
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("sp.period")}>
          {(id) => (
            <select id={id} className="input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="30">{t("sp.period.30")}</option>
              <option value="90">{t("sp.period.90")}</option>
              <option value="180">{t("sp.period.180")}</option>
              <option value="365">{t("sp.period.365")}</option>
              <option value="0">{t("sp.period.all")}</option>
            </select>
          )}
        </Field>
      </div>

      <ErrorNotice message={perf.error} />
      {loadingPerf && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("sp.stat.students")} value={data.summary.students} />
            <StatCard label={t("sp.stat.ranked")} value={data.summary.ranked} tone="positive" />
            <StatCard label={t("sp.stat.need")} value={data.summary.needAttention} tone={data.summary.needAttention > 0 ? "warning" : "default"} />
            <StatCard label={t("sp.stat.noData")} value={data.summary.withoutData} />
          </div>
          {data.summary.truncated && <p className="text-xs text-amber-700 dark:text-amber-400">{t("sp.truncated")}</p>}

          <details className="card p-4 text-sm">
            <summary className="cursor-pointer font-semibold">{t("sp.method.title")}</summary>
            <div className="mt-3 space-y-2 text-black/70 dark:text-white/70">
              <p>{t("sp.method.intro")}</p>
              <ul className="list-disc space-y-1 ps-5">
                <li>{fmt(t("sp.method.exams"), { w: data.weights.exams })}</li>
                <li>{fmt(t("sp.method.attendance"), { w: data.weights.attendance })}</li>
                <li>{fmt(t("sp.method.homework"), { w: data.weights.homework })}</li>
                <li>{fmt(t("sp.method.recitation"), { w: data.weights.recitation })}</li>
              </ul>
              <p>{t("sp.method.missing")}</p>
              <p>{fmt(t("sp.method.ranking"), { n: data.minimums.categoriesForRanking })}</p>
              <p>
                {fmt(t("sp.method.thresholds"), {
                  exams: data.thresholds.exams,
                  homework: data.thresholds.homework,
                  recitation: data.thresholds.recitation,
                  attendance: data.thresholds.attendance,
                  overall: data.thresholds.overall
                })}
              </p>
            </div>
          </details>

          <Section title={t("sp.topTitle")} description={t("sp.topHint")}>
            {data.top.length === 0 ? (
              <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">{t("sp.topEmpty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-start text-sm">
                  <thead className="bg-black/[0.03] text-xs text-black/60 dark:bg-white/5 dark:text-white/60">
                    <tr>
                      {[
                        t("ex.rank"),
                        t("common.student"),
                        t("grades.title"),
                        t("nav.groups"),
                        t("sp.col.exam"),
                        t("sp.col.homework"),
                        t("sp.col.recitation"),
                        t("sp.col.attendance"),
                        t("sp.col.overall"),
                        ""
                      ].map((h, i) => (
                        <th key={i} className="p-3 text-start font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.top.map((s) => (
                      <tr key={s.id} className="border-t border-black/5 dark:border-white/5">
                        <td className="p-3 font-bold">{s.rank}</td>
                        <td className="p-3">
                          <p className="font-medium">{s.fullName}</p>
                          <p className="font-mono text-xs text-black/50 dark:text-white/50">{s.studentCode}</p>
                          {s.recognitionCount > 0 && (
                            <p className="text-xs text-emerald-700 dark:text-emerald-400">
                              🏅 {fmt(t("sp.recognizedTimes"), { n: s.recognitionCount })}
                            </p>
                          )}
                        </td>
                        <td className="p-3">{s.gradeName}</td>
                        <td className="p-3">
                          {s.groupName}
                          {s.subjectName && <span className="block text-xs text-black/50 dark:text-white/50">{s.subjectName}</span>}
                        </td>
                        <td className="p-3">{pct(s.examAvg)}</td>
                        <td className="p-3">{pct(s.homeworkPct)}</td>
                        <td className="p-3">{pct(s.recitationAvg)}</td>
                        <td className="p-3">{pct(s.attendancePct)}</td>
                        <td className="p-3">
                          <Badge tone="brand">{pct(s.overall)}</Badge>
                        </td>
                        <td className="p-3 text-end">
                          {perms.has("performance.recognize") && (
                            <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => openRecognize(s)}>
                              {t("sp.recognize")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title={t("sp.needTitle")} description={t("sp.needHint")}>
            {data.needsImprovement.length === 0 ? (
              <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">{t("sp.needEmpty")}</p>
            ) : (
              <ul className="divide-y divide-black/5 dark:divide-white/5">
                {data.needsImprovement.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="font-medium">{s.fullName}</p>
                      <p className="text-xs text-black/50 dark:text-white/50">
                        <span className="font-mono">{s.studentCode}</span> · {s.gradeName} · {s.groupName}
                        {s.subjectName ? ` · ${s.subjectName}` : ""}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {s.reasons.map((r) => (
                          <li key={r.code} className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                            <span aria-hidden>⚠️</span>
                            <span>{reasonText(r)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      {[
                        [t("sp.col.exam"), s.examAvg],
                        [t("sp.col.homework"), s.homeworkPct],
                        [t("sp.col.recitation"), s.recitationAvg],
                        [t("sp.col.attendance"), s.attendancePct]
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg bg-black/5 px-2 py-1 dark:bg-white/10">
                          <p className="text-black/50 dark:text-white/50">{label}</p>
                          <p className="font-semibold">{pct(value as number | null)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col items-start">
                      <WhatsAppButton url={s.whatsappUrl} issue={s.parentIssue} label={t("sp.notifyParent")} />
                      {!s.whatsappUrl && <ParentIssueHint issue={s.parentIssue} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section title={t("sp.historyTitle")}>
        {history.error && <div className="p-4"><ErrorNotice message={history.error} /></div>}
        {(history.data?.recognitions.length ?? 0) === 0 ? (
          <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">
            {history.loading ? t("common.loading") : t("sp.historyEmpty")}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-black/5 dark:divide-white/5">
              {history.data!.recognitions.map((r) => (
                <li key={r.id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      🏅 {r.student.fullName}{" "}
                      <span className="font-mono text-xs font-normal text-black/50 dark:text-white/50">{r.student.studentCode}</span>
                    </p>
                    <span className="text-xs text-black/55 dark:text-white/55">{formatDate(r.date)}</span>
                  </div>
                  <p className="mt-1">{r.reason}</p>
                  {r.notes && <p className="mt-0.5 text-xs text-black/60 dark:text-white/60">{r.notes}</p>}
                  <p className="mt-1 text-xs text-black/45 dark:text-white/45">
                    {r.student.gradeName} · {r.student.groupName}
                    {r.recordedBy ? ` · ${t("sp.recordedBy")}: ${r.recordedBy}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <div className="p-3">
              <Pager page={historyPage} totalPages={history.data!.pagination.totalPages} onChange={setHistoryPage} />
            </div>
          </>
        )}
      </Section>

      <Modal open={!!target} title={t("sp.recognize")} onClose={() => setTarget(null)}>
        <form onSubmit={submitRecognition} className="space-y-3">
          <ErrorNotice message={formError} />
          {target && (
            <p className="rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
              <strong>{target.fullName}</strong> · {target.gradeName} · {target.groupName}
            </p>
          )}
          <Field label={t("sp.reason")} required>
            {(id) => <input id={id} className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required />}
          </Field>
          <Field label={t("common.date")} required>
            {(id) => <input id={id} type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input min-h-[70px]" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={saving || reason.trim().length < 2 || !date}>
              {saving ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
