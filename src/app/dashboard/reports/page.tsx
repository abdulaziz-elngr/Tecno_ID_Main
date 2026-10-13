"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { BarChart, DataTable, ErrorNotice, Field, PageHeader, StatCard } from "@/components/ui";
import { formatMoneyClient, qs, todayISO, useApi } from "@/lib/client";

interface FinancialReport {
  summary: {
    revenue: number;
    billed: number;
    collected: number;
    outstanding: number;
    collectionRate: number;
  };
  byMethod: { method: string; amount: number }[];
  series: { key: string; revenue: number }[];
}

interface StudentReportRow {
  studentId: string;
  studentCode: string;
  fullName: string;
  branch: string;
  sessions: number;
  present: number;
  absent: number;
  attendancePercentage: number;
  examAverage: number | null;
  outstanding: number;
  flags: string[];
}

function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"financial" | "students">("financial");
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayISO());
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const { data: financial, loading: financialLoading, error: financialError } = useApi<FinancialReport>(
    tab === "financial" ? `/api/reports/financial${qs({ from, to, groupBy: "month" })}` : null,
    [tab, from, to]
  );
  const { data: students, loading: studentsLoading, error: studentsError } = useApi<{
    rows: StudentReportRow[];
    count: number;
  }>(tab === "students" ? `/api/reports/students${qs({ from, to, flagged: flaggedOnly ? "true" : undefined })}` : null, [
    tab,
    from,
    to,
    flaggedOnly
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("reports.title")}
        actions={
          <a
            href={
              tab === "financial"
                ? `/api/reports/financial${qs({ from, to, groupBy: "month", format: "csv" })}`
                : `/api/reports/students${qs({ from, to, flagged: flaggedOnly ? "true" : undefined, format: "csv" })}`
            }
            className="btn-secondary"
          >
            {t("reports.export")}
          </a>
        }
      />

      <div className="flex gap-2 border-b border-black/10 dark:border-white/10">
        {(["financial", "students"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === tabKey
                ? "border-b-2 border-tecno-gold text-tecno-gold-dark dark:text-tecno-gold"
                : "text-black/55 dark:text-white/55"
            }`}
          >
            {tabKey === "financial" ? t("reports.financial") : t("reports.students")}
          </button>
        ))}
      </div>

      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <Field label={t("common.from")}>
          {(id) => <input id={id} type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label={t("common.to")}>
          {(id) => <input id={id} type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        {tab === "students" && (
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="h-4 w-4" />
            {t("reports.flaggedOnly")}
          </label>
        )}
      </div>

      {tab === "financial" && (
        <>
          <ErrorNotice message={financialError} />
          {financial && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Revenue" value={formatMoneyClient(financial.summary.revenue)} tone="positive" />
                <StatCard label="Outstanding" value={formatMoneyClient(financial.summary.outstanding)} tone="negative" />
                <StatCard label="Collection rate" value={`${financial.summary.collectionRate}%`} />
              </div>
              {financial.series.length > 0 && (
                <div className="card p-4">
                  <p className="mb-2 text-sm font-medium">Revenue</p>
                  <BarChart
                    data={financial.series.map((s) => ({ label: s.key, primary: s.revenue }))}
                  />
                </div>
              )}
            </>
          )}
          {financialLoading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
        </>
      )}

      {tab === "students" && (
        <>
          <ErrorNotice message={studentsError} />
          <DataTable
            columns={[t("common.student"), t("common.branch"), "Attendance %", "Exam avg", "Outstanding", "Flags"]}
            loading={studentsLoading}
            isEmpty={(students?.rows.length ?? 0) === 0}
            emptyTitle={t("reports.empty")}
          >
            {students?.rows.map((r) => (
              <tr key={r.studentId} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">
                  {r.fullName}
                  <span className="ms-2 font-mono text-xs text-black/45 dark:text-white/45">{r.studentCode}</span>
                </td>
                <td className="p-3">{r.branch}</td>
                <td className="p-3">{r.attendancePercentage}%</td>
                <td className="p-3">{r.examAverage !== null ? `${r.examAverage}%` : "—"}</td>
                <td className="p-3">{formatMoneyClient(r.outstanding)}</td>
                <td className="p-3 text-xs text-amber-600 dark:text-amber-400">{r.flags.join(", ") || "—"}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </div>
  );
}
