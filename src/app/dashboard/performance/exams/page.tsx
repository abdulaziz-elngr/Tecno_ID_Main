"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDateTime, useApi, qs } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";
import { GroupPicker } from "@/components/GroupPicker";
import { useGroupInfo, useMyPermissions } from "@/components/performance/shared";
import { fmt } from "@/lib/lesson-format";

/**
 * Exams — Stage → Grade → Group, then the group's exams. Creating an exam links it
 * to the selected group (and therefore its grade and stage); opening one goes to the
 * grading page.
 */

interface SubjectOption {
  id: string;
  name: string;
}

interface ExamRow {
  id: string;
  name: string;
  date: string;
  maxScore: number;
  isPublished: boolean;
  subject: { id: string; name: string };
  studentCount: number;
  gradedCount: number;
  absentCount: number;
  pendingCount: number;
}

function ExamsInner() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const perms = useMyPermissions();

  const [groupId, setGroupId] = useState(search.get("groupId") ?? "");
  const group = useGroupInfo(groupId);

  // Keep the chosen group in the URL so "Back" from an exam returns here.
  useEffect(() => {
    router.replace(`/dashboard/performance/exams${qs({ groupId })}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const { data, loading, error, reload } = useApi<{ exams: ExamRow[] }>(
    groupId ? `/api/exams${qs({ groupId, pageSize: 100 })}` : null
  );
  const { data: subjects } = useApi<SubjectOption[]>(groupId && group && !group.subject ? "/api/subjects" : null, [
    group?.id
  ]);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ id: string; name: string } | null>(null);

  function openCreate() {
    setName("");
    setDate("");
    setMaxScore("100");
    setDuration("");
    setDescription("");
    setSubjectId("");
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const max = Number(maxScore);
    if (!Number.isFinite(max) || max <= 0) {
      setFormError(t("ex.err.maxScore"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await apiPost<{ id: string; name: string }>("/api/exams", {
        groupId,
        subjectId: group?.subject ? undefined : subjectId || undefined,
        name: name.trim(),
        date: new Date(date).toISOString(),
        maxScore: max,
        durationMinutes: duration.trim() ? Number(duration) : undefined,
        description: description.trim() || undefined
      });
      toast.success(t("common.created"));
      setModalOpen(false);
      setJustCreated({ id: created.id, name: created.name });
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("perf.err.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  const needsSubject = !!group && !group.subject;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("exams.title")}
        description={t("ex.subtitle")}
        actions={
          groupId && perms.has("exams.create") ? (
            <button type="button" className="btn-primary" onClick={openCreate}>
              {t("ex.create")}
            </button>
          ) : undefined
        }
      />

      <div className="card p-4">
        <GroupPicker
          groupId={groupId}
          onChange={(id) => {
            setGroupId(id);
            setJustCreated(null);
          }}
        />
      </div>

      {!groupId && <div className="card p-6 text-sm text-black/60 dark:text-white/60">{t("lf.pickGroup")}</div>}

      {groupId && (
        <>
          <ErrorNotice message={error} />

          {justCreated && (
            <div className="card flex flex-wrap items-center justify-between gap-3 border-emerald-500/40 p-4" role="status">
              <p className="text-sm">
                ✅ {fmt(t("ex.createdBanner"), { name: justCreated.name })}
              </p>
              <Link href={`/dashboard/performance/exams/${justCreated.id}`} className="btn-primary">
                {t("ex.open")}
              </Link>
            </div>
          )}

          <h2 className="font-semibold">{t("ex.previous")}</h2>
          <DataTable
            columns={[
              t("ex.col.name"),
              t("common.date"),
              t("ex.col.max"),
              t("ex.col.students"),
              t("ex.col.graded"),
              t("ex.col.absent"),
              t("common.status"),
              ""
            ]}
            loading={loading && !data}
            isEmpty={(data?.exams.length ?? 0) === 0}
            emptyTitle={t("exams.empty")}
            emptyDescription={perms.has("exams.create") ? t("ex.emptyHint") : undefined}
          >
            {data?.exams.map((exam) => (
              <tr key={exam.id} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">
                  <Link href={`/dashboard/performance/exams/${exam.id}`} className="hover:underline">
                    {exam.name}
                  </Link>
                  <span className="block text-xs font-normal text-black/50 dark:text-white/50">{exam.subject.name}</span>
                </td>
                <td className="p-3 whitespace-nowrap">{formatDateTime(exam.date)}</td>
                <td className="p-3">{exam.maxScore}</td>
                <td className="p-3">{exam.studentCount}</td>
                <td className="p-3">
                  {exam.gradedCount}
                  {exam.pendingCount > 0 && (
                    <span className="ms-1 text-xs text-amber-600 dark:text-amber-400">
                      ({fmt(t("ex.pendingN"), { n: exam.pendingCount })})
                    </span>
                  )}
                </td>
                <td className="p-3">{exam.absentCount}</td>
                <td className="p-3">
                  <Badge tone={exam.isPublished ? "success" : "neutral"}>
                    {exam.isPublished ? t("exams.published") : t("exams.draft")}
                  </Badge>
                </td>
                <td className="p-3 text-end">
                  <Link href={`/dashboard/performance/exams/${exam.id}`} className="btn-secondary px-3 py-1 text-xs">
                    {t("ex.open")}
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <Modal open={modalOpen} title={t("ex.create")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
          {group && (
            <p className="rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
              {group.grade.stage.name} · {group.grade.name} · {group.name}
              {group.subject ? ` · ${group.subject.name}` : ""}
            </p>
          )}
          {needsSubject && (
            <Field label={t("common.subject")} required>
              {(id) => (
                <select id={id} className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                  <option value="">{t("common.select")}</option>
                  {subjects?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label={t("ex.col.name")} required>
            {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />}
          </Field>
          <Field label={t("common.date")} required>
            {(id) => <input id={id} type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("ex.col.max")} required>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0.5}
                  step="any"
                  inputMode="decimal"
                  className="input"
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t("ex.duration")}>
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={600}
                  className="input"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label={t("ex.details")}>
            {(id) => (
              <textarea
                id={id}
                className="input min-h-[80px]"
                value={description}
                maxLength={1000}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim() || !date || (needsSubject && !subjectId)}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function ExamsPage() {
  return (
    <Suspense fallback={null}>
      <ExamsInner />
    </Suspense>
  );
}
