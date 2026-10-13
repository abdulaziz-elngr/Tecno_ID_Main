"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDateTime, qs, todayISO, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, PageHeader, useToast } from "@/components/ui";

interface EmployeeOption {
  id: string;
  fullName: string;
  position: string | null;
}

interface AttendanceRecord {
  id: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string;
  lateMinutes: number;
  totalMinutes: number | null;
  employee: { id: string; fullName: string; position: string | null };
}

function toneFor(status: string) {
  if (status === "LATE") return "warning" as const;
  if (status === "EARLY_LEAVE") return "warning" as const;
  if (status === "OVERTIME") return "brand" as const;
  return "success" as const;
}

export default function EmployeeAttendancePage() {
  const { t } = useI18n();
  const toast = useToast();
  const today = todayISO();

  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [expectedStart, setExpectedStart] = useState("09:00");
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [punchError, setPunchError] = useState<string | null>(null);

  const { data: employees } = useApi<{ employees: EmployeeOption[] }>(
    "/api/employees?pageSize=100"
  );

  const { data, loading, error, reload } = useApi<{ records: AttendanceRecord[] }>(
    `/api/employee-attendance${qs({
      from: today,
      to: today,
      pageSize: 100
    })}`
  );

  const records = data?.records ?? [];
  const selectedRecord = records.find((r) => r.employee.id === selectedEmployee);

  async function punch(action: "CHECK_IN" | "CHECK_OUT") {
    if (!selectedEmployee) return;

    setBusy(action === "CHECK_IN" ? "in" : "out");
    setPunchError(null);

    try {
      const [h, m] = expectedStart.split(":").map(Number);
      const expectedStartMinutes = (h ?? 0) * 60 + (m ?? 0);

      await apiPost("/api/employee-attendance", {
        employeeId: selectedEmployee,
        action,
        expectedStartMinutes:
          action === "CHECK_IN" ? expectedStartMinutes : undefined
      });

      toast.success(
        action === "CHECK_IN"
          ? t("employeeAttendance.checkIn")
          : t("employeeAttendance.checkOut")
      );

      reload();
    } catch (err) {
      setPunchError(
        err instanceof Error
          ? err.message
          : "Failed to record attendance."
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("employeeAttendance.title")} />

      <ErrorNotice message={error ?? punchError} />

      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <Field label={t("employees.title")} required>
          {(id) => (
            <select
              id={id}
              className="input"
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
            >
              <option value="">—</option>

              {employees?.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                  {e.position ? ` — ${e.position}` : ""}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="Expected start time"
          hint="Used to calculate lateness"
        >
          {(id) => (
            <input
              id={id}
              type="time"
              className="input"
              value={expectedStart}
              onChange={(e) => setExpectedStart(e.target.value)}
            />
          )}
        </Field>

        <div className="flex items-end gap-2">
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={
              !selectedEmployee ||
              Boolean(selectedRecord?.checkInAt) ||
              busy !== null
            }
            onClick={() => punch("CHECK_IN")}
          >
            {busy === "in"
              ? t("common.loading")
              : t("employeeAttendance.checkIn")}
          </button>

          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={
              !selectedEmployee ||
              !selectedRecord?.checkInAt ||
              Boolean(selectedRecord?.checkOutAt) ||
              busy !== null
            }
            onClick={() => punch("CHECK_OUT")}
          >
            {busy === "out"
              ? t("common.loading")
              : t("employeeAttendance.checkOut")}
          </button>
        </div>
      </div>

      <DataTable
        columns={[
          t("employees.title"),
          "Position",
          "Check-in",
          "Check-out",
          "Total",
          t("common.status")
        ]}
        loading={loading}
        isEmpty={records.length === 0}
        emptyTitle={t("employeeAttendance.empty")}
      >
        {records.map((r) => (
          <tr
            key={r.id}
            className="border-b border-black/5 dark:border-white/5"
          >
            <td className="p-3 font-medium">
              {r.employee.fullName}
            </td>

            <td className="p-3">
              {r.employee.position ?? "—"}
            </td>

            <td className="p-3">
              {formatDateTime(r.checkInAt)}
            </td>

            <td className="p-3">
              {formatDateTime(r.checkOutAt)}
            </td>

            <td className="p-3">
              {r.totalMinutes
                ? `${Math.round(r.totalMinutes / 60)}h ${
                    r.totalMinutes % 60
                  }m`
                : "—"}
            </td>

            <td className="p-3">
              <Badge tone={toneFor(r.status)}>
                {r.status}
              </Badge>

              {r.lateMinutes > 0 && (
                <span className="ms-2 text-xs text-black/50 dark:text-white/50">
                  +{r.lateMinutes}m late
                </span>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
