"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiDelete, apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, ErrorNotice, Field, Modal, PageHeader, useToast } from "@/components/ui";

interface StudentRow {
  id: string;
  fullName: string;
  studentCode: string;
  photoUrl: string | null;
  status: string;
  phone: string | null;
  enrollmentDate: string;
  parents: { parent: { fullName: string; phone: string } }[];
}

interface GroupDetail {
  id: string;
  name: string;
  capacity: number;
  notes: string | null;
  isActive: boolean;
  grade: { id: string; name: string };
  stage: { id: string; name: string };
  subject: { id: string; name: string; code: string | null } | null;
  teacher: { id: string; fullName: string } | null;
  assistant: { id: string; fullName: string } | null;
  schedules: { id: string; dayOfWeek: string; startMinutes: number; endMinutes: number; isActive: boolean }[];
  currentCount: number;
  remaining: number;
  capacityPercent: number;
  isFull: boolean;
  deletion: { canDelete: boolean; blockers: { key: string; count: number }[] };
  students: StudentRow[];
}

const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Group Details page (spec §16): info + roster with search/filter/sort, Add Student, Export. */
export default function GroupDetailPage() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const { data: group, loading, error, reload } = useApi<GroupDetail>(`/api/groups/${groupId}`, [groupId]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<"name" | "status" | "enrolled">("name");

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [day, setDay] = useState("SATURDAY");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("19:00");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const filteredStudents = useMemo(() => {
    let rows = group?.students ?? [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.studentCode.toLowerCase().includes(q) ||
          (s.phone ?? "").includes(q) ||
          s.parents.some((p) => p.parent.phone.includes(q))
      );
    }
    if (statusFilter !== "ALL") rows = rows.filter((s) => s.status === statusFilter);
    rows = [...rows].sort((a, b) => {
      if (sortKey === "name") return a.fullName.localeCompare(b.fullName);
      if (sortKey === "status") return a.status.localeCompare(b.status);
      return a.enrollmentDate.localeCompare(b.enrollmentDate);
    });
    return rows;
  }, [group, search, statusFilter, sortKey]);

  async function addSchedule(event: FormEvent) {
    event.preventDefault();
    setSavingSchedule(true);
    setScheduleError(null);
    try {
      await apiPost("/api/schedules", {
        groupId,
        dayOfWeek: day,
        startTime,
        endTime
      });
      toast.success(t("common.saved"));
      setScheduleOpen(false);
      reload();
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : "Failed to add schedule.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function toggleActive() {
    if (!group) return;
    try {
      await apiPatch(`/api/groups/${group.id}`, { isActive: !group.isActive });
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update group.");
    }
  }

  async function removeSchedule(scheduleId: string) {
    try {
      await apiDelete(`/api/schedules/${scheduleId}`);
      toast.success(t("common.saved"));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove schedule.");
    }
  }

  async function confirmArchiveToggle() {
    setBusy(true);
    try {
      await toggleActive();
      setArchiveOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!group) return;
    setBusy(true);
    try {
      await apiDelete(`/api/groups/${group.id}`);
      toast.success(t("common.deleted"));
      router.push("/dashboard/academic");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("groups.cannotDelete"));
      setDeleteOpen(false);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function exportXlsx() {
    if (!group) return;
    const STATUS_AR: Record<string, string> = {
      ACTIVE: "نشط",
      INACTIVE: "غير نشط",
      SUSPENDED: "موقوف",
      GRADUATED: "متخرج"
    };
    // Placeholder phones ("غير-محدد-...") are not real numbers, so leave them empty.
    const cleanPhone = (p?: string | null) => (!p || p.startsWith("غير-محدد") ? "" : p);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("الطلاب", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "كود الطالب", key: "code", width: 14 },
      { header: "الاسم", key: "name", width: 32 },
      { header: "الحالة", key: "status", width: 12 },
      { header: "هاتف الطالب", key: "phone", width: 16 },
      { header: "اسم ولي الأمر", key: "parent", width: 28 },
      { header: "هاتف ولي الأمر", key: "parentPhone", width: 16 },
      { header: "تاريخ التسجيل", key: "date", width: 16 }
    ];
    for (const s of filteredStudents) {
      ws.addRow({
        code: s.studentCode,
        name: s.fullName,
        status: STATUS_AR[s.status] ?? s.status,
        phone: cleanPhone(s.phone),
        parent: s.parents[0]?.parent.fullName ?? "",
        parentPhone: cleanPhone(s.parents[0]?.parent.phone),
        date: s.enrollmentDate.slice(0, 10)
      });
    }
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    ws.eachRow((row) => {
      row.alignment = { horizontal: "right", vertical: "middle" };
    });
    // Phones and codes as text so Excel keeps the leading zero.
    ["A", "D", "F"].forEach((col) => {
      ws.getColumn(col).numFmt = "@";
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${group.name}-students.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>;
  if (error || !group) return <ErrorNotice message={error ?? "Group not found."} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={[group.stage.name, group.grade.name, group.subject?.name, group.name].filter(Boolean).join(" › ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/academic" className="btn-secondary">
              {t("common.back")}
            </Link>
            <button type="button" className="btn-secondary" onClick={() => setScheduleOpen(true)}>
              {t("schedule.add")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setArchiveOpen(true)}>
              {group.isActive ? t("common.archive") : t("common.restore")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 dark:border-red-800 dark:text-red-400"
              onClick={() => setDeleteOpen(true)}
            >
              {t("common.delete")}
            </button>
          </div>
        }
      />

      {!group.subject && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("groups.legacyNoSubject")}{" "}
          <Link href="/dashboard/academic" className="underline">
            {t("nav.groups")}
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card p-4">
          <p className="text-xs text-black/50 dark:text-white/50">{t("common.status")}</p>
          <Badge tone={group.isFull ? "danger" : group.isActive ? "success" : "neutral"}>
            {!group.isActive ? t("common.archived") : group.isFull ? "FULL" : t("common.active")}
          </Badge>
        </div>
        <div className="card p-4">
          <p className="text-xs text-black/50 dark:text-white/50">{t("groups.subject")}</p>
          {group.subject ? (
            <Link href={`/dashboard/academic/subjects/${group.subject.id}`} className="font-medium hover:underline">
              {group.subject.name}
              {group.subject.code ? ` (${group.subject.code})` : ""}
            </Link>
          ) : (
            <p className="text-sm text-black/50 dark:text-white/50">{t("groups.noSubject")}</p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-black/50 dark:text-white/50">{t("groups.teacher")}</p>
          <p className="font-medium">{group.teacher?.fullName ?? "—"}</p>
          {group.assistant && (
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              {t("groups.assistant")}: {group.assistant.fullName}
            </p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-black/50 dark:text-white/50">{t("groups.capacity")}</p>
          <p className="font-medium">
            {group.currentCount} / {group.capacity} ({group.remaining} remaining)
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div
              className={`h-full rounded-full ${group.isFull ? "bg-red-500" : "bg-tecno-gold"}`}
              style={{ width: `${Math.min(100, group.capacityPercent)}%` }}
            />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs text-black/50 dark:text-white/50">{t("groups.schedule")}</p>
          {group.schedules.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">—</p>}
          {group.schedules.map((s) => (
            <p key={s.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {s.dayOfWeek} {formatTime(s.startMinutes)}–{formatTime(s.endMinutes)}
              </span>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline dark:text-red-400"
                onClick={() => removeSchedule(s.id)}
                aria-label={t("groups.scheduleRemove")}
                title={t("groups.scheduleRemove")}
              >
                ×
              </button>
            </p>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            placeholder={t("students.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="GRADUATED">Graduated</option>
          </select>
          <select className="input w-auto" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="enrolled">Sort: Enrollment date</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Link href={`/dashboard/students?groupId=${group.id}`} className="btn-primary">
            {t("students.add")}
          </Link>
          <button type="button" className="btn-secondary" onClick={exportXlsx}>
            Export
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start">{t("students.id")}</th>
              <th className="p-3 text-start">{t("students.title")}</th>
              <th className="p-3 text-start">Phone</th>
              <th className="p-3 text-start">Parent</th>
              <th className="p-3 text-start">{t("common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-black/50 dark:text-white/50">
                  {t("groups.rosterEmpty")}
                </td>
              </tr>
            )}
            {filteredStudents.map((s) => (
              <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
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
                <td className="p-3">{s.phone ?? "—"}</td>
                <td className="p-3">
                  {s.parents[0] ? `${s.parents[0].parent.fullName} · ${s.parents[0].parent.phone}` : "—"}
                </td>
                <td className="p-3">
                  <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={scheduleOpen} title={t("schedule.add")} onClose={() => setScheduleOpen(false)}>
        <form onSubmit={addSchedule} className="space-y-3">
          <ErrorNotice message={scheduleError} />
          <Field label="Day" required>
            {(id) => (
              <select id={id} className="input" value={day} onChange={(e) => setDay(e.target.value)}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time" required>
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className="input"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="End time" required>
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className="input"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              )}
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setScheduleOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn-primary" disabled={savingSchedule || toMinutes(endTime) <= toMinutes(startTime)}>
              {savingSchedule ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        title={group.isActive ? t("groups.archiveTitle") : t("common.restore")}
        message={group.isActive ? t("groups.archiveMessage") : group.name}
        confirmLabel={group.isActive ? t("common.archive") : t("common.restore")}
        busy={busy}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={confirmArchiveToggle}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t("groups.deleteTitle")}
        message={
          group.deletion.canDelete
            ? t("groups.deleteMessage")
            : `${t("groups.cannotDelete")} (${group.deletion.blockers
                .map((b) => `${b.count} ${t(`groups.blocker.${b.key}` as Parameters<typeof t>[0])}`)
                .join(", ")})`
        }
        confirmLabel={t("common.delete")}
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
