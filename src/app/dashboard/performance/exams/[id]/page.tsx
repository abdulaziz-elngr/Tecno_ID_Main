"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiPatch, apiPost, apiPut, formatDateTime, qs, useApi } from "@/lib/client";
import { fmt } from "@/lib/lesson-format";
import { Badge, ErrorNotice, Field, Modal, PageHeader, StatCard, useToast } from "@/components/ui";
import {
  GroupBadgeLine,
  ParentIssueHint,
  Section,
  StudentSearch,
  WhatsAppButton,
  matchesStudent,
  parseScoreInput,
  useMyPermissions
} from "@/components/performance/shared";

/**
 * Exam grading page: live counters, per-student grade entry (Save), an Absent button
 * for students without a grade, parent WhatsApp links and the Top 10. Everything is
 * re-read from /api/exams/:id/board after every change, so counters and ranking are
 * always the database's truth.
 */

type Status = "GRADED" | "ABSENT" | "PENDING";

interface BoardStudent {
  id: string;
  fullName: string;
  studentCode: string;
  status: Status;
  score: number | null;
  percentage: number | null;
  whatsappUrl: string | null;
  parentIssue: "NO_PARENT" | "INVALID_PHONE" | null;
}

interface Board {
  exam: {
    id: string;
    name: string;
    date: string;
    maxScore: number;
    durationMinutes: number | null;
    description: string | null;
    isPublished: boolean;
    subject: { id: string; name: string };
    group: { id: string; name: string; gradeName: string; stageName: string };
  };
  counts: { total: number; graded: number; notGraded: number; absent: number };
  statistics: { average: number | null; averagePercentage: number | null; passRate: number | null; highest: number | null };
  students: BoardStudent[];
  top: { rank: number; studentId: string; fullName: string; studentCode: string; score: number; percentage: number }[];
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function ExamBoardPage() {
  const { t } = useI18n();
  const toast = useToast();
  const perms = useMyPermissions();
  const params = useParams<{ id: string }>();
  const examId = params.id;

  const { data, error, reload } = useApi<Board>(`/api/exams/${examId}/board`);

  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editMax, setEditMax] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("exams.title")} />
        <ErrorNotice message={error} />
        {!error && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  const { exam, counts, students, top, statistics } = data;
  const max = exam.maxScore;
  const visible = students.filter((s) => matchesStudent(s, query));
  const pending = visible.filter((s) => s.status === "PENDING");
  const recorded = visible.filter((s) => s.status !== "PENDING");

  function setBusyFor(id: string, value: boolean) {
    setBusy((b) => ({ ...b, [id]: value }));
  }

  async function save(student: BoardStudent) {
    const raw = drafts[student.id] ?? (student.score !== null ? String(student.score) : "");
    const parsed = parseScoreInput(raw, max);
    if (!parsed.ok) {
      setRowErrors((e) => ({ ...e, [student.id]: fmt(t(parsed.error), { max }) }));
      return;
    }
    setRowErrors((e) => ({ ...e, [student.id]: "" }));
    setBusyFor(student.id, true);
    try {
      await apiPut(`/api/exams/${examId}/results/${student.id}`, { score: parsed.value, isAbsent: false });
      toast.success(t("common.saved"));
      setDrafts((d) => {
        const { [student.id]: _removed, ...rest } = d;
        void _removed;
        return rest;
      });
      reload();
    } catch (err) {
      setRowErrors((e) => ({ ...e, [student.id]: err instanceof Error ? err.message : t("perf.err.generic") }));
    } finally {
      setBusyFor(student.id, false);
    }
  }

  async function setAbsent(student: BoardStudent, absent: boolean) {
    setRowErrors((e) => ({ ...e, [student.id]: "" }));
    setBusyFor(student.id, true);
    try {
      await apiPut(`/api/exams/${examId}/results/${student.id}`, { score: null, isAbsent: absent });
      toast.success(absent ? t("ex.markedAbsent") : t("common.saved"));
      reload();
    } catch (err) {
      setRowErrors((e) => ({ ...e, [student.id]: err instanceof Error ? err.message : t("perf.err.generic") }));
    } finally {
      setBusyFor(student.id, false);
    }
  }

  async function publish() {
    setPublishing(true);
    setActionError(null);
    try {
      await apiPost(`/api/exams/${examId}/publish`);
      toast.success(t("exams.published"));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("perf.err.generic"));
    } finally {
      setPublishing(false);
    }
  }

  function openEdit() {
    setEditName(exam.name);
    setEditDate(toLocalInput(exam.date));
    setEditMax(String(exam.maxScore));
    setEditDescription(exam.description ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    const newMax = Number(editMax);
    if (!Number.isFinite(newMax) || newMax <= 0) {
      setEditError(t("ex.err.maxScore"));
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await apiPatch(`/api/exams/${examId}`, {
        name: editName.trim(),
        date: new Date(editDate).toISOString(),
        maxScore: newMax,
        description: editDescription.trim() || undefined
      });
      toast.success(t("common.saved"));
      setEditOpen(false);
      reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t("perf.err.generic"));
    } finally {
      setEditBusy(false);
    }
  }

  function statusBadge(status: Status) {
    if (status === "GRADED") return <Badge tone="success">{t("ex.status.graded")}</Badge>;
    if (status === "ABSENT") return <Badge tone="danger">{t("ex.status.absent")}</Badge>;
    return <Badge tone="warning">{t("ex.status.pending")}</Badge>;
  }

  function renderRow(student: BoardStudent) {
    const value = drafts[student.id] ?? (student.score !== null ? String(student.score) : "");
    const changed = drafts[student.id] !== undefined && drafts[student.id] !== (student.score !== null ? String(student.score) : "");
    const rowBusy = !!busy[student.id];
    const canSave = !rowBusy && value.trim() !== "" && (student.status !== "GRADED" || changed);
    const err = rowErrors[student.id];

    return (
      <li key={student.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
        <div className="min-w-0 flex-1 basis-44">
          <p className="truncate font-medium">{student.fullName}</p>
          <p className="flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
            <span className="font-mono">{student.studentCode}</span>
            {statusBadge(student.status)}
          </p>
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) void save(student);
          }}
        >
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                className={`input w-20 py-1 text-center ${err ? "border-red-500" : ""}`}
                value={value}
                disabled={rowBusy || !perms.has("grades.enter")}
                aria-label={`${t("ex.grade")} — ${student.fullName}`}
                aria-invalid={!!err}
                placeholder="—"
                onChange={(e) => {
                  setDrafts((d) => ({ ...d, [student.id]: e.target.value }));
                  setRowErrors((x) => ({ ...x, [student.id]: "" }));
                }}
              />
              <span className="text-xs text-black/50 dark:text-white/50">/ {max}</span>
            </div>
          </div>
          <button type="submit" className="btn-primary px-3 py-1 text-sm" disabled={!canSave}>
            {rowBusy ? "…" : t("common.save")}
          </button>
          {student.status === "PENDING" && perms.has("grades.enter") && (
            <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={rowBusy} onClick={() => setAbsent(student, true)}>
              {t("ex.absentBtn")}
            </button>
          )}
          {student.status === "ABSENT" && perms.has("grades.enter") && (
            <button type="button" className="btn-secondary px-3 py-1 text-sm" disabled={rowBusy} onClick={() => setAbsent(student, false)}>
              {t("ex.undoAbsent")}
            </button>
          )}
        </form>

        <div className="flex flex-col items-start">
          <WhatsAppButton
            url={student.whatsappUrl}
            issue={student.parentIssue}
            label={t("perf.sendParent")}
            noResultYet={student.status === "PENDING"}
          />
          {student.status !== "PENDING" && !student.whatsappUrl && <ParentIssueHint issue={student.parentIssue} />}
        </div>

        {err && (
          <p role="alert" className="basis-full text-xs text-red-600 dark:text-red-400">
            {err}
          </p>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={exam.name}
        description={`${exam.subject.name} · ${exam.group.stageName} · ${exam.group.gradeName} · ${exam.group.name} · ${formatDateTime(exam.date)}`}
        actions={
          <>
            <Link href={`/dashboard/performance/exams${qs({ groupId: exam.group.id })}`} className="btn-secondary">
              {t("common.back")}
            </Link>
            {perms.has("exams.update") && (
              <button type="button" className="btn-secondary" onClick={openEdit}>
                {t("ex.editExam")}
              </button>
            )}
            {!exam.isPublished && perms.has("exams.publish") && (
              <button type="button" className="btn-primary" disabled={publishing} onClick={publish}>
                {publishing ? t("common.loading") : t("exams.publish")}
              </button>
            )}
          </>
        }
      />

      <ErrorNotice message={error ?? actionError} />

      <div className="flex flex-wrap items-center gap-2 text-sm text-black/60 dark:text-white/60">
        <Badge tone={exam.isPublished ? "success" : "neutral"}>{exam.isPublished ? t("exams.published") : t("exams.draft")}</Badge>
        <span>
          {t("ex.col.max")}: <strong>{exam.maxScore}</strong>
        </span>
        {exam.durationMinutes && (
          <span>
            · {t("ex.duration")}: {exam.durationMinutes}
          </span>
        )}
        <GroupBadgeLine group={exam.group} />
      </div>
      {exam.description && <p className="card p-3 text-sm text-black/70 dark:text-white/70">{exam.description}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-live="polite">
        <StatCard label={t("ex.totalStudents")} value={counts.total} />
        <StatCard label={t("ex.graded")} value={counts.graded} tone="positive" />
        <StatCard label={t("ex.notGraded")} value={counts.notGraded} tone={counts.notGraded > 0 ? "warning" : "default"} />
        <StatCard label={t("ex.absent")} value={counts.absent} tone={counts.absent > 0 ? "negative" : "default"} />
      </div>
      {statistics.average !== null && (
        <p className="text-sm text-black/60 dark:text-white/60">
          {t("ex.average")}: <strong>{statistics.average}</strong>
          {statistics.averagePercentage !== null && ` (${statistics.averagePercentage}%)`}
          {statistics.passRate !== null && ` · ${t("ex.passRate")}: ${statistics.passRate}%`}
        </p>
      )}

      <StudentSearch value={query} onChange={setQuery} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Section title={fmt(t("ex.sectionPending"), { n: counts.notGraded })} description={t("ex.sectionPendingHint")}>
            {pending.length === 0 ? (
              <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">
                {counts.notGraded === 0 ? t("ex.allDone") : t("perf.noMatch")}
              </p>
            ) : (
              <ul className="divide-y divide-black/5 dark:divide-white/5">{pending.map(renderRow)}</ul>
            )}
          </Section>

          <Section title={fmt(t("ex.sectionRecorded"), { n: counts.graded + counts.absent })} description={t("ex.sectionRecordedHint")}>
            {recorded.length === 0 ? (
              <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">
                {counts.graded + counts.absent === 0 ? t("ex.noneRecorded") : t("perf.noMatch")}
              </p>
            ) : (
              <ul className="divide-y divide-black/5 dark:divide-white/5">{recorded.map(renderRow)}</ul>
            )}
          </Section>
        </div>

        <Section title={t("ex.topStudents")} description={t("ex.topHint")}>
          {top.length === 0 ? (
            <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">{t("ex.topEmpty")}</p>
          ) : (
            <ol className="divide-y divide-black/5 dark:divide-white/5">
              {top.map((row) => (
                <li key={row.studentId} className="flex items-center gap-3 p-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      row.rank === 1
                        ? "bg-tecno-gold text-tecno-ink"
                        : row.rank <= 3
                          ? "bg-tecno-gold/25"
                          : "bg-black/5 dark:bg-white/10"
                    }`}
                    aria-label={`${t("ex.rank")} ${row.rank}`}
                  >
                    {row.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.fullName}</p>
                    <p className="font-mono text-xs text-black/50 dark:text-white/50">{row.studentCode}</p>
                  </div>
                  <div className="text-end text-sm">
                    <p className="font-semibold">
                      {row.score}
                      <span className="text-xs font-normal text-black/50 dark:text-white/50"> / {max}</span>
                    </p>
                    <p className="text-xs text-black/55 dark:text-white/55">{row.percentage}%</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <Modal open={editOpen} title={t("ex.editExam")} onClose={() => setEditOpen(false)}>
        <form onSubmit={submitEdit} className="space-y-3">
          <ErrorNotice message={editError} />
          <Field label={t("ex.col.name")} required>
            {(id) => <input id={id} className="input" value={editName} onChange={(e) => setEditName(e.target.value)} required maxLength={150} />}
          </Field>
          <Field label={t("common.date")} required>
            {(id) => <input id={id} type="datetime-local" className="input" value={editDate} onChange={(e) => setEditDate(e.target.value)} required />}
          </Field>
          <Field label={t("ex.col.max")} required>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0.5}
                step="any"
                inputMode="decimal"
                className="input"
                value={editMax}
                onChange={(e) => setEditMax(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label={t("ex.details")}>
            {(id) => (
              <textarea id={id} className="input min-h-[80px]" value={editDescription} maxLength={1000} onChange={(e) => setEditDescription(e.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={editBusy || !editName.trim() || !editDate}>
              {editBusy ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
