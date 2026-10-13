"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useApi, formatDateTime, formatMoneyClient } from "@/lib/client";
import { OverdueNotices } from "@/components/payments/OverdueNotices";
import { BarChart, Badge, ErrorNotice, PageHeader, StatCard } from "@/components/ui";

/**
 * Admin dashboard (spec §8, §65).
 *
 * Every figure comes from /api/dashboard/stats, which computes real
 * aggregates and omits blocks the caller is not permitted to see — so a
 * teacher simply gets no finance section rather than a zeroed one.
 */

interface Stats {
  students: { total: number; active: number };
  teachers: number;
  groups: number;
  branches: number;
  attendanceToday?: {
    present: number;
    late: number;
    makeUp: number;
    excused: number;
    absent: number;
    sessions: number;
  };
  finance?: {
    monthlyRevenue: number;
    paidStudents: number;
    unpaidStudents: number;
    outstanding: number;
    overdueMonths: number;
    todayPaymentsCount: number;
    todayPaymentsAmount: number;
  };
  groupCapacity?: {
    id: string;
    name: string;
    gradeName: string;
    stageName: string;
    current: number;
    capacity: number;
    isFull: boolean;
  }[];
  financeTrend?: { month: string; revenue: number }[];
  upcomingExams?: {
    id: string;
    name: string;
    date: string;
    subject: { name: string };
    group: { name: string };
  }[];
  recentActivity?: {
    id: string;
    action: string;
    entityType: string;
    createdAt: string;
    actor: { fullName: string } | null;
  }[];
}

export default function DashboardPage() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<Stats>("/api/dashboard/stats?trendMonths=6");

  const alerts: string[] = [];
  if (data?.finance) {
    if (data.finance.overdueMonths > 0) {
      alerts.push(`${data.finance.overdueMonths} overdue subscription months`);
    }
  }
  if (data?.attendanceToday && data.attendanceToday.absent > 0) {
    alerts.push(`${data.attendanceToday.absent} absences recorded today`);
  }

  const placeholder = loading ? "—" : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.dashboard")}
        description={t("app.tagline")}
        actions={
          <Link href="/dashboard/attendance/scan" className="btn-primary">
            {t("nav.scanner")}
          </Link>
        }
      />

      <OverdueNotices />

      <ErrorNotice message={error} />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("dashboard.totalStudents")} value={data?.students.total ?? placeholder} />
        <StatCard label={t("dashboard.activeStudents")} value={data?.students.active ?? placeholder} />
        <StatCard label={t("dashboard.totalTeachers")} value={data?.teachers ?? placeholder} />
        <StatCard label={t("dashboard.totalGroups")} value={data?.groups ?? placeholder} />
      </section>

      {data?.attendanceToday && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
            {t("dashboard.presentToday")}
          </h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={t("dashboard.presentToday")}
              value={data.attendanceToday.present + data.attendanceToday.makeUp}
              hint={`${data.attendanceToday.sessions} sessions scheduled`}
              tone="positive"
            />
            <StatCard label={t("dashboard.lateToday")} value={data.attendanceToday.late} tone="warning" />
            <StatCard label={t("dashboard.absentToday")} value={data.attendanceToday.absent} tone="negative" />
            <StatCard label={t("scanner.makeup")} value={data.attendanceToday.makeUp} />
          </div>
        </section>
      )}

      {data?.finance && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
            {t("nav.finance")}
          </h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={t("dashboard.monthlyRevenue")}
              value={formatMoneyClient(data.finance.monthlyRevenue)}
              tone="positive"
            />
            <StatCard label={t("pay.paidStudents")} value={data.finance.paidStudents} tone="positive" />
            <StatCard label={t("pay.unpaidStudents")} value={data.finance.unpaidStudents} tone="warning" />
            <StatCard
              label={t("dashboard.outstanding")}
              value={formatMoneyClient(data.finance.outstanding)}
              hint={`${t("pay.overdueMonths")}: ${data.finance.overdueMonths}`}
              tone="negative"
            />
            <StatCard
              label="Today's Payments"
              value={data.finance.todayPaymentsCount}
              hint={formatMoneyClient(data.finance.todayPaymentsAmount)}
              tone="positive"
            />
          </div>
        </section>
      )}

      {data?.groupCapacity && data.groupCapacity.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
            Group Capacity
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.groupCapacity.map((g) => {
              const percent = g.capacity > 0 ? Math.min(100, Math.round((g.current / g.capacity) * 100)) : 0;
              return (
                <div key={g.id} className="card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{g.name}</span>
                    {g.isFull && <Badge tone="danger">FULL</Badge>}
                  </div>
                  <p className="text-xs text-black/50 dark:text-white/50">
                    {g.stageName} · {g.gradeName}
                  </p>
                  <p className="mt-1 text-sm">
                    {g.current} / {g.capacity}
                  </p>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div
                      className={`h-full rounded-full ${g.isFull ? "bg-red-500" : "bg-tecno-gold"}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.financeTrend && data.financeTrend.length > 0 && (
          <div className="card p-4">
            <h3 className="mb-3 font-semibold">{t("dashboard.financeTrend")}</h3>
            <BarChart
              data={data.financeTrend.map((row) => ({
                label: row.month.slice(5),
                primary: row.revenue
              }))}
            />
          </div>
        )}

        <div className="card p-4">
          <h3 className="mb-3 font-semibold">{t("dashboard.alerts")}</h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-black/55 dark:text-white/55">{t("dashboard.noAlerts")}</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alert) => (
                <li key={alert} className="flex items-center gap-2 text-sm">
                  <Badge tone="warning">!</Badge>
                  {alert}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.upcomingExams && (
          <div className="card p-4">
            <h3 className="mb-3 font-semibold">{t("nav.exams")}</h3>
            {data.upcomingExams.length === 0 ? (
              <p className="text-sm text-black/55 dark:text-white/55">{t("exams.empty")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.upcomingExams.map((exam) => (
                  <li key={exam.id} className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-medium">{exam.name}</span>{" "}
                      <span className="text-black/50 dark:text-white/50">
                        {exam.subject.name} · {exam.group.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-black/50 dark:text-white/50">
                      {formatDateTime(exam.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {data?.recentActivity && data.recentActivity.length > 0 && (
          <div className="card p-4">
            <h3 className="mb-3 font-semibold">{t("audit.title")}</h3>
            <ul className="space-y-2 text-sm">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-mono text-xs">{entry.action}</span>{" "}
                    <span className="text-black/50 dark:text-white/50">
                      {entry.actor?.fullName ?? "system"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-black/50 dark:text-white/50">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
