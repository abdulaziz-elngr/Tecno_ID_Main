"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, apiPut, formatDate, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, useToast } from "@/components/ui";

interface GroupOption {
  id: string;
  name: string;
  grade: { name: string; stage: { name: string } };
}

interface AssignmentRow {
  id: string;
  title: string;
  dueDate: string;
  maxScore: number;
  group: { id: string; name: string; grade: { name: string; stage: { name: string } } };
  _count: { submissions: number };
}

interface SubmissionRow {
  id: string;
  student: { id: string; fullName: string; studentCode: string };
  status: string;
  submittedAt: string | null;
  grade: number | null;
  feedback: string | null;
}

const STATUSES = ["PENDING", "SUBMITTED", "LATE", "GRADED", "MISSING"];

function toneFor(status: string) {
  if (status === "GRADED") return "success" as const;
  if (status === "SUBMITTED") return "brand" as const;
  if (status === "LATE" || status === "MISSING") return "danger" as const;
  return "neutral" as const;
}

export function LegacyAssignments() {
  const { t } = useI18n();
  const toast = useToast();

  const { data, loading, error, reload } = useApi<{ assignments: AssignmentRow[] }>("/api/assignments?pageSize=100");
  const { data: groups } = useApi<GroupOption[]>("/api/groups");

  const [createOpen, setCreateOpen] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [maxScore, setMaxScore] = useState(10);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AssignmentRow | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { status: string; grade: string; feedback: string }>>({});
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [savingSubmissions, setSavingSubmissions] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  function openCreate() {
    setGroupId(groups?.[0]?.id ?? "");
    setTitle("");
    setDueDate("");
    setMaxScore(10);
    setDescription("");
    setFormError(null);
    setCreateOpen(true);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/assignments", {
        groupId,
        title: title.trim(),
        description: description.trim() || undefined,
        dueDate: new Date(dueDate).toISOString(),
        maxScore
      });
      toast.success(t("common.created"));
      setCreateOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create assignment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function openSubmissions(assignment: AssignmentRow) {
    setSelected(assignment);
    setLoadingSubmissions(true);
    setSubError(null);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}/submissions`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load submissions.");
      setSubmissions(body.data.submissions);
      const next: Record<string, { status: string; grade: string; feedback: string }> = {};
      for (const s of body.data.submissions as SubmissionRow[]) {
        next[s.student.id] = {
          status: s.status,
          grade: s.grade !== null ? String(s.grade) : "",
          feedback: s.feedback ?? ""
        };
      }
      setDraft(next);
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Failed to load submissions.");
    } finally {
      setLoadingSubmissions(false);
    }
  }

  async function saveSubmissions() {
    if (!selected) return;
    setSavingSubmissions(true);
    setSubError(null);
    try {
      await apiPut(`/api/assignments/${selected.id}/submissions`, {
        submissions: submissions.map((s) => {
          const d = draft[s.student.id] ?? { status: s.status, grade: "", feedback: "" };
          return {
            studentId: s.student.id,
            status: d.status,
            grade: d.grade.trim() ? Number(d.grade) : null,
            feedback: d.feedback.trim() || undefined
          };
        })
      });
      toast.success(t("common.saved"));
      setSelected(null);
      reload();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Failed to save submissions.");
    } finally {
      setSavingSubmissions(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={openCreate} disabled={!groups?.length}>
            {t("assignments.add")}
          </button>
      </div>

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("assignments.title"), t("common.group"), "Stage / Grade", "Due", "Max score", "Submissions"]}
        loading={loading}
        isEmpty={(data?.assignments.length ?? 0) === 0}
        emptyTitle={t("assignments.empty")}
      >
        {data?.assignments.map((a) => (
          <tr key={a.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">
              <button type="button" className="hover:underline" onClick={() => openSubmissions(a)}>
                {a.title}
              </button>
            </td>
            <td className="p-3">{a.group.name}</td>
            <td className="p-3">{a.group.grade.stage.name} / {a.group.grade.name}</td>
            <td className="p-3">{formatDate(a.dueDate)}</td>
            <td className="p-3">{a.maxScore}</td>
            <td className="p-3">{a._count.submissions}</td>
          </tr>
        ))}
      </DataTable>

      <Modal open={createOpen} title={t("assignments.add")} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("common.group")} required>
            {(id) => (
              <select id={id} className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
                {groups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.grade.stage.name} · {g.grade.name} · {g.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Title" required>
            {(id) => <input id={id} className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />}
          </Field>
          <Field label="Due date" required>
            {(id) => (
              <input id={id} type="datetime-local" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            )}
          </Field>
          <Field label="Max score" required>
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                className="input"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                required
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => <textarea id={id} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !title.trim() || !groupId || !dueDate}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selected)}
        title={selected?.title ?? ""}
        onClose={() => setSelected(null)}
        footer={
          <button type="button" className="btn-primary" disabled={savingSubmissions || loadingSubmissions} onClick={saveSubmissions}>
            {savingSubmissions ? t("common.loading") : t("common.save")}
          </button>
        }
      >
        <ErrorNotice message={subError} />
        {loadingSubmissions ? (
          <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((s) => {
              const d = draft[s.student.id];
              return (
                <div key={s.id} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium">{s.student.fullName}</span>
                    <Badge tone={toneFor(d?.status ?? s.status)}>{d?.status ?? s.status}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      className="input py-1 text-xs"
                      value={d?.status}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [s.student.id]: { ...(prev[s.student.id] ?? { status: s.status, grade: "", feedback: "" }), status: e.target.value }
                        }))
                      }
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      placeholder="Grade"
                      className="input py-1 text-xs"
                      value={d?.grade ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [s.student.id]: { ...(prev[s.student.id] ?? { status: s.status, grade: "", feedback: "" }), grade: e.target.value }
                        }))
                      }
                    />
                    <input
                      placeholder="Feedback"
                      className="input py-1 text-xs"
                      value={d?.feedback ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [s.student.id]: { ...(prev[s.student.id] ?? { status: s.status, grade: "", feedback: "" }), feedback: e.target.value }
                        }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
