"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiDelete, apiPatch, apiPost, formatDate, qs, useApi } from "@/lib/client";
import { optionalPhoneSchema } from "@/lib/staff";
import {
  POSITION_LABEL_KEYS,
  POSITION_MAX_LENGTH,
  SUGGESTED_POSITIONS,
  isSuggestedPosition,
  normalizePosition
} from "@/lib/positions";
import {
  Badge,
  ConfirmDialog,
  DataTable,
  ErrorNotice,
  Field,
  Modal,
  PageHeader,
  Pager,
  useToast
} from "@/components/ui";

interface BranchOption {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  hireDate: string | null;
  isActive: boolean;
  branch: { id: string; name: string };
}

interface ListData {
  employees: EmployeeRow[];
  /** Positions already used in this organization/scope (offered back as options). */
  positions: string[];
  pagination: { page: number; totalPages: number };
}

/** Select value that reveals the free-text position input. */
const OTHER = "__other__";

interface FormState {
  branchId: string;
  fullName: string;
  phone: string;
  /** "" = no position, a position text, or OTHER. */
  positionChoice: string;
  customPosition: string;
  hireDate: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  branchId: "",
  fullName: "",
  phone: "",
  positionChoice: "",
  customPosition: "",
  hireDate: "",
  isActive: true
};

