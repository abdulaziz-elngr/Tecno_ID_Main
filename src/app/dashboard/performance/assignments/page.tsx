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
  useMyPermissions
} from "@/components/performance/shared";
import { LegacyAssignments } from "@/components/performance/LegacyAssignments";

/**
 * Homework (الواجب): Stage → Grade → Group, create homework linked to a lesson, then
 * mark every student Completed / Not completed (editable), with a WhatsApp link to
 * the parent. Stored in the existing Assignment / AssignmentSubmission tables.
 */

type State = "COMPLETED" | "NOT_COMPLETED" | "PENDING";

interface HomeworkRow {
  id: string;
  title: string;
  date: string;
  lessonNumber: number | null;
  studentCount: number;
  completedCount: number;
  notCompletedCount: number;
  pendingCount: number;
}

interface BoardStudent {
  id: string;
  fullName: string;
  studentCode: string;
  status: State;
  whatsappUrl: string | null;
  parentIssue: "NO_PARENT" | "INVALID_PHONE" | null;
}

interface Board {
  homework: {
    id: string;
    title: string;
    date: string;
    description: string | null;
    lessonNumber: number | null;
    group: { id: string; name: string; gradeName: string; stageName: string };
  };
  counts: { total: number; completed: number; notCompleted: number; pending: number };
  students: BoardStudent[];
}

