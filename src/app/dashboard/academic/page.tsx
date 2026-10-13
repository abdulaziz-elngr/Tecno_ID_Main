"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface StageOption {
  id: string;
  name: string;
  isActive: boolean;
  grades: { id: string; name: string; isActive: boolean }[];
}

interface SubjectOption {
  id: string;
  name: string;
  code: string | null;
}

interface StaffOption {
  id: string;
  fullName: string;
}

interface GroupRow {
  id: string;
  branchId: string;
  name: string;
  capacity: number;
  notes: string | null;
  currentCount: number;
  remaining: number;
  capacityPercent: number;
  isFull: boolean;
  isActive: boolean;
  grade: { id: string; name: string; stage: { id: string; name: string } };
  subject: { id: string; name: string; code: string | null } | null;
  teacher: StaffOption | null;
  assistant: StaffOption | null;
  schedules: { dayOfWeek: string; startMinutes: number; endMinutes: number }[];
}

interface FormState {
  stageId: string;
  gradeId: string;
  subjectId: string;
  name: string;
  capacity: number;
  teacherId: string;
  assistantId: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  stageId: "",
  gradeId: "",
  subjectId: "",
  name: "",
  capacity: 20,
  teacherId: "",
  assistantId: "",
  notes: ""
};

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const NO_SUBJECT_KEY = "__none__";

/**
 * Groups Management: the Stage -> Grade -> Subject -> Group tree with
 * filters (stage, grade, subject, teacher, free text), each group's subject,
 * teacher, schedule and live capacity, and create / edit / archive / delete.
 * A group is always created against a Grade (picked via its Stage) AND one
 * Subject. Groups with history can never be deleted — they are archived.
 */
