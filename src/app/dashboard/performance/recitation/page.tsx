"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiPost, apiPut, formatDate, qs, useApi } from "@/lib/client";
import { fmt } from "@/lib/lesson-format";
import { Badge, DataTable, ErrorNotice, Field, Modal, PageHeader, StatCard, useToast } from "@/components/ui";
import { GroupPicker } from "@/components/GroupPicker";
import {
  GroupBadgeLine,
  LessonPicker,
  ParentIssueHint,
  Section,
  StudentSearch,
  Tabs,
  WhatsAppButton,
  matchesStudent,
  parseScoreInput,
  useMyPermissions
} from "@/components/performance/shared";
import { LegacyRecitationLog } from "@/components/performance/LegacyRecitationLog";

/**
 * Recitation (التسميع): Stage → Grade → Group, create a recitation for one lesson,
 * then grade every student (search, Save, edit, WhatsApp to the parent).
 */

interface RecitationRow {
  id: string;
  title: string | null;
  date: string;
  maxScore: number;
  sessionId: string;
  lessonNumber: number | null;
  studentCount: number;
  gradedCount: number;
  pendingCount: number;
}

interface BoardStudent {
  id: string;
  fullName: string;
  studentCode: string;
  status: "GRADED" | "PENDING";
  score: number | null;
  percentage: number | null;
  whatsappUrl: string | null;
  parentIssue: "NO_PARENT" | "INVALID_PHONE" | null;
}

interface Board {
  recitation: {
    id: string;
    title: string | null;
    date: string;
    maxScore: number;
    notes: string | null;
    lessonNumber: number | null;
    group: { id: string; name: string; gradeName: string; stageName: string };
  };
  counts: { total: number; graded: number; pending: number };
  students: BoardStudent[];
}

