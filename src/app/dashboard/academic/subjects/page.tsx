"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface SubjectRow {
  id: string;
  name: string;
  code: string | null;
  _count: { exams: number };
  totals: {
    groups: number;
    activeGroups: number;
    students: number;
    capacity: number;
    stages: { id: string; name: string }[];
    grades: { id: string; name: string; stageName: string }[];
  };
  teachers: { id: string; fullName: string }[];
}

interface TeacherOption {
  id: string;
  fullName: string;
}

const MAX_CHIPS = 3;

/**
 * Subjects: one row per subject showing who teaches it (Teacher), which
 * stages/grades it runs in, and how many groups/students it has
 * (Subject -> Teacher -> Groups -> Students). Rows link to the detail page.
 */
export default function SubjectsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<SubjectRow[]>("/api/subjects");
  const { data: teacherList } = useApi<TeacherOption[]>("/api/teachers?pageSize=100&isAssistant=false");

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((s) =>
      [s.name, s.code, ...s.teachers.map((x) => x.fullName)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [data, search]);

  function openCreate() {
    setEditing(null);
    setName("");
    setCode("");
    setTeacherIds([]);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(subject: SubjectRow) {
    setEditing(subject);
    setName(subject.name);
    setCode(subject.code ?? "");
    setTeacherIds(subject.teachers.map((x) => x.id));
    setFormError(null);
    setModalOpen(true);
  }

  function toggleTeacher(id: string) {
    setTeacherIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = { name: name.trim(), code: code.trim() || null, teacherIds };
      if (editing) {
        await apiPatch(`/api/subjects/${editing.id}`, payload);
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/subjects", payload);
        toast.success(t("common.created"));
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save subject.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/subjects/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete subject.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  // Teachers shown in the picker: everyone assignable, plus anyone already on the subject
  // (so an edit never silently drops a teacher that is outside the first page of results).
  const pickerTeachers = useMemo(() => {
    const map = new Map<string, string>();
    for (const x of teacherList ?? []) map.set(x.id, x.fullName);
    for (const x of editing?.teachers ?? []) map.set(x.id, x.fullName);
    return Array.from(map.entries())
      .map(([id, fullName]) => ({ id, fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [teacherList, editing]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("subjects.title")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("subjects.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <input
        className="input max-w-md"
        placeholder={t("subjects.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label={t("common.search")}
      />

      <DataTable
        columns={[
          t("subjects.title"),
          t("subjects.stages"),
          t("subjects.teachers"),
          t("subjects.groups"),
          t("subjects.students"),
          t("subjects.exams"),
          t("common.actions")
        ]}
        loading={loading}
        isEmpty={rows.length === 0}
        emptyTitle={t("subjects.empty")}
      >
        {rows.map((subject) => (
          <tr key={subject.id} className="border-b border-black/5 align-top dark:border-white/5">
            <td className="p-3">
              <Link href={`/dashboard/academic/subjects/${subject.id}`} className="font-medium hover:underline">
                {subject.name}
              </Link>
              {subject.code && <span className="ms-2 font-mono text-xs text-black/50 dark:text-white/50">{subject.code}</span>}
            </td>
            <td className="p-3 text-xs">
              {subject.totals.grades.length === 0 ? (
                "—"
              ) : (
                <div className="space-y-0.5">
                  {subject.totals.grades.slice(0, MAX_CHIPS).map((g) => (
                    <p key={g.id}>
                      {g.stageName} · {g.name}
                    </p>
                  ))}
                  {subject.totals.grades.length > MAX_CHIPS && (
                    <p className="text-black/50 dark:text-white/50">+{subject.totals.grades.length - MAX_CHIPS}</p>
                  )}
                </div>
              )}
            </td>
            <td className="p-3">
              {subject.teachers.length === 0 ? (
                <span className="text-black/50 dark:text-white/50">{t("subjects.noTeachers")}</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {subject.teachers.slice(0, MAX_CHIPS).map((x) => (
                    <span
                      key={x.id}
                      className="rounded-full bg-tecno-gold/15 px-2 py-0.5 text-xs text-tecno-gold-dark dark:text-tecno-gold"
                    >
                      {x.fullName}
                    </span>
                  ))}
                  {subject.teachers.length > MAX_CHIPS && (
                    <span
                      title={subject.teachers.slice(MAX_CHIPS).map((x) => x.fullName).join("\n")}
                      className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10"
                    >
                      +{subject.teachers.length - MAX_CHIPS}
                    </span>
                  )}
                </div>
              )}
            </td>
            <td className="p-3">{subject.totals.groups}</td>
            <td className="p-3">
              {subject.totals.students}
              {subject.totals.capacity > 0 && (
                <span className="text-xs text-black/50 dark:text-white/50"> / {subject.totals.capacity}</span>
              )}
            </td>
            <td className="p-3">{subject._count.exams}</td>
            <td className="p-3">
              <div className="flex gap-3">
                <Link href={`/dashboard/academic/subjects/${subject.id}`} className="text-xs hover:underline">
                  {t("subjects.view")}
                </Link>
                <button type="button" className="text-xs hover:underline" onClick={() => openEdit(subject)}>
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                  onClick={() => setDeleteTarget(subject)}
                >
                  {t("common.delete")}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={modalOpen} title={editing ? t("common.edit") : t("subjects.add")} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("subjects.title")} required>
            {(id) => (
              <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            )}
          </Field>
          <Field label={t("subjects.code")}>
            {(id) => (
              <input
                id={id}
                className="input"
                value={code}
                maxLength={20}
                dir="ltr"
                onChange={(e) => setCode(e.target.value)}
                placeholder="MATH"
              />
            )}
          </Field>
          <div>
            <p className="mb-1 text-sm font-medium">
              {t("subjects.teachers")} ({teacherIds.length})
            </p>
            <p className="mb-2 text-xs text-black/50 dark:text-white/50">{t("subjects.teachersHint")}</p>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/10">
              {pickerTeachers.length === 0 && (
                <p className="text-sm text-black/50 dark:text-white/50">{t("subjects.noTeachers")}</p>
              )}
              {pickerTeachers.map((x) => (
                <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                  <input type="checkbox" checked={teacherIds.includes(x.id)} onChange={() => toggleTeacher(x.id)} />
                  {x.fullName}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={`${deleteTarget?.name ?? ""}: ${t("subjects.deleteMessage")}`}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
