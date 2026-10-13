"use client";

import { useEffect, useMemo, useState, type FormEvent, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, useApi } from "@/lib/client";
import { normalizeWhatsAppNumber, toLocalPhone } from "@/lib/wa-link";
import { Badge, ConfirmDialog, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface StudentRow {
  id: string;
  studentCode: string;
  fullName: string;
  status: string;
  phone: string | null;
  branch: { id: string; name: string };
  stage: { id: string; name: string } | null;
  grade: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
  parents: { parent: { fullName: string; phone: string } }[];
}

interface ListResponse {
  data: StudentRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface StageOption {
  id: string;
  name: string;
  isActive: boolean;
  grades: { id: string; name: string; isActive: boolean }[];
}

interface GroupOption {
  id: string;
  name: string;
  branchId: string;
  gradeId: string;
  grade?: { id: string; name: string } | null;
  capacity: number;
  currentCount: number;
  isFull: boolean;
}

/** Response of GET /api/students/[id] (student + guardians). */
interface StudentDetail {
  id: string;
  fullName: string;
  gender: "MALE" | "FEMALE";
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  stageId: string;
  gradeId: string;
  groupId: string;
  parents: {
    isPrimary: boolean;
    relationship: string;
    parent: { id: string; fullName: string; phone: string; whatsappNumber: string | null };
  }[];
}

interface FormState {
  fullName: string;
  gender: string;
  phone: string;
  parentName: string;
  parentPhone: string;
  parentWhatsapp: string;
  address: string;
  school: string;
  notes: string;
  status: string;
  stageId: string;
  gradeId: string;
  groupId: string;
}

const EMPTY_FORM: FormState = {
  fullName: "",
  gender: "MALE",
  phone: "",
  parentName: "",
  parentPhone: "",
  parentWhatsapp: "",
  address: "",
  school: "",
  notes: "",
  status: "ACTIVE",
  stageId: "",
  gradeId: "",
  groupId: ""
};

const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED"] as const;

/** Pulls per-field messages out of a zod `flatten()` / GuardianInputError response. */
function extractFieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const fieldErrors = (details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === "object") {
    for (const [key, messages] of Object.entries(fieldErrors)) {
      if (Array.isArray(messages) && messages[0]) out[key] = messages[0];
    }
  }
  return out;
}

function StudentsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const searchParams = useSearchParams();
  const presetGroupId = searchParams.get("groupId");

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const { data: stages } = useApi<StageOption[]>("/api/stages");
  const { data: groups } = useApi<GroupOption[]>("/api/groups");

  // Buttons are hidden for roles without the permission; the API enforces it regardless.
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setPermissions(new Set<string>(me?.permissions ?? [])))
      .catch(() => setPermissions(new Set()));
  }, []);
  const canEdit = permissions.has("students.update");
  const canDelete = permissions.has("students.delete");
  const showActions = canEdit || canDelete;
  const columnCount = showActions ? 8 : 7;

  // One modal/form serves both "add" and "edit".
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<{ id: string; hasGuardian: boolean } | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, groupId: presetGroupId ?? "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [whatsappTouched, setWhatsappTouched] = useState(false);
  const [capacityBlock, setCapacityBlock] = useState<{ capacity: number; currentCount: number } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (presetGroupId) {
      const g = groups?.find((g) => g.id === presetGroupId);
      setForm((f) => ({ ...f, groupId: presetGroupId, gradeId: g?.gradeId ?? f.gradeId }));
      setFormMode("create");
      setFormOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetGroupId, groups]);

  // Search, group filter and pagination all go through the same request, so
  // they always combine (search AND group, on the requested page).
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());
    if (groupFilter) params.set("groupId", groupFilter);

    const controller = new AbortController();
    fetch(`/api/students?${params.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load students.");
        }
        return r.json();
      })
      .then(setResult)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search, groupFilter, page, refreshKey]);

  const selectedStage = useMemo(() => stages?.find((s) => s.id === form.stageId), [stages, form.stageId]);
  const gradesForStage = selectedStage?.grades.filter((g) => g.isActive) ?? [];
  const groupsForGrade = useMemo(
    () => (groups ?? []).filter((g) => g.gradeId === form.gradeId),
    [groups, form.gradeId]
  );
  const selectedGroup = groups?.find((g) => g.id === form.groupId);

  const groupLabel = (g: GroupOption) => (g.grade?.name ? `${g.name} — ${g.grade.name}` : g.name);

  // Same rule the API applies (normalizeWhatsAppNumber), so both layers agree.
  const whatsappTrimmed = form.parentWhatsapp.trim();
  const whatsappLocalError = !whatsappTrimmed
    ? t("students.parentWhatsappRequired")
    : normalizeWhatsAppNumber(whatsappTrimmed)
      ? null
      : t("students.parentWhatsappInvalid");
  const whatsappError = serverFieldErrors.parentWhatsappNumber ?? (whatsappTouched ? whatsappLocalError : null);

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setServerFieldErrors({});
    setWhatsappTouched(false);
    setCapacityBlock(null);
  }

  function openCreate() {
    if (formMode !== "create" || editing) resetForm();
    setFormMode("create");
    setEditing(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setFormError(null);
    setServerFieldErrors({});
    setCapacityBlock(null);
    if (formMode === "edit") {
      resetForm();
      setFormMode("create");
      setEditing(null);
    }
  }

  async function openEdit(row: StudentRow) {
    setEditLoadingId(row.id);
    try {
      const { data: d } = await apiGet<StudentDetail>(`/api/students/${row.id}`);
      const guardian = d.parents.find((p) => p.isPrimary) ?? d.parents[0];
      setForm({
        fullName: d.fullName,
        gender: d.gender,
        phone: d.phone ?? "",
        parentName: guardian?.parent.fullName ?? "",
        parentPhone: guardian?.parent.phone ?? "",
        parentWhatsapp: guardian?.parent.whatsappNumber ? toLocalPhone(guardian.parent.whatsappNumber) : "",
        address: d.address ?? "",
        school: "",
        notes: d.notes ?? "",
        status: d.status,
        stageId: d.stageId,
        gradeId: d.gradeId,
        groupId: d.groupId
      });
      setEditing({ id: d.id, hasGuardian: Boolean(guardian) });
      setFormMode("edit");
      setFormError(null);
      setServerFieldErrors({});
      setCapacityBlock(null);
      setWhatsappTouched(false);
      setFormOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load student.");
    } finally {
      setEditLoadingId(null);
    }
  }

  async function handleSubmit(event: FormEvent, overrideCapacity = false) {
    event.preventDefault();
    setWhatsappTouched(true);
    setFormError(null);
    setServerFieldErrors({});
    setCapacityBlock(null);

    // Frontend validation (the API validates again — never the only line of defence).
    if (whatsappLocalError) {
      setFormError(whatsappLocalError);
      return;
    }

    setSubmitting(true);
    try {
      if (formMode === "edit" && editing) {
        await apiPatch(`/api/students/${editing.id}`, {
          fullName: form.fullName.trim(),
          gender: form.gender,
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          notes: form.notes.trim() || null,
          groupId: form.groupId,
          status: form.status,
          parentName: form.parentName.trim() || undefined,
          // An existing guardian's phone is not editable here (it identifies the Parent row).
          ...(editing.hasGuardian ? {} : { parentPhone: form.parentPhone.trim() || undefined }),
          parentWhatsappNumber: whatsappTrimmed,
          overrideCapacity
        });
        toast.success(t("common.saved"));
      } else {
        let branchId = selectedGroup?.branchId;
        if (!branchId) {
          const branches = await fetch("/api/branches").then((r) => r.json()).catch(() => null);
          branchId = branches?.data?.[0]?.id;
        }
        await apiPost("/api/students", {
          branchId,
          groupId: form.groupId,
          fullName: form.fullName.trim(),
          gender: form.gender,
          phone: form.phone || undefined,
          parentName: form.parentName || undefined,
          parentPhone: form.parentPhone || undefined,
          parentWhatsappNumber: whatsappTrimmed,
          address: form.address || undefined,
          school: form.school || undefined,
          notes: form.notes || undefined,
          overrideCapacity
        });
        toast.success(t("common.created"));
        setPage(1);
      }

      setFormOpen(false);
      resetForm();
      setFormMode("create");
      setEditing(null);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const details = err.details as { code?: string; capacity?: number; currentCount?: number } | undefined;
        if (details?.code === "CAPACITY_FULL") {
          setCapacityBlock({
            capacity: details.capacity ?? selectedGroup?.capacity ?? 0,
            currentCount: details.currentCount ?? selectedGroup?.currentCount ?? 0
          });
        }
        const fieldErrors = extractFieldErrors(err.details);
        setServerFieldErrors(fieldErrors);
        const extra = Object.entries(fieldErrors)
          .filter(([key]) => key !== "parentWhatsappNumber")
          .map(([, message]) => message)
          .join(" ");
        setFormError(extra ? `${err.message} ${extra}` : err.message);
      } else {
        setFormError(err instanceof Error ? err.message : "Failed to save student.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete(reason: string) {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/students/${deleteTarget.id}`, { reason });
      toast.success(t("common.deleted"));
      setDeleteTarget(null);
      if (result && result.data.length === 1 && page > 1) setPage((p) => p - 1);
      else setRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete student.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("students.title")}
        actions={
          <button className="btn-primary" onClick={openCreate}>
            {t("students.add")}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder={t("students.search")}
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="input w-auto min-w-[12rem]"
          aria-label={t("students.filterByGroup")}
          value={groupFilter}
          onChange={(e) => {
            setPage(1);
            setGroupFilter(e.target.value);
          }}
        >
          <option value="">{t("students.allGroups")}</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {groupLabel(g)}
            </option>
          ))}
        </select>
      </div>

      <ErrorNotice message={error} />

      <div className="card overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start">{t("students.id")}</th>
              <th className="p-3 text-start">{t("students.title")}</th>
              <th className="p-3 text-start">{t("nav.stages")}</th>
              <th className="p-3 text-start">{t("grades.title")}</th>
              <th className="p-3 text-start">{t("nav.groups")}</th>
              <th className="p-3 text-start">Phone</th>
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
                  {t("students.empty")}
                </td>
              </tr>
            )}

            {!loading &&
              result?.data.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-b border-black/5 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]"
                >
                  <td className="p-3 font-mono text-xs">
                    <Link href={`/dashboard/students/${s.id}`} className="hover:underline">
                      {s.studentCode}
                    </Link>
                  </td>
                  <td className="p-3 font-medium">
                    <Link href={`/dashboard/students/${s.id}`} className="hover:underline">
                      {s.fullName}
                    </Link>
                  </td>
                  <td className="p-3">{s.stage?.name ?? "—"}</td>
                  <td className="p-3">{s.grade?.name ?? "—"}</td>
                  <td className="p-3">{s.group?.name ?? "—"}</td>
                  <td className="p-3">{s.phone ?? s.parents[0]?.parent.phone ?? "—"}</td>
                  <td className="p-3">
                    <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status}</Badge>
                  </td>
                  {showActions && (
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            disabled={editLoadingId === s.id}
                            onClick={() => openEdit(s)}
                            className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
                          >
                            {editLoadingId === s.id ? t("common.loading") : t("common.edit")}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(s)}
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
        title={formMode === "edit" ? t("students.editTitle") : t("students.add")}
        onClose={closeForm}
      >
        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-3" noValidate>
          <ErrorNotice message={formError} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
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
            <Field label="Gender" required>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.gender}
                  onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                >
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                </select>
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("nav.stages")} required>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.stageId}
                  onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value, gradeId: "", groupId: "" }))}
                  required
                >
                  <option value="" disabled>
                    {t("common.select")}
                  </option>
                  {(stages ?? [])
                    .filter((s) => s.isActive)
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
                  onChange={(e) => setForm((f) => ({ ...f, gradeId: e.target.value, groupId: "" }))}
                  required
                  disabled={!form.stageId}
                >
                  <option value="" disabled>
                    {t("common.select")}
                  </option>
                  {gradesForStage.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("nav.groups")} required>
              {(id) => (
                <select
                  id={id}
                  className="input"
                  value={form.groupId}
                  onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
                  required
                  disabled={!form.gradeId}
                >
                  <option value="" disabled>
                    {t("common.select")}
                  </option>
                  {groupsForGrade.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.currentCount}/{g.capacity}
                      {g.isFull ? " · FULL" : ""})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Parent/Guardian name">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={form.parentName}
                  onChange={(e) => setForm((f) => ({ ...f, parentName: e.target.value }))}
                />
              )}
            </Field>
            <Field
              label="Parent/Guardian phone"
              hint={formMode === "create" || !editing?.hasGuardian ? t("students.parentPhoneHint") : undefined}
            >
              {(id) => (
                <input
                  id={id}
                  className="input"
                  dir="ltr"
                  inputMode="tel"
                  value={form.parentPhone}
                  disabled={formMode === "edit" && Boolean(editing?.hasGuardian)}
                  onChange={(e) => setForm((f) => ({ ...f, parentPhone: e.target.value }))}
                />
              )}
            </Field>
            <Field label={t("students.parentWhatsapp")} required hint={t("students.parentWhatsappHint")}>
              {(id) => (
                <>
                  <input
                    id={id}
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    autoComplete="off"
                    placeholder="01012345678"
                    className="input"
                    value={form.parentWhatsapp}
                    onChange={(e) => {
                      setServerFieldErrors((errs) => ({ ...errs, parentWhatsappNumber: "" }));
                      setForm((f) => ({ ...f, parentWhatsapp: e.target.value }));
                    }}
                    onBlur={() => setWhatsappTouched(true)}
                    aria-invalid={whatsappError ? true : undefined}
                    required
                  />
                  {whatsappError && (
                    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                      {whatsappError}
                    </p>
                  )}
                </>
              )}
            </Field>
            <Field label="Student phone">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  dir="ltr"
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Address">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              )}
            </Field>
            {formMode === "edit" && (
              <Field label={t("common.status")}>
                {(id) => (
                  <select
                    id={id}
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>

          <Field label={t("common.notes")}>
            {(id) => (
              <textarea
                id={id}
                className="input"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            )}
          </Field>

          {capacityBlock && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <p className="mb-2">
                This group is full ({capacityBlock.currentCount}/{capacityBlock.capacity}). An administrator can
                override this restriction to enroll anyway.
              </p>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
                disabled={submitting}
              >
                Override and enroll anyway
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={closeForm}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !form.fullName.trim() || !form.groupId}>
              {submitting ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("students.deleteTitle")}
        message={
          deleteTarget
            ? `${deleteTarget.fullName} (${deleteTarget.studentCode}) — ${t("students.deleteMessage")}`
            : ""
        }
        confirmLabel={t("common.delete")}
        requireReason
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

export default function StudentsPageWrapper() {
  return (
    <Suspense fallback={null}>
      <StudentsPage />
    </Suspense>
  );
}
