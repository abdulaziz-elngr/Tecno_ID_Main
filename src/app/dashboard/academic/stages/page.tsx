"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import {
  Badge,
  ConfirmDialog,
  DataTable,
  ErrorNotice,
  Field,
  Modal,
  PageHeader,
  useToast
} from "@/components/ui";

interface Grade {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  _count: { students: number; groups: number };
}

interface StageRow {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  grades: Grade[];
}

/**
 * Settings/Academic -> Academic Stages (spec §2).
 * Stage -> Grade -> Group -> Student is the fixed hierarchy — a Grade
 * always belongs to exactly one Stage, and this page is the only place
 * stages/grades themselves are created, edited, and activated/deactivated.
 */
export default function StagesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<StageRow[]>("/api/stages");

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [order, setOrder] = useState(0);
  const [gradesText, setGradesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [gradeDraft, setGradeDraft] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<StageRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/stages", {
        name: name.trim(),
        order,
        grades: gradesText
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
      });
      toast.success(t("common.created"));
      setCreateOpen(false);
      setName("");
      setOrder(0);
      setGradesText("");
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create stage.");
    } finally {
      setSubmitting(false);
    }
  }

  async function addGrade(stageId: string) {
    const value = (gradeDraft[stageId] ?? "").trim();
    if (!value) return;
    try {
      await apiPatch(`/api/stages/${stageId}`, { addGrade: value });
      setGradeDraft((d) => ({ ...d, [stageId]: "" }));
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add grade.");
    }
  }

  async function removeGrade(gradeId: string) {
    try {
      await apiDelete(`/api/grades/${gradeId}`);
      toast.success(t("common.deleted"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove grade.");
    }
  }

  async function toggleStageActive(stage: StageRow) {
    try {
      await apiPatch(`/api/stages/${stage.id}`, { isActive: !stage.isActive });
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update stage.");
    }
  }

  async function toggleGradeActive(grade: Grade) {
    try {
      await apiPatch(`/api/grades/${grade.id}`, { isActive: !grade.isActive });
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update grade.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/stages/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete stage.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("stages.title")}
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            {t("stages.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("stages.title"), t("common.status"), t("grades.title"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("stages.empty")}
      >
        {data?.map((stage) => (
          <tr key={stage.id} className="border-b border-black/5 align-top dark:border-white/5">
            <td className="p-3 font-medium">{stage.name}</td>
            <td className="p-3">
              <button type="button" onClick={() => toggleStageActive(stage)}>
                <Badge tone={stage.isActive ? "success" : "neutral"}>
                  {stage.isActive ? t("common.active") : t("common.inactive")}
                </Badge>
              </button>
            </td>
            <td className="p-3">
              <div className="flex flex-wrap gap-1.5">
                {stage.grades.map((g) => (
                  <Badge key={g.id} tone={g.isActive ? "neutral" : "neutral"}>
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleGradeActive(g)}
                        className={g.isActive ? "" : "opacity-50 line-through"}
                        title={g.isActive ? t("common.active") : t("common.inactive")}
                      >
                        {g.name}
                      </button>
                      <span className="text-black/40 dark:text-white/40">
                        ({g._count.students}·{g._count.groups})
                      </span>
                      {g._count.students === 0 && g._count.groups === 0 && (
                        <button
                          type="button"
                          onClick={() => removeGrade(g.id)}
                          aria-label={`Remove ${g.name}`}
                          className="text-black/40 hover:text-red-600 dark:text-white/40"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  </Badge>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  className="input py-1 text-xs"
                  placeholder={t("grades.add")}
                  value={gradeDraft[stage.id] ?? ""}
                  onChange={(e) => setGradeDraft((d) => ({ ...d, [stage.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addGrade(stage.id);
                    }
                  }}
                />
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => addGrade(stage.id)}>
                  {t("common.add")}
                </button>
              </div>
            </td>
            <td className="p-3">
              <button
                type="button"
                className="text-xs text-red-600 hover:underline dark:text-red-400"
                onClick={() => setDeleteTarget(stage)}
              >
                {t("common.delete")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={createOpen} title={t("stages.add")} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("stages.title")} required>
            {(id) => (
              <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            )}
          </Field>
          <Field label="Order" hint="Lower numbers appear first.">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="input"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
              />
            )}
          </Field>
          <Field label={t("grades.title")} hint="Comma-separated, e.g. Grade 1, Grade 2, Grade 3">
            {(id) => (
              <input id={id} className="input" value={gradesText} onChange={(e) => setGradesText(e.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
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
        message={`Delete "${deleteTarget?.name}"? This is only possible while no students or groups reference it — deactivate it instead otherwise.`}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