export default function GroupsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data: groups, loading, error, reload } = useApi<GroupRow[]>("/api/groups");
  const { data: stages } = useApi<StageOption[]>("/api/stages");
  const { data: subjects, error: subjectsError } = useApi<SubjectOption[]>("/api/subjects");
  const { data: teacherList } = useApi<StaffOption[]>("/api/teachers?pageSize=100&isAssistant=false");
  const { data: assistantList } = useApi<StaffOption[]>("/api/teachers?pageSize=100&isAssistant=true");

  // Filters
  const [search, setSearch] = useState("");
  const [fStage, setFStage] = useState("");
  const [fGrade, setFGrade] = useState("");
  const [fSubject, setFSubject] = useState("");
  const [fTeacher, setFTeacher] = useState("");

  // Create / edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete / archive confirmation
  const [deleteTarget, setDeleteTarget] = useState<GroupRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<GroupRow | null>(null);
  const [busy, setBusy] = useState(false);

  const formStage = useMemo(() => (stages ?? []).find((s) => s.id === form.stageId), [stages, form.stageId]);
  const filterStage = useMemo(() => (stages ?? []).find((s) => s.id === fStage), [stages, fStage]);

  const teacherFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups ?? []) if (g.teacher) map.set(g.teacher.id, g.teacher.fullName);
    return Array.from(map.entries())
      .map(([id, fullName]) => ({ id, fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [groups]);

  const subjectFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups ?? []) if (g.subject) map.set(g.subject.id, g.subject.name);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (groups ?? []).filter((g) => {
      if (fStage && g.grade.stage.id !== fStage) return false;
      if (fGrade && g.grade.id !== fGrade) return false;
      if (fSubject && g.subject?.id !== fSubject) return false;
      if (fTeacher && g.teacher?.id !== fTeacher) return false;
      if (q) {
        const haystack = [g.name, g.subject?.name, g.subject?.code, g.teacher?.fullName, g.assistant?.fullName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [groups, search, fStage, fGrade, fSubject, fTeacher]);

  const hasFilters = Boolean(search || fStage || fGrade || fSubject || fTeacher);

  // Stage -> Grade -> Subject -> Group (the order the API already returns rows in).
  const tree = useMemo(() => {
    type SubjectNode = { key: string; name: string; groups: GroupRow[] };
    type GradeNode = { name: string; subjects: Map<string, SubjectNode> };
    type StageNode = { name: string; grades: Map<string, GradeNode> };
    const byStage = new Map<string, StageNode>();
    for (const g of filtered) {
      const stageNode = byStage.get(g.grade.stage.id) ?? { name: g.grade.stage.name, grades: new Map() };
      byStage.set(g.grade.stage.id, stageNode);
      const gradeNode = stageNode.grades.get(g.grade.id) ?? { name: g.grade.name, subjects: new Map() };
      stageNode.grades.set(g.grade.id, gradeNode);
      const key = g.subject?.id ?? NO_SUBJECT_KEY;
      const subjectNode = gradeNode.subjects.get(key) ?? {
        key,
        name: g.subject?.name ?? t("groups.noSubject"),
        groups: []
      };
      gradeNode.subjects.set(key, subjectNode);
      subjectNode.groups.push(g);
    }
    return byStage;
  }, [filtered, t]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, stageId: fStage, gradeId: fGrade, subjectId: fSubject });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(g: GroupRow) {
    setEditing(g);
    setForm({
      stageId: g.grade.stage.id,
      gradeId: g.grade.id,
      subjectId: g.subject?.id ?? "",
      name: g.name,
      capacity: g.capacity,
      teacherId: g.teacher?.id ?? "",
      assistantId: g.assistant?.id ?? "",
      notes: g.notes ?? ""
    });
    setFormError(null);
    setFormOpen(true);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      if (!form.subjectId) throw new Error(t("groups.subjectRequired"));
      if (editing) {
        await apiPatch(`/api/groups/${editing.id}`, {
          name: form.name.trim(),
          capacity: form.capacity,
          subjectId: form.subjectId,
          teacherId: form.teacherId || null,
          assistantId: form.assistantId || null,
          notes: form.notes.trim()
        });
        toast.success(t("common.saved"));
      } else {
        // branchId: single-branch assumption (as before) — a branch picker
        // would be added here for multi-branch organizations.
        const branches = await fetch("/api/branches").then((r) => r.json()).catch(() => null);
        const branchId = branches?.data?.[0]?.id;
        if (!branchId) throw new Error("No branch available for this account.");
        await apiPost("/api/groups", {
          branchId,
          gradeId: form.gradeId,
          subjectId: form.subjectId,
          name: form.name.trim(),
          capacity: form.capacity,
          teacherId: form.teacherId || undefined,
          assistantId: form.assistantId || undefined,
          notes: form.notes.trim() || undefined
        });
        toast.success(t("common.created"));
      }
      setFormOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save group.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchiveToggle() {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await apiPatch(`/api/groups/${archiveTarget.id}`, { isActive: !archiveTarget.isActive });
      toast.success(t("common.saved"));
      setArchiveTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update group.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiDelete(`/api/groups/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      // The server explains exactly what blocks deletion (students / history).
      toast.error(err instanceof Error ? err.message : t("groups.cannotDelete"));
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !submitting && form.name.trim().length > 0 && Boolean(form.subjectId) && (Boolean(editing) || Boolean(form.gradeId));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.groups")}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            {t("groups.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      {/* Filters */}
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input
          className="input lg:col-span-2"
          placeholder={t("groups.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("common.search")}
        />
        <select
          className="input"
          value={fStage}
          onChange={(e) => {
            setFStage(e.target.value);
            setFGrade("");
          }}
          aria-label={t("nav.stages")}
        >
          <option value="">{t("groups.allStages")}</option>
          {(stages ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={fGrade}
          onChange={(e) => setFGrade(e.target.value)}
          disabled={!fStage}
          aria-label={t("grades.title")}
        >
          <option value="">{t("groups.allGrades")}</option>
          {(filterStage?.grades ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select className="input" value={fSubject} onChange={(e) => setFSubject(e.target.value)} aria-label={t("groups.subject")}>
          <option value="">{t("groups.allSubjects")}</option>
          {subjectFilterOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select className="input" value={fTeacher} onChange={(e) => setFTeacher(e.target.value)} aria-label={t("groups.teacher")}>
          <option value="">{t("groups.allTeachers")}</option>
          {teacherFilterOptions.map((x) => (
            <option key={x.id} value={x.id}>
              {x.fullName}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            className="text-xs text-black/60 hover:underline sm:col-span-2 lg:col-span-6 lg:justify-self-end dark:text-white/60"
            onClick={() => {
              setSearch("");
              setFStage("");
              setFGrade("");
              setFSubject("");
              setFTeacher("");
            }}
          >
            {t("common.clearFilters")}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}

      {!loading && (groups?.length ?? 0) === 0 && (
        <div className="card p-6 text-sm text-black/60 dark:text-white/60">{t("groups.empty")}</div>
      )}

      {!loading && (groups?.length ?? 0) > 0 && filtered.length === 0 && (
        <div className="card p-6 text-sm text-black/60 dark:text-white/60">{t("groups.noMatches")}</div>
      )}

      <div className="space-y-6">
        {Array.from(tree.entries()).map(([stageKey, stage]) => (
          <div key={stageKey} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{stage.name}</h2>
            {Array.from(stage.grades.entries()).map(([gradeKey, grade]) => (
              <div key={gradeKey} className="card space-y-4 p-4">
                <h3 className="font-medium">{grade.name}</h3>
                {Array.from(grade.subjects.values()).map((subject) => (
                  <div key={subject.key}>
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-tecno-gold-dark dark:text-tecno-gold">
                      {subject.key === NO_SUBJECT_KEY ? (
                        <span>{subject.name}</span>
                      ) : (
                        <Link href={`/dashboard/academic/subjects/${subject.key}`} className="hover:underline">
                          {subject.name}
                        </Link>
                      )}
                      <span className="text-xs font-normal text-black/40 dark:text-white/40">({subject.groups.length})</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {subject.groups.map((g) => (
                        <div
                          key={g.id}
                          className="flex flex-col rounded-xl border border-black/10 p-3 transition hover:border-tecno-gold dark:border-white/10"
                        >
                          <Link href={`/dashboard/academic/groups/${g.id}`} className="block flex-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">{g.name}</span>
                              {!g.isActive ? (
                                <Badge tone="neutral">{t("common.archived")}</Badge>
                              ) : g.isFull ? (
                                <Badge tone="danger">{t("groups.full")}</Badge>
                              ) : (
                                <Badge tone="success">{t("common.active")}</Badge>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                              {t("groups.teacher")}: {g.teacher?.fullName ?? "—"}
                            </p>
                            {g.subject === null && (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("groups.legacyNoSubject")}</p>
                            )}
                            <div className="mt-2">
                              <div className="mb-1 flex items-center justify-between text-xs">
                                <span>
                                  {g.currentCount} / {g.capacity}
                                </span>
                                <span className="text-black/50 dark:text-white/50">{g.capacityPercent}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                                <div
                                  className={`h-full rounded-full ${g.isFull ? "bg-red-500" : "bg-tecno-gold"}`}
                                  style={{ width: `${Math.min(100, g.capacityPercent)}%` }}
                                />
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                              {g.schedules.length > 0
                                ? g.schedules
                                    .map((s) => `${s.dayOfWeek} ${formatTime(s.startMinutes)}–${formatTime(s.endMinutes)}`)
                                    .join(" · ")
                                : t("groups.noSchedule")}
                            </p>
                          </Link>
                          <div className="mt-3 flex flex-wrap gap-3 border-t border-black/5 pt-2 text-xs dark:border-white/10">
                            <button type="button" className="hover:underline" onClick={() => openEdit(g)}>
                              {t("common.edit")}
                            </button>
                            <button type="button" className="hover:underline" onClick={() => setArchiveTarget(g)}>
                              {g.isActive ? t("common.archive") : t("common.restore")}
                            </button>
                            <button
                              type="button"
                              className="text-red-600 hover:underline dark:text-red-400"
                              onClick={() => setDeleteTarget(g)}
                            >
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      <Modal open={formOpen} title={editing ? t("groups.edit") : t("groups.add")} onClose={() => setFormOpen(false)}>
        <form onSubmit={handleSubmit} className="space-y-3">
          <ErrorNotice message={formError} />
          {subjectsError && <ErrorNotice message={subjectsError} />}
          <Field label={t("nav.stages")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.stageId}
                disabled={Boolean(editing)}
                onChange={(e) => setForm((p) => ({ ...p, stageId: e.target.value, gradeId: "" }))}
                required
              >
                <option value="" disabled>
                  {t("common.select")}
                </option>
                {(stages ?? [])
                  .filter((s) => s.isActive || s.id === form.stageId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label={t("grades.title")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.gradeId}
                onChange={(e) => setField("gradeId", e.target.value)}
                required
                disabled={!form.stageId || Boolean(editing)}
              >
                <option value="" disabled>
                  {t("common.select")}
                </option>
                {(formStage?.grades ?? [])
                  .filter((g) => g.isActive || g.id === form.gradeId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          {editing && <p className="text-xs text-black/50 dark:text-white/50">{t("groups.gradeLocked")}</p>}
          <Field label={t("groups.subject")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.subjectId}
                onChange={(e) => setField("subjectId", e.target.value)}
                required
              >
                <option value="" disabled>
                  {t("common.select")}
                </option>
                {(subjects ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.name} (${s.code})` : s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("groups.name")} required>
            {(id) => (
              <input id={id} className="input" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
            )}
          </Field>
          <Field label={t("groups.capacity")} required>
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                className="input"
                value={form.capacity}
                onChange={(e) => setField("capacity", Number(e.target.value))}
                required
              />
            )}
          </Field>
          <Field label={t("groups.teacher")}>
            {(id) => (
              <select id={id} className="input" value={form.teacherId} onChange={(e) => setField("teacherId", e.target.value)}>
                <option value="">—</option>
                {(teacherList ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("groups.assistant")}>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.assistantId}
                onChange={(e) => setField("assistantId", e.target.value)}
              >
                <option value="">—</option>
                {(assistantList ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.fullName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("common.notes")}>
            {(id) => (
              <textarea id={id} className="input" rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
            )}
          </Field>
          {!editing && (
            <p className="text-xs text-black/50 dark:text-white/50">
              Add the group's days and times from its detail page after creating it.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={!canSubmit}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("groups.deleteTitle")}
        message={`${deleteTarget?.name ?? ""}: ${t("groups.deleteMessage")}`}
        confirmLabel={t("common.delete")}
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={archiveTarget?.isActive ? t("groups.archiveTitle") : t("common.restore")}
        message={
          archiveTarget?.isActive ? `${archiveTarget.name}: ${t("groups.archiveMessage")}` : (archiveTarget?.name ?? "")
        }
        confirmLabel={archiveTarget?.isActive ? t("common.archive") : t("common.restore")}
        busy={busy}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={handleArchiveToggle}
      />
    </div>
  );
}
