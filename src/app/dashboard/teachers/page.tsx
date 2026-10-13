"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, useApi } from "@/lib/client";
import { optionalEmailSchema, optionalPhoneSchema } from "@/lib/staff";
import { Badge, ConfirmDialog, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface TeacherRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isAssistant: boolean;
  isActive: boolean;
  branch: { id: string; name: string };
  subjects?: { id: string; name: string }[];
  groups: { id: string; name: string; gradeName: string; subjectName?: string | null }[];
}

interface ListResponse {
  data: TeacherRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/** Response of GET /api/teachers/[id]. */
interface TeacherDetail {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isAssistant: boolean;
  isActive: boolean;
  branchId: string;
  groupIds: string[];
}

interface BranchOption {
  id: string;
  name: string;
}

interface GroupOption {
  id: string;
  name: string;
  branchId: string;
  grade?: { id: string; name: string } | null;
  subject?: { id: string; name: string } | null;
  teacher: { id: string; fullName: string } | null;
  assistant: { id: string; fullName: string } | null;
}

interface FormState {
  branchId: string;
  fullName: string;
  phone: string;
  email: string;
  isAssistant: boolean;
  isActive: boolean;
  groupIds: string[];
}

const EMPTY_FORM: FormState = {
  branchId: "",
  fullName: "",
  phone: "",
  email: "",
  isAssistant: false,
  isActive: true,
  groupIds: []
};

interface Takeover {
  groupId: string;
  groupName: string;
  currentStaffName: string;
}

interface TimeConflict {
  a: { id: string; name: string };
  b: { id: string; name: string };
}

const MAX_CHIPS = 3;

function TeachersPage() {
  const { t } = useI18n();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | "false" | "true">("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { data: branches } = useApi<BranchOption[]>("/api/branches");
  const { data: groups, loading: groupsLoading, reload: reloadGroups } = useApi<GroupOption[]>("/api/groups");

  // Buttons are hidden for roles without the permission; the API enforces it regardless.
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setPermissions(new Set<string>(me?.permissions ?? [])))
      .catch(() => setPermissions(new Set()));
  }, []);
  const canCreate = permissions.has("teachers.create");
  const canEdit = permissions.has("teachers.update");
  const canDelete = permissions.has("teachers.delete");
  const showActions = canEdit || canDelete;
  const columnCount = showActions ? 7 : 6;

  // One modal/form serves both "add" and "edit".
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [takeovers, setTakeovers] = useState<Takeover[]>([]);
  const [timeConflicts, setTimeConflicts] = useState<TimeConflict[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<TeacherRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search, role filter and pagination share one request, so they always combine.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());
    if (roleFilter) params.set("isAssistant", roleFilter);

    const controller = new AbortController();
    fetch(`/api/teachers?${params.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load teachers.");
        }
        return r.json();
      })
      .then(setResult)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search, roleFilter, page, refreshKey]);

  // Same zod rules the API applies (src/lib/staff.ts), so both layers agree.
  const phoneValid = optionalPhoneSchema.safeParse(form.phone).success;
  const emailValid = optionalEmailSchema.safeParse(form.email).success;
  const nameValid = form.fullName.trim().length >= 2;
  const formValid = nameValid && phoneValid && emailValid && form.branchId !== "";

  const groupsForBranch = useMemo(
    () => (groups ?? []).filter((g) => g.branchId === form.branchId),
    [groups, form.branchId]
  );
  const groupLabel = (g: GroupOption) =>
    [g.grade?.name, g.subject?.name].filter(Boolean).length > 0
      ? `${g.name} — ${[g.grade?.name, g.subject?.name].filter(Boolean).join(" · ")}`
      : g.name;
  /** Who currently holds the group in the column this person would use (null when free or already theirs). */
  function currentOwner(g: GroupOption): string | null {
    const owner = form.isAssistant ? g.assistant : g.teacher;
    return owner && owner.id !== editingId ? owner.fullName : null;
  }

  function clearFeedback() {
    setFormError(null);
    setTakeovers([]);
    setTimeConflicts([]);
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM, branchId: branches?.[0]?.id ?? "" });
    setFormMode("create");
    setEditingId(null);
    setTouched(false);
    clearFeedback();
    reloadGroups();
    setFormOpen(true);
  }

  async function openEdit(row: TeacherRow) {
    setEditLoadingId(row.id);
    try {
      const { data: d } = await apiGet<TeacherDetail>(`/api/teachers/${row.id}`);
      setForm({
        branchId: d.branchId,
        fullName: d.fullName,
        phone: d.phone ?? "",
        email: d.email ?? "",
        isAssistant: d.isAssistant,
        isActive: d.isActive,
        groupIds: d.groupIds
      });
      setFormMode("edit");
      setEditingId(d.id);
      setTouched(false);
      clearFeedback();
      reloadGroups();
      setFormOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load teacher.");
    } finally {
      setEditLoadingId(null);
    }
  }

  function closeForm() {
    setFormOpen(false);
    clearFeedback();
  }

  function toggleGroup(id: string) {
    clearFeedback();
    setForm((f) => ({
      ...f,
      groupIds: f.groupIds.includes(id) ? f.groupIds.filter((g) => g !== id) : [...f.groupIds, id]
    }));
  }

  async function handleSubmit(event: FormEvent, allowReassign = false) {
    event.preventDefault();
    setTouched(true);
    clearFeedback();
    if (!formValid) return;

    setSubmitting(true);
    try {
      if (formMode === "edit" && editingId) {
        await apiPatch(`/api/teachers/${editingId}`, {
          fullName: form.fullName.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          isActive: form.isActive,
          groupIds: form.groupIds,
          allowReassign
        });
        toast.success(t("common.saved"));
      } else {
        await apiPost("/api/teachers", {
          branchId: form.branchId,
          fullName: form.fullName.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          isAssistant: form.isAssistant,
          groupIds: form.groupIds,
          allowReassign
        });
        toast.success(t("common.created"));
        setPage(1);
      }
      setFormOpen(false);
      setRefreshKey((k) => k + 1);
      reloadGroups();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const details = err.details as
          | { code?: string; groups?: Takeover[]; conflicts?: TimeConflict[]; fieldErrors?: Record<string, string[]> }
          | undefined;
        if (details?.code === "GROUP_ALREADY_ASSIGNED") setTakeovers(details.groups ?? []);
        else if (details?.code === "SCHEDULE_CONFLICT") setTimeConflicts(details.conflicts ?? []);
        const fieldMessages = Object.values(details?.fieldErrors ?? {})
          .map((m) => m?.[0])
          .filter(Boolean)
          .join(" ");
        setFormError(fieldMessages ? `${err.message} ${fieldMessages}` : err.message);
      } else {
        setFormError(err instanceof Error ? err.message : "Failed to save teacher.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete(reason: string) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/teachers/${deleteTarget.id}`, { reason });
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      reloadGroups();
      if (result && result.data.length === 1 && page > 1) setPage((p) => p - 1);
      else setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete teacher.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("teachers.title")}
        actions={
          canCreate ? (
            <button type="button" className="btn-primary" onClick={openCreate} disabled={!branches?.length}>
              {t("teachers.add")}
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder={t("teachers.search")}
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="input w-auto min-w-[10rem]"
          aria-label={t("teachers.role")}
          value={roleFilter}
          onChange={(e) => {
            setPage(1);
            setRoleFilter(e.target.value as "" | "false" | "true");
          }}
        >
          <option value="">{t("teachers.allRoles")}</option>
          <option value="false">{t("teachers.teacher")}</option>
          <option value="true">{t("teachers.assistant")}</option>
        </select>
      </div>

      <ErrorNotice message={error} />

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start">{t("teachers.title")}</th>
              <th className="p-3 text-start">{t("teachers.role")}</th>
              <th className="p-3 text-start">{t("common.branch")}</th>
              <th className="p-3 text-start">{t("common.phone")}</th>
              <th className="p-3 text-start">{t("teachers.groups")}</th>
              <th className="p-3 text-start">{t("common.status")}</th>
              {showActions && <th className="p-3 text-start">{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3" colSpan={columnCount}>
                    <span className="block h-4 w-full animate-pulse rounded bg-black/10 dark:bg-white/10" />
                  </td>
                </tr>
              ))}

            {!loading && result?.data.length === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={columnCount}>
                  {t("teachers.empty")}
                </td>
              </tr>
            )}

            {!loading &&
              result?.data.map((tch) => (
                <tr key={tch.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3 font-medium">
                    {tch.fullName}
                    {tch.email && <span className="block text-xs font-normal text-black/50 dark:text-white/50">{tch.email}</span>}
                  </td>
                  <td className="p-3">{tch.isAssistant ? t("teachers.assistant") : t("teachers.teacher")}</td>
                  <td className="p-3">{tch.branch.name}</td>
                  <td className="p-3" dir="ltr">
                    <span className="inline-block">{tch.phone ?? "—"}</span>
                  </td>
                  <td className="p-3">
                    {tch.groups.length === 0 ? (
                      "—"
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {tch.groups.slice(0, MAX_CHIPS).map((g) => (
                          <span
                            key={g.id}
                            title={`${g.name} — ${g.gradeName}${g.subjectName ? ` · ${g.subjectName}` : ""}`}
                            className="rounded-full bg-tecno-gold/15 px-2 py-0.5 text-xs text-tecno-gold-dark dark:text-tecno-gold"
                          >
                            {g.subjectName ? `${g.subjectName} · ${g.name}` : g.name}
                          </span>
                        ))}
                        {tch.groups.length > MAX_CHIPS && (
                          <span
                            title={tch.groups
                              .slice(MAX_CHIPS)
                              .map((g) => `${g.name} — ${g.gradeName}${g.subjectName ? ` · ${g.subjectName}` : ""}`)
                              .join("\n")}
                            className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10"
                          >
                            +{tch.groups.length - MAX_CHIPS}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge tone={tch.isActive ? "success" : "neutral"}>
                      {tch.isActive ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </td>
                  {showActions && (
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            disabled={editLoadingId === tch.id}
                            onClick={() => openEdit(tch)}
                            className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                          >
                            {editLoadingId === tch.id ? t("common.loading") : t("common.edit")}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(tch)}
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
          </tbody>
        </table>
      </div>

      {result && result.pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            ‹
          </button>
          <span className="text-sm">
            {result.pagination.page} / {result.pagination.totalPages}
          </span>
          <button
            disabled={page >= result.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            ›
          </button>
        </div>
      )}

      <Modal
        open={formOpen}
        title={formMode === "edit" ? t("teachers.editTitle") : t("teachers.add")}
        onClose={closeForm}
      >
        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-3" noValidate>
          <ErrorNotice message={formError} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("teachers.role")} required hint={formMode === "edit" ? t("teachers.roleLocked") : undefined}>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.isAssistant ? "assistant" : "teacher"}
                  disabled={formMode === "edit"}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, isAssistant: e.target.value === "assistant", groupIds: [] }))
                  }
                >
                  <option value="teacher">{t("teachers.teacher")}</option>
                  <option value="assistant">{t("teachers.assistant")}</option>
                </select>
              )}
            </Field>
            <Field label={t("common.branch")} required>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.branchId}
                  disabled={formMode === "edit"}
                  onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value, groupIds: [] }))}
                  required
                >
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <Field label={t("common.fullName")} required>
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                aria-invalid={touched && !nameValid ? true : undefined}
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
            <Field label={t("common.email")}>
              {(id) => (
                <>
                  <input
                    id={id}
                    type="email"
                    dir="ltr"
                    className="input"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    aria-invalid={!emailValid ? true : undefined}
                  />
                  {!emailValid && (
                    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                      {t("common.emailInvalid")}
                    </p>
                  )}
                </>
              )}
            </Field>
          </div>

          <fieldset className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <legend className="px-1 text-sm font-medium">
              {t("teachers.groups")} ({form.groupIds.length})
            </legend>
            <p className="mb-2 text-xs text-black/50 dark:text-white/50">{t("teachers.groupsHint")}</p>
            {groupsLoading && <p className="text-sm text-black/50 dark:text-white/50">{t("teachers.groupsLoading")}</p>}
            {!groupsLoading && groupsForBranch.length === 0 && (
              <p className="text-sm text-black/50 dark:text-white/50">{t("teachers.noGroupsAvailable")}</p>
            )}
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {groupsForBranch.map((g) => {
                const owner = currentOwner(g);
                const checked = form.groupIds.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span>
                      {groupLabel(g)}
                      {owner && (
                        <span className="ms-1 text-xs text-amber-700 dark:text-amber-300">
                          ({t("teachers.currentlyWith")} {owner})
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

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

          {takeovers.length > 0 && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <p className="mb-2">{t("teachers.reassignWarning")}</p>
              <ul className="mb-2 list-disc ps-5">
                {takeovers.map((tk) => (
                  <li key={tk.groupId}>
                    {tk.groupName} ({t("teachers.currentlyWith")} {tk.currentStaffName})
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={submitting}
                onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
              >
                {t("common.reassignAnyway")}
              </button>
            </div>
          )}

          {timeConflicts.length > 0 && (
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              <p className="mb-2">{t("teachers.scheduleConflict")}</p>
              <ul className="list-disc ps-5">
                {timeConflicts.map((c) => (
                  <li key={`${c.a.id}-${c.b.id}`}>
                    {c.a.name} ↔ {c.b.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={closeForm}>
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
        title={t("teachers.deleteTitle")}
        message={deleteTarget ? `${deleteTarget.fullName} — ${t("teachers.deleteMessage")}` : ""}
        confirmLabel={t("common.delete")}
        requireReason
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

export default TeachersPage;