function HomeworkBoard({ id, onBack }: { id: string; onBack: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const perms = useMyPermissions();
  const { data, error, reload } = useApi<Board>(`/api/homework/${id}`, [id]);

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const { homework: hw, counts, students } = data;
  const visible = students.filter((s) => matchesStudent(s, query));
  const canEdit = perms.has("assignments.manage");

  async function setStatus(student: BoardStudent, status: "COMPLETED" | "NOT_COMPLETED") {
    if (student.status === status) return;
    setErrors((e) => ({ ...e, [student.id]: "" }));
    setBusy((b) => ({ ...b, [student.id]: true }));
    try {
      await apiPut(`/api/homework/${id}/students/${student.id}`, { status });
      toast.success(t("common.saved"));
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
          <h2 className="text-lg font-bold">{hw.title}</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            <GroupBadgeLine group={hw.group} /> · {formatDate(hw.date)}
            {hw.lessonNumber !== null && ` · ${fmt(t("lesson.label"), { n: hw.lessonNumber })}`}
          </p>
          {hw.description && <p className="mt-1 text-sm text-black/60 dark:text-white/60">{hw.description}</p>}
        </div>
        <button type="button" className="btn-secondary" onClick={onBack}>
          {t("common.back")}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-live="polite">
        <StatCard label={t("ex.totalStudents")} value={counts.total} />
        <StatCard label={t("hw.completed")} value={counts.completed} tone="positive" />
        <StatCard label={t("hw.notCompleted")} value={counts.notCompleted} tone={counts.notCompleted > 0 ? "negative" : "default"} />
        <StatCard label={t("hw.pending")} value={counts.pending} tone={counts.pending > 0 ? "warning" : "default"} />
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
              const rowBusy = !!busy[student.id];
              const err = errors[student.id];
              return (
                <li key={student.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="truncate font-medium">{student.fullName}</p>
                    <p className="flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
                      <span className="font-mono">{student.studentCode}</span>
                      <Badge tone={student.status === "COMPLETED" ? "success" : student.status === "NOT_COMPLETED" ? "danger" : "warning"}>
                        {student.status === "COMPLETED" ? t("hw.completed") : student.status === "NOT_COMPLETED" ? t("hw.notCompleted") : t("hw.pending")}
                      </Badge>
                    </p>
                  </div>
                  <div className="flex items-center gap-2" role="group" aria-label={student.fullName}>
                    <button
                      type="button"
                      disabled={rowBusy || !canEdit}
                      aria-pressed={student.status === "COMPLETED"}
                      onClick={() => setStatus(student, "COMPLETED")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                        student.status === "COMPLETED" ? "bg-emerald-600 text-white" : "bg-black/5 hover:bg-black/10 dark:bg-white/10"
                      }`}
                    >
                      {t("hw.completed")}
                    </button>
                    <button
                      type="button"
                      disabled={rowBusy || !canEdit}
                      aria-pressed={student.status === "NOT_COMPLETED"}
                      onClick={() => setStatus(student, "NOT_COMPLETED")}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                        student.status === "NOT_COMPLETED" ? "bg-red-600 text-white" : "bg-black/5 hover:bg-black/10 dark:bg-white/10"
                      }`}
                    >
                      {t("hw.notCompleted")}
                    </button>
                  </div>
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

function HomeworkInner() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const perms = useMyPermissions();

  const [tab, setTab] = useState<"homework" | "legacy">("homework");
  const [groupId, setGroupId] = useState(search.get("groupId") ?? "");
  const [openId, setOpenId] = useState(search.get("hw") ?? "");

  useEffect(() => {
    router.replace(`/dashboard/performance/assignments${qs({ groupId, hw: openId })}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, openId]);

  const { data, loading, error, reload } = useApi<{ homework: HomeworkRow[] }>(groupId ? `/api/homework${qs({ groupId })}` : null);

  const [modalOpen, setModalOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate() {
    setSessionId("");
    setTitle("");
    setDate("");
    setDescription("");
    setFormError(null);
    setModalOpen(true);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await apiPost<{ id: string }>("/api/homework", {
        groupId,
        sessionId,
        title: title.trim(),
        date,
        description: description.trim() || undefined
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("assignments.title")}
        description={t("hw.subtitle")}
        actions={
          tab === "homework" && groupId && !openId && perms.has("assignments.manage") ? (
            <button type="button" className="btn-primary" onClick={openCreate}>
              {t("hw.create")}
            </button>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "homework", label: t("hw.tabHomework") },
          { id: "legacy", label: t("hw.tabLegacy") }
        ]}
      />

      {tab === "legacy" && <LegacyAssignments />}

      {tab === "homework" && (
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

          {groupId && openId && <HomeworkBoard id={openId} onBack={() => setOpenId("")} />}

          {groupId && !openId && (
            <>
              <ErrorNotice message={error} />
              <DataTable
                columns={[t("hw.col.title"), t("common.date"), t("perf.lesson"), t("ex.col.students"), t("hw.completed"), t("hw.notCompleted"), t("hw.pending"), ""]}
                loading={loading && !data}
                isEmpty={(data?.homework.length ?? 0) === 0}
                emptyTitle={t("assignments.empty")}
                emptyDescription={perms.has("assignments.manage") ? t("hw.emptyHint") : undefined}
              >
                {data?.homework.map((h) => (
                  <tr key={h.id} className="border-b border-black/5 dark:border-white/5">
                    <td className="p-3 font-medium">{h.title}</td>
                    <td className="p-3 whitespace-nowrap">{formatDate(h.date)}</td>
                    <td className="p-3">{h.lessonNumber !== null ? fmt(t("lesson.label"), { n: h.lessonNumber }) : "—"}</td>
                    <td className="p-3">{h.studentCount}</td>
                    <td className="p-3">{h.completedCount}</td>
                    <td className="p-3">{h.notCompletedCount}</td>
                    <td className="p-3">{h.pendingCount}</td>
                    <td className="p-3 text-end">
                      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setOpenId(h.id)}>
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

      <Modal open={modalOpen} title={t("hw.create")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("hw.col.title")} required>
            {(id) => <input id={id} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />}
          </Field>
          <LessonPicker
            groupId={groupId}
            value={sessionId}
            onChange={(id, lesson) => {
              setSessionId(id);
              if (lesson && !date) setDate(lesson.date.slice(0, 10));
            }}
          />
          <Field label={t("common.date")} required>
            {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <Field label={t("hw.details")}>
            {(id) => (
              <textarea id={id} className="input min-h-[70px]" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !sessionId || !date || title.trim().length < 2}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function HomeworkPage() {
  return (
    <Suspense fallback={null}>
      <HomeworkInner />
    </Suspense>
  );
}
