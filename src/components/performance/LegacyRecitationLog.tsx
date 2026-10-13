"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDate, qs, todayISO, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, Pager, useToast } from "@/components/ui";

interface SubjectOption {
  id: string;
  name: string;
}

interface StudentOption {
  id: string;
  fullName: string;
  studentCode: string;
}

interface RecitationRow {
  id: string;
  date: string;
  content: string;
  score: number | null;
  maxScore: number;
  status: string;
  notes: string | null;
  student: { id: string; fullName: string; studentCode: string };
}

const STATUSES = ["COMPLETED", "PARTIAL", "NOT_COMPLETED", "ABSENT"];

function toneFor(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "PARTIAL") return "warning" as const;
  if (status === "ABSENT") return "neutral" as const;
  return "danger" as const;
}

export function LegacyRecitationLog() {
  const { t } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useApi<{
    recitations: RecitationRow[];
    pagination: { page: number; totalPages: number };
  }>(`/api/recitations${qs({ page, pageSize: 25 })}`);
  const { data: subjects } = useApi<SubjectOption[]>("/api/subjects");

  const [modalOpen, setModalOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [studentLabel, setStudentLabel] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("COMPLETED");
  const [score, setScore] = useState("");
  const [maxScore, setMaxScore] = useState(10);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const term = studentQuery.trim();
    if (term.length < 2) {
      setStudentOptions([]);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`/api/search${qs({ q: term })}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((body) => setStudentOptions(body.data?.students ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [studentQuery]);

  function openCreate() {
    setStudentId("");
    setStudentLabel("");
    setStudentQuery("");
    setStudentOptions([]);
    setSubjectId(subjects?.[0]?.id ?? "");
    setDate(todayISO());
    setContent("");
    setStatus("COMPLETED");
    setScore("");
    setMaxScore(10);
    setNotes("");
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/recitations", {
        studentId,
        subjectId,
        date: new Date(date).toISOString(),
        content: content.trim(),
        status,
        score: status === "ABSENT" ? undefined : score.trim() ? Number(score) : undefined,
        maxScore,
        notes: notes.trim() || undefined
      });
      toast.success(t("common.created"));
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save recitation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("recitation.add")}
          </button>
      </div>

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("common.date"), t("common.student"), "Content", "Score", t("common.status"), t("common.notes")]}
        loading={loading}
        isEmpty={(data?.recitations.length ?? 0) === 0}
        emptyTitle={t("recitation.empty")}
      >
        {data?.recitations.map((r) => (
          <tr key={r.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3">{formatDate(r.date)}</td>
            <td className="p-3 font-medium">
              {r.student.fullName}
              <span className="ms-2 font-mono text-xs text-black/45 dark:text-white/45">{r.student.studentCode}</span>
            </td>
            <td className="p-3">{r.content}</td>
            <td className="p-3">{r.score !== null ? `${r.score}/${r.maxScore}` : "—"}</td>
            <td className="p-3">
              <Badge tone={toneFor(r.status)}>{r.status}</Badge>
            </td>
            <td className="p-3 text-xs text-black/55 dark:text-white/55">{r.notes ?? "—"}</td>
          </tr>
        ))}
      </DataTable>

      <Pager page={data?.pagination.page ?? 1} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />

      <Modal open={modalOpen} title={t("recitation.add")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("common.student")} required>
            {(id) => (
              <div className="relative">
                <input
                  id={id}
                  className="input"
                  placeholder="Search by name, code or phone"
                  value={studentId ? studentLabel : studentQuery}
                  onChange={(e) => {
                    setStudentId("");
                    setStudentQuery(e.target.value);
                  }}
                  required
                />
                {!studentId && studentOptions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-black/10 bg-white text-sm shadow-lg dark:border-white/10 dark:bg-surface-dark-muted">
                    {studentOptions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-start hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => {
                            setStudentId(s.id);
                            setStudentLabel(`${s.fullName} (${s.studentCode})`);
                            setStudentOptions([]);
                          }}
                        >
                          {s.fullName} <span className="font-mono text-xs opacity-60">{s.studentCode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label={t("common.subject")} required>
            {(id) => (
              <select id={id} className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                {subjects?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("common.date")} required>
            {(id) => <input id={id} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <Field label="Content" required hint="What was recited (e.g. Surah / pages)">
            {(id) => (
              <input id={id} className="input" value={content} onChange={(e) => setContent(e.target.value)} required />
            )}
          </Field>
          <Field label={t("common.status")} required>
            {(id) => (
              <select id={id} className="input" value={status} onChange={(e) => setStatus(e.target.value)} required>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {status !== "ABSENT" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Score">
                {(id) => (
                  <input id={id} type="number" min={0} className="input" value={score} onChange={(e) => setScore(e.target.value)} />
                )}
              </Field>
              <Field label="Max score">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={1}
                    className="input"
                    value={maxScore}
                    onChange={(e) => setMaxScore(Number(e.target.value))}
                  />
                )}
              </Field>
            </div>
          )}
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !studentId || !subjectId || !content.trim()}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
