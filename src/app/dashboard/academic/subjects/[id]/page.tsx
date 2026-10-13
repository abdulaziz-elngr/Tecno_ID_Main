"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { formatDate, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, PageHeader, StatCard } from "@/components/ui";

interface SubjectDetail {
  id: string;
  name: string;
  code: string | null;
  totals: {
    groups: number;
    activeGroups: number;
    students: number;
    capacity: number;
    stages: { id: string; name: string }[];
    grades: { id: string; name: string; stageName: string }[];
  };
  teachers: { id: string; fullName: string; phone: string | null; declared: boolean; groupIds: string[] }[];
  groups: {
    id: string;
    name: string;
    capacity: number;
    isActive: boolean;
    grade: { id: string; name: string };
    stage: { id: string; name: string };
    teacher: { id: string; fullName: string } | null;
    assistant: { id: string; fullName: string } | null;
    schedules: { id: string; dayOfWeek: string; startMinutes: number; endMinutes: number }[];
    studentCount: number;
    remaining: number;
  }[];
  activity: {
    exams: number;
    sessions: number;
    completedSessions: number;
    attendanceRecords: number;
    recitations: number;
  };
  recentExams: {
    id: string;
    name: string;
    date: string;
    isPublished: boolean;
    group: { id: string; name: string };
    _count: { results: number };
  }[];
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Subject details: Subject -> Teachers -> Groups -> Students, with each
 * group's schedule and capacity plus what has happened in the subject so far
 * (exams, sessions, attendance, recitations).
 */
export default function SubjectDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const { data: subject, loading, error } = useApi<SubjectDetail>(`/api/subjects/${params.id}`, [params.id]);

  if (loading) return <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>;
  if (error || !subject) return <ErrorNotice message={error ?? "Subject not found."} />;

  const groupNames = new Map(subject.groups.map((g) => [g.id, g.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title={subject.code ? `${subject.name} (${subject.code})` : subject.name}
        description={subject.totals.grades.map((g) => `${g.stageName} · ${g.name}`).join(" — ") || undefined}
        actions={
          <Link href="/dashboard/academic/subjects" className="btn-secondary">
            {t("common.back")}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("subjects.teachers")}
          value={subject.teachers.length}
          hint={subject.teachers.length === 0 ? t("subjects.noTeachers") : undefined}
        />
        <StatCard
          label={t("subjects.groups")}
          value={subject.totals.groups}
          hint={`${subject.totals.activeGroups} ${t("common.active")}`}
        />
        <StatCard
          label={t("subjects.students")}
          value={subject.totals.students}
          hint={`${t("subjects.capacity")}: ${subject.totals.capacity}`}
        />
        <StatCard
          label={t("subjects.stages")}
          value={subject.totals.stages.length}
          hint={subject.totals.stages.map((s) => s.name).join(" · ") || undefined}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("subjects.teachers")}</h2>
        <DataTable
          columns={[t("groups.teacher"), "Phone", t("subjects.groups")]}
          loading={false}
          isEmpty={subject.teachers.length === 0}
          emptyTitle={t("subjects.noTeachers")}
        >
          {subject.teachers.map((tch) => (
            <tr key={tch.id} className="border-b border-black/5 dark:border-white/5">
              <td className="p-3 font-medium">{tch.fullName}</td>
              <td className="p-3" dir="ltr">
                <span className="inline-block">{tch.phone ?? "—"}</span>
              </td>
              <td className="p-3">
                {tch.groupIds.length === 0 ? (
                  "—"
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {tch.groupIds.map((gid) => (
                      <Link
                        key={gid}
                        href={`/dashboard/academic/groups/${gid}`}
                        className="rounded-full bg-tecno-gold/15 px-2 py-0.5 text-xs text-tecno-gold-dark hover:underline dark:text-tecno-gold"
                      >
                        {groupNames.get(gid) ?? gid}
                      </Link>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("subjects.groups")}</h2>
        <DataTable
          columns={[
            `${t("nav.stages")} › ${t("grades.title")}`,
            t("nav.groups"),
            t("groups.teacher"),
            t("groups.assistant"),
            t("subjects.students"),
            t("subjects.schedule"),
            t("common.status")
          ]}
          loading={false}
          isEmpty={subject.groups.length === 0}
          emptyTitle={t("subjects.noGroups")}
        >
          {subject.groups.map((g) => (
            <tr key={g.id} className="border-b border-black/5 align-top dark:border-white/5">
              <td className="p-3 text-xs">
                {g.stage.name} › {g.grade.name}
              </td>
              <td className="p-3 font-medium">
                <Link href={`/dashboard/academic/groups/${g.id}`} className="hover:underline">
                  {g.name}
                </Link>
              </td>
              <td className="p-3">{g.teacher?.fullName ?? "—"}</td>
              <td className="p-3">{g.assistant?.fullName ?? "—"}</td>
              <td className="p-3">
                {g.studentCount} / {g.capacity}
                <span className="block text-xs text-black/50 dark:text-white/50">
                  {g.remaining} {t("groups.capacity")}
                </span>
              </td>
              <td className="p-3 text-xs">
                {g.schedules.length === 0
                  ? "—"
                  : g.schedules.map((s) => (
                      <p key={s.id}>
                        {s.dayOfWeek} {formatTime(s.startMinutes)}–{formatTime(s.endMinutes)}
                      </p>
                    ))}
              </td>
              <td className="p-3">
                <Badge tone={g.isActive ? "success" : "neutral"}>{g.isActive ? t("common.active") : t("common.archived")}</Badge>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("subjects.activity")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label={t("subjects.exams")} value={subject.activity.exams} />
          <StatCard label={t("subjects.sessions")} value={subject.activity.sessions} />
          <StatCard label={t("subjects.completedSessions")} value={subject.activity.completedSessions} />
          <StatCard label={t("subjects.attendanceRecords")} value={subject.activity.attendanceRecords} />
          <StatCard label={t("subjects.recitations")} value={subject.activity.recitations} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("subjects.recentExams")}</h2>
        <DataTable
          columns={[t("exams.title"), t("nav.groups"), "Date", t("common.status"), t("subjects.students")]}
          loading={false}
          isEmpty={subject.recentExams.length === 0}
          emptyTitle={t("subjects.noExams")}
        >
          {subject.recentExams.map((e) => (
            <tr key={e.id} className="border-b border-black/5 dark:border-white/5">
              <td className="p-3 font-medium">
                <Link href={`/dashboard/performance/exams/${e.id}`} className="hover:underline">
                  {e.name}
                </Link>
              </td>
              <td className="p-3">{e.group.name}</td>
              <td className="p-3">{formatDate(e.date)}</td>
              <td className="p-3">
                <Badge tone={e.isPublished ? "success" : "neutral"}>{e.isPublished ? t("exams.published") : t("exams.draft")}</Badge>
              </td>
              <td className="p-3">{e._count.results}</td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}