export default function EmployeesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = qs({ search: search || undefined, page, pageSize: 20 });
  const { data, loading, error, reload } = useApi<ListData>(`/api/employees${query}`);
  const { data: branches } = useApi<BranchOption[]>("/api/branches");

  // Buttons are hidden for roles without the permission; the API enforces it regardless.
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setPermissions(new Set<string>(me?.permissions ?? [])))
      .catch(() => setPermissions(new Set()));
  }, []);
  const canCreate = permissions.has("employees.create");
  const canEdit = permissions.has("employees.update");
  const canDelete = permissions.has("employees.delete");
  const showActions = canEdit || canDelete;

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Suggested positions are translated; any other stored text is shown as-is. */
  function positionLabel(value: string): string {
    return isSuggestedPosition(value) ? t(POSITION_LABEL_KEYS[value]) : value;
  }

  // Selector options: suggested values, then positions already used by the
  // organization (so a custom position becomes reusable), then the one being edited.
  const positionOptions = useMemo(() => {
    const seen = new Set<string>(SUGGESTED_POSITIONS.map((p) => p.toLowerCase()));
    const extras: string[] = [];
    const add = (value: string | null | undefined) => {
      const normalized = normalizePosition(value);
      if (normalized && !seen.has(normalized.toLowerCase())) {
        seen.add(normalized.toLowerCase());
        extras.push(normalized);
      }
    };
    (data?.positions ?? []).forEach(add);
    if (formMode === "edit") add(form.positionChoice === OTHER ? null : form.positionChoice);
    return [...SUGGESTED_POSITIONS, ...extras];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.positions, formMode, editingId]);

  const customPositionTrimmed = normalizePosition(form.customPosition);
  const positionValid =
    form.positionChoice !== OTHER ||
    (customPositionTrimmed !== null && customPositionTrimmed.length <= POSITION_MAX_LENGTH);
  const phoneValid = optionalPhoneSchema.safeParse(form.phone).success;
  const formValid = form.fullName.trim().length >= 2 && form.branchId !== "" && phoneValid && positionValid;

  /** The position that will be sent: null clears it. */
  function chosenPosition(): string | null {
    return form.positionChoice === OTHER ? customPositionTrimmed : normalizePosition(form.positionChoice);
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM, branchId: branches?.[0]?.id ?? "" });
    setFormMode("create");
    setEditingId(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(row: EmployeeRow) {
    setForm({
      branchId: row.branch.id,
      fullName: row.fullName,
      phone: row.phone ?? "",
      positionChoice: normalizePosition(row.position) ?? "",
      customPosition: "",
      hireDate: row.hireDate ? row.hireDate.slice(0, 10) : "",
      isActive: row.isActive
    });
    setFormMode("edit");
    setEditingId(row.id);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!formValid) return;
    setSubmitting(true);
    setFormError(null);
    try {
      if (formMode === "edit" && editingId) {
        await apiPatch(`/api/employees/${editingId}`, {
          fullName: form.fullName.trim(),
          phone: form.phone.trim() || null,
          position: chosenPosition(),
          hireDate: form.hireDate || null,
          isActive: form.isActive
        });
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/employees", {
          branchId: form.branchId,
          fullName: form.fullName.trim(),
          phone: form.phone.trim() || undefined,
          position: chosenPosition() ?? undefined,
          hireDate: form.hireDate || undefined
        });
        toast.success(t("common.created"));
        setPage(1);
      }
      setFormOpen(false);
      reload();
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
        const extra = Object.values(fieldErrors ?? {})
          .map((m) => m?.[0])
          .filter(Boolean)
          .join(" ");
        setFormError(extra ? `${err.message} ${extra}` : err.message);
      } else {
        setFormError(err instanceof Error ? err.message : "Failed to save employee.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete(reason: string) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/employees/${deleteTarget.id}`, { reason });
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      if ((data?.employees.length ?? 0) === 1 && page > 1) setPage((p) => p - 1);
      else reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete employee.");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    t("employees.title"),
    t("employees.position"),
    t("common.phone"),
    t("common.branch"),
    t("employees.hireDate"),
    t("common.status"),
    ...(showActions ? [t("common.actions")] : [])
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("employees.title")}
        actions={
          canCreate ? (
            <button type="button" className="btn-primary" onClick={openCreate} disabled={!branches?.length}>
              {t("employees.add")}
            </button>
          ) : undefined
        }
      />

      <ErrorNotice message={error} />

      <input
        className="input max-w-sm"
        placeholder={t("common.search")}
        value={search}
        onChange={(e) => {
          setPage(1);
          setSearch(e.target.value);
        }}
      />

      <DataTable
        columns={columns}
        loading={loading}
        isEmpty={(data?.employees.length ?? 0) === 0}
        emptyTitle={t("employees.empty")}
      >
        {data?.employees.map((e) => (
          <tr key={e.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">
              <Link href={`/dashboard/attendance/employees?employeeId=${e.id}`} className="hover:underline">
                {e.fullName}
              </Link>
            </td>
            <td className="p-3">{e.position ? positionLabel(e.position) : "—"}</td>
            <td className="p-3" dir="ltr">
              <span className="inline-block">{e.phone ?? "—"}</span>
            </td>
            <td className="p-3">{e.branch.name}</td>
            <td className="p-3">{formatDate(e.hireDate)}</td>
            <td className="p-3">
              <Badge tone={e.isActive ? "success" : "neutral"}>{e.isActive ? t("common.active") : t("common.inactive")}</Badge>
            </td>
            {showActions && (
              <td className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      {t("common.edit")}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(e)}
                      className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    >
                      {t("common.delete")}
                    </button>
                  )}
                </div>
              </td>
            )}
          </tr>
        ))}
      </DataTable>

      <Pager page={data?.pagination.page ?? 1} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />

      <Modal
        open={formOpen}
        title={formMode === "edit" ? t("employees.editTitle") : t("employees.add")}
        onClose={() => setFormOpen(false)}
      >
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <ErrorNotice message={formError} />
          <Field label={t("common.branch")} required>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.branchId}
                disabled={formMode === "edit"}
                onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                required
              >
                {branches?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("common.fullName")} required>
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                required
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.phone")}>
              {(id) => (
                <>
                  <input
                    id={id}
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    className="input"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    aria-invalid={!phoneValid ? true : undefined}
                  />
                  {!phoneValid && (
                    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                      {t("common.phoneInvalid")}
                    </p>
                  )}
                </>
              )}
            </Field>
            <Field label={t("employees.hireDate")}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  className="input"
                  value={form.hireDate}
                  onChange={(e) => setForm((f) => ({ ...f, hireDate: e.target.value }))}
                />
              )}
            </Field>
          </div>

          <Field label={t("employees.position")}>
            {(id) => (
              <select
                id={id}
                className="input"
                value={form.positionChoice}
                onChange={(e) => setForm((f) => ({ ...f, positionChoice: e.target.value }))}
              >
                <option value="">{t("employees.positionSelect")}</option>
                {positionOptions.map((p) => (
                  <option key={p} value={p}>
                    {positionLabel(p)}
                  </option>
                ))}
                <option value={OTHER}>{t("employees.positionOther")}</option>
              </select>
            )}
          </Field>
          {form.positionChoice === OTHER && (
            <Field label={t("employees.positionCustom")} required>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  maxLength={POSITION_MAX_LENGTH}
                  value={form.customPosition}
                  onChange={(e) => setForm((f) => ({ ...f, customPosition: e.target.value }))}
                  aria-invalid={!positionValid ? true : undefined}
                  autoFocus
                />
              )}
            </Field>
          )}

          {formMode === "edit" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              {t("common.active")}
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !formValid}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("employees.deleteTitle")}
        message={deleteTarget ? `${deleteTarget.fullName} — ${t("employees.deleteMessage")}` : ""}
        confirmLabel={t("common.delete")}
        requireReason
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
