"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface StageOption {
  id: string;
  name: string;
}

interface GradeRow {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  stage: StageOption;
  _count: { students: number; groups: number };
}

/**
 * Dedicated Grades screen (spec §2, §38 nav): every grade across every
 * stage, with quick activate/deactivate/edit/delete. Stage -> Grade is
 * always shown together since a grade never exists without its stage.
 */
export default function GradesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<GradeRow[]>("/api/grades");
  const { data: stages } = useApi<StageOption[]>("/api/stages");

  const [createOpen, setCreateOpen] = useState(false);
  const [stageId, setStageId] = useState("");
  const [name, setName] = useState("");
  const [order, setOrder] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GradeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeStages = useMemo(() => (stages ?? []).filter((s: any) => s.isActive !== false), [stages]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost("/api/grades", { stageId, name: name.trim(), order });
      toast.success(t("common.created"));
      setCreateOpen(false);
      setName("");
      setOrder(0);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create grade.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(grade: GradeRow) {
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
      await apiDelete(`/api/grades/${deleteTarget.id}`);
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete grade.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("grades.title")}
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            {t("grades.add")}
          </button>
        }
      />

      <ErrorNotice message={error} />

      <DataTable
        columns={[t("nav.stages"), t("grades.title"), t("common.status"), "Students · Groups", t("common.actions")]}
        loading={loading}
        isEmpty={(data?.length ?? 0) === 0}
        emptyTitle={t("grades.empty")}
      >
        {data?.map((grade) => (
          <tr key={grade.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 text-sm text-black/60 dark:text-white/60">{grade.stage.name}</td>
            <td className="p-3 font-medium">{grade.name}</td>
            <td className="p-3">
              <button type="button" onClick={() => toggleActive(grade)}>
                <Badge tone={grade.isActive ? "success" : "neutral"}>
                  {grade.isActive ? t("common.active") : t("common.inactive")}
                </Badge>
              </button>
            </td>
            <td className="p-3 text-sm text-black/60 dark:text-white/60">
              {grade._count.students} · {grade._count.groups}
            </td>
            <td className="p-3">
              <button
                type="button"
                className="text-xs text-red-600 hover:underline dark:text-red-400"
                onClick={() => setDeleteTarget(grade)}
                disabled={grade._count.students > 0 || grade._count.groups > 0}
              >
                {t("common.delete")}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <Modal open={createOpen} title={t("grades.add")} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="space-y-3">
          <ErrorNotice message={formError} />
          <Field label={t("nav.stages")} required>
            {(id) => (
              <select id={id} className="input" value={stageId} onChange={(e) => setStageId(e.target.value)} required>
                <option value="" disabled>
                  {t("common.select")}
                </option>
                {activeStages.map((s: StageOption) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("grades.title")} required>
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
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !name.trim() || !stageId}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={`Delete "${deleteTarget?.name}"? Only possible while no students or groups reference it.`}
        confirmLabel={t("common.delete")}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