function RecitationBoard({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const perms = useMyPermissions();
  const { data, error, reload } = useApi<Board>(`/api/recitation-sessions/${id}`, [id]);

  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  if (!data) {
    return (
      <div className="space-y-3">
        <ErrorNotice message={error} />
        {!error && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t("common.back")}
        </button>
      </div>
    );
  }

  const { recitation: rec, counts, students } = data;
  const visible = students.filter((s) => matchesStudent(s, query));

  async function save(student: BoardStudent) {
    const raw = drafts[student.id] ?? (student.score !== null ? String(student.score) : "");
    const parsed = parseScoreInput(raw, rec.maxScore);
    if (!parsed.ok) {
      setErrors((e) => ({ ...e, [student.id]: fmt(t(parsed.error), { max: rec.maxScore }) }));
      return;
    }
    setErrors((e) => ({ ...e, [student.id]: "" }));
    setBusy((b) => ({ ...b, [student.id]: true }));
    try {
      await apiPut(`/api/recitation-sessions/${id}/students/${student.id}`, { score: parsed.value });
      toast.success(t("common.saved"));
      setDrafts((d) => {
        const { [student.id]: _removed, ...rest } = d;
        void _removed;
        return rest;
      });
      reload();
    } catch (err) {
      setErrors((e) => ({ ...e, [student.id]: err instanceof Error ? err.message : t("perf.err.generic") }));
    } finally {
      setBusy((b) => ({ ...b, [student.id]: false }));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">
            {rec.lessonNumber !== null ? fmt(t("lesson.label"), { n: rec.lessonNumber }) : t("lesson.legacy")}
            {rec.title ? ` — ${rec.title}` : ""}
          </h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            <GroupBadgeLine group={rec.group} /> · {formatDate(rec.date)} · {t("rc.max")}: <strong>{rec.maxScore}</strong>
          </p>
          {rec.notes && <p className="mt-1 text-sm text-black/60 dark:text-white/60">{rec.notes}</p>}
        </div>
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t("common.back")}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3" aria-live="polite">
        <StatCard label={t("ex.totalStudents")} value={counts.total} />
        <StatCard label={t("ex.graded")} value={counts.graded} tone="positive" />
        <StatCard label={t("rc.pending")} value={counts.pending} tone={counts.pending > 0 ? "warning" : "default"} />
      </div>

      <StudentSearch value={query} onChange={setQuery} />

      <Section title={t("rc.studentsTitle")}>
        {visible.length === 0 ? (
          <p className="p-5 text-center text-sm text-black/55 dark:text-white/55">
            {students.length === 0 ? t("perf.noStudents") : t("perf.noMatch")}
          </p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {visible.map((student) => {
              const value = drafts[student.id] ?? (student.score !== null ? String(student.score) : "");
              const changed = drafts[student.id] !== undefined && drafts[student.id] !== (student.score !== null ? String(student.score) : "");
              const rowBusy = !!busy[student.id];
              const canSave = !rowBusy && value.trim() !== "" && (student.status !== "GRADED" || changed);
              const err = errors[student.id];
              return (
                <li key={student.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="truncate font-medium">{student.fullName}</p>
                    <p className="flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
                      <span className="font-mono">{student.studentCode}</span>
                      <Badge tone={student.status === "GRADED" ? "success" : "warning"}>
                        {student.status === "GRADED" ? t("ex.status.graded") : t("ex.status.pending")}
                      </Badge>
                    </p>
                  </div>
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (canSave) void save(student);
                    }}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      className={`input w-20 py-1 text-center ${err ? "border-red-500" : ""}`}
                      value={value}
                      placeholder="—"
                      disabled={rowBusy || !perms.has("recitation.manage")}
                      aria-label={`${t("ex.grade")} — ${student.fullName}`}
                      aria-invalid={!!err}
                      onChange={(e) => {
                        setDrafts((d) => ({ ...d, [student.id]: e.target.value }));
                        setErrors((x) => ({ ...x, [student.id]: "" }));
                      }}
                    />
                    <span className="text-xs text-black/50 dark:text-white/50">/ {rec.maxScore}</span>
                    <button type="submit" className="btn-primary px-3 py-1 text-sm" disabled={!canSave}>
                      {rowBusy ? "…" : t("common.save")}
                    </button>
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
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function RecitationInner() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const perms = useMyPermissions();

  const [tab, setTab] = useState<"lessons" | "legacy">("lessons");
  const [groupId, setGroupId] = useState(search.get("groupId") ?? "");
  const [openId, setOpenId] = useState(search.get("rec") ?? "");

  useEffect(() => {
    router.replace(`/dashboard/performance/recitation${qs({ groupId, rec: openId })}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, openId]);

  const { data, loading, error, reload } = useApi<{ recitations: RecitationRow[] }>(
    groupId ? `/api/recitation-sessions${qs({ groupId })}` : null
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [date, setDate] = useState("");
  const [maxScore, setMaxScore] = useState("10");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate() {
    setSessionId("");
    setDate("");
    setMaxScore("10");
    setTitle("");
    setNotes("");
    setFormError(null);
    setModalOpen(true);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const max = Number(maxScore);
    if (!Number.isFinite(max) || max <= 0 || max > 999) {
      setFormError(t("ex.err.maxScore"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await apiPost<{ id: string }>("/api/recitation-sessions", {
        groupId,
        sessionId,
        date: date || undefined,
        maxScore: max,
        title: title.trim() || undefined,
        notes: notes.trim() || undefined
      });
      toast.success(t("common.created"));
      setModalOpen(false);
      reload();
      setOpenId(created.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("perf.err.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  const usedLessons = (data?.recitations ?? []).map((r) => r.sessionId);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("recitation.title")}
        description={t("rc.subtitle")}
        actions={
          tab === "lessons" && groupId && !openId && perms.has("recitation.manage") ? (
            <button type="button" className="btn-primary" onClick={openCreate}>
              {t("rc.create")}
            </button>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "lessons", label: t("rc.tabLessons") },
          { id: "legacy", label: t("rc.tabLegacy") }
        ]}
      />

      {tab === "legacy" && <LegacyRecitationLog />}

      {tab === "lessons" && (
        <>
          <div className="card p-4">
            <GroupPicker
              groupId={groupId}
              onChange={(id) => {
                setGroupId(id);
                setOpenId("");
              }}
            />
          </div>

          {!groupId && <div className="card p-6 text-sm text-black/60 dark:text-white/60">{t("lf.pickGroup")}</div>}

          {groupId && openId && <RecitationBoard id={openId} onBack={() => setOpenId("")} />}

          {groupId && !openId && (
            <>
              <ErrorNotice message={error} />
              <DataTable
                columns={[t("perf.lesson"), t("common.date"), t("rc.max"), t("ex.col.students"), t("ex.col.graded"), t("rc.pending"), ""]}
                loading={loading && !data}
                isEmpty={(data?.recitations.length ?? 0) === 0}
                emptyTitle={t("recitation.empty")}
                emptyDescription={perms.has("recitation.manage") ? t("rc.emptyHint") : undefined}
              >
                {data?.recitations.map((r) => (
                  <tr key={r.id} className="border-b border-black/5 dark:border-white/5">
                    <td className="p-3 font-medium">
                      {r.lessonNumber !== null ? fmt(t("lesson.label"), { n: r.lessonNumber }) : t("lesson.legacy")}
                      {r.title && <span className="block text-xs font-normal text-black/50 dark:text-white/50">{r.title}</span>}
                    </td>
                    <td className="p-3 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="p-3">{r.maxScore}</td>
                    <td className="p-3">{r.studentCount}</td>
                    <td className="p-3">{r.gradedCount}</td>
                    <td className="p-3">{r.pendingCount}</td>
                    <td className="p-3 text-end">
                      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setOpenId(r.id)}>
                        {t("ex.open")}
                      </button>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}
        </>
      )}

      <Modal open={modalOpen} title={t("rc.create")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorNotice message={formError} />
          <LessonPicker
            groupId={groupId}
            value={sessionId}
            disabledLessonIds={usedLessons}
            onChange={(id, lesson) => {
              setSessionId(id);
              if (lesson) setDate(lesson.date.slice(0, 10));
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("common.date")} required>
              {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />}
            </Field>
            <Field label={t("rc.max")} required>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0.5}
                  max={999}
                  step="any"
                  inputMode="decimal"
                  className="input"
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  required
                />
              )}
            </Field>
          </div>
          <Field label={t("rc.titleOptional")}>
            {(id) => <input id={id} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input min-h-[70px]" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !sessionId || !date}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function RecitationPage() {
  return (
    <Suspense fallback={null}>
      <RecitationInner />
    </Suspense>
  );
}
