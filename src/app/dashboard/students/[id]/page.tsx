"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatDateTime, formatMoneyClient, useApi } from "@/lib/client";
import { Badge, ErrorNotice, PageHeader, StatCard } from "@/components/ui";

interface ProfileData {
  student: {
    id: string;
    studentCode: string;
    qrCode: string;
    fullName: string;
    photoUrl: string | null;
    gender: string;
    dateOfBirth: string | null;
    phone: string | null;
    address: string | null;
    school: string | null;
    status: string;
    enrollmentDate: string;
    notes: string | null;
    emergencyContact: string | null;
    branch: { id: string; name: string };
    stage: { id: string; name: string } | null;
    grade: { id: string; name: string } | null;
    group: { id: string; name: string; capacity: number; teacher: { fullName: string } | null } | null;
  };
  parents: { relationship: string; isPrimary: boolean; id: string; fullName: string; phone: string; whatsappNumber: string | null }[];
  attendance: {
    summary: { present: number; absent: number; late: number; makeUp: number; percentage: number };
    recent: {
      id: string;
      type: string;
      recordedAt: string;
      session: { id: string; date: string; group: { name: string } };
      originGroupId: string | null;
      makeUpReason: string | null;
    }[];
  };
  academics: {
    statistics: unknown;
    exams: {
      examId: string;
      name: string;
      subject: string;
      date: string;
      score: number | null;
      maxScore: number;
      percentage: number | null;
      isPublished: boolean;
      isAbsent: boolean;
    }[];
    recitations: { id: string; date: string; content: string; status: string; score: number | null; maxScore: number }[];
    assignments: { id: string; title: string; dueDate: string; status: string; grade: number | null; maxScore: number }[];
  };
  finance?: {
    outstanding: number;
    subscriptions: {
      id: string;
      period: string;
      amount: number;
      discount: number;
      paidAmount: number;
      remaining: number;
      status: string;
      dueDate: string;
    }[];
    payments: {
      id: string;
      receiptNumber: string;
      amount: number;
      method: string;
      status: string;
      paidAt: string;
      invoice: { id: string; invoiceNumber: string } | null;
    }[];
  };
  analytics: { flags: { key: string; message: string; severity: string }[] } | Record<string, unknown>;
  timeline: { at: string; kind: string; label: string }[];
}

const TABS = [
  "overview",
  "attendance",
  "sessions",
  "payments",
  "exams",
  "recitation",
  "performance",
  "academic",
  "parents",
  "activity"
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL_KEYS: Record<Tab, Parameters<ReturnType<typeof useI18n>["t"]>[0]> = {
  overview: "student.tab.overview",
  attendance: "student.tab.attendance",
  sessions: "student.tab.sessions",
  payments: "student.tab.payments",
  exams: "student.tab.exams",
  recitation: "student.tab.recitation",
  performance: "student.tab.performance",
  academic: "student.tab.academic",
  parents: "student.tab.parents",
  activity: "student.tab.activity"
};

export default function StudentProfilePage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { data, loading, error } = useApi<ProfileData>(`/api/students/${params.id}/profile`);
  const [tab, setTab] = useState<Tab>("overview");

  if (error) return <ErrorNotice message={error} />;
  if (loading || !data) {
    return <div className="h-40 w-full animate-pulse rounded-card bg-black/5 dark:bg-white/5" />;
  }

  const { student, parents, attendance, academics, finance, timeline } = data;
  const primaryParent = parents.find((p) => p.isPrimary) ?? parents[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-tecno-gold-dark dark:text-tecno-gold">
          ← {t("common.back")}
        </button>
        <div className="flex gap-2">
          <Link href={`/dashboard/students/${student.id}/card`} className="btn-secondary">
            {t("students.card")}
          </Link>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-4 p-6">
        {student.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={student.photoUrl} alt={student.fullName} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/5 text-2xl font-bold dark:bg-white/10">
            {student.fullName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{student.fullName}</h1>
          <p className="mt-0.5 text-sm text-black/60 dark:text-white/60">
            <span className="font-mono">{student.studentCode}</span> ·{" "}
            {[student.stage?.name, student.grade?.name, student.group?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Badge tone={student.status === "ACTIVE" ? "success" : "neutral"}>{student.status}</Badge>
      </div>

      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-black/10 dark:border-white/10">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${
              tab === key
                ? "border-b-2 border-tecno-gold text-tecno-gold-dark dark:text-tecno-gold"
                : "text-black/55 dark:text-white/55"
            }`}
          >
            {t(TAB_LABEL_KEYS[key])}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("student.tab.attendance")} value={`${attendance.summary.percentage}%`} tone="positive" />
            <StatCard label="Present / Absent" value={`${attendance.summary.present} / ${attendance.summary.absent}`} />
            <StatCard label="Late / Make-up" value={`${attendance.summary.late} / ${attendance.summary.makeUp}`} />
            {finance && <StatCard label="Outstanding" value={formatMoneyClient(finance.outstanding)} tone={finance.outstanding > 0 ? "warning" : "positive"} />}
          </div>
          <div className="card p-4 text-sm">
            <p>
              <span className="text-black/55 dark:text-white/55">{t("nav.stages")}:</span> {student.stage?.name ?? "—"}
            </p>
            <p>
              <span className="text-black/55 dark:text-white/55">{t("grades.title")}:</span> {student.grade?.name ?? "—"}
            </p>
            <p>
              <span className="text-black/55 dark:text-white/55">{t("nav.groups")}:</span> {student.group?.name ?? "—"}{" "}
              {student.group?.teacher && `(${student.group.teacher.fullName})`}
            </p>
            <p>
              <span className="text-black/55 dark:text-white/55">{t("common.branch")}:</span> {student.branch.name}
            </p>
          </div>
        </div>
      )}

      {tab === "attendance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Present" value={attendance.summary.present} tone="positive" />
            <StatCard label="Absent" value={attendance.summary.absent} tone="negative" />
            <StatCard label="Late" value={attendance.summary.late} tone="warning" />
            <StatCard label="Make-up" value={attendance.summary.makeUp} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
                <tr>
                  <th className="p-3 text-start">{t("common.date")}</th>
                  <th className="p-3 text-start">{t("nav.groups")}</th>
                  <th className="p-3 text-start">{t("common.status")}</th>
                  <th className="p-3 text-start">Time</th>
                  <th className="p-3 text-start">Note</th>
                </tr>
              </thead>
              <tbody>
                {attendance.recent.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-black/50 dark:text-white/50">
                      —
                    </td>
                  </tr>
                )}
                {attendance.recent.map((a) => (
                  <tr key={a.id} className="border-b border-black/5 dark:border-white/5">
                    <td className="p-3">{formatDate(a.session.date)}</td>
                    <td className="p-3">{a.session.group.name}</td>
                    <td className="p-3">
                      <Badge
                        tone={
                          a.type === "REGULAR" ? "success" : a.type === "LATE" ? "warning" : a.type === "ABSENT" ? "danger" : "brand"
                        }
                      >
                        {a.type}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">{formatDateTime(a.recordedAt)}</td>
                    <td className="p-3 text-xs text-black/55 dark:text-white/55">{a.makeUpReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "sessions" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
              <tr>
                <th className="p-3 text-start">{t("common.date")}</th>
                <th className="p-3 text-start">{t("nav.groups")}</th>
                <th className="p-3 text-start">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {attendance.recent.map((a) => (
                <tr key={a.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3">
                    <Link href={`/dashboard/academic/sessions/${a.session.id}`} className="hover:underline">
                      {formatDate(a.session.date)}
                    </Link>
                  </td>
                  <td className="p-3">{a.session.group.name}</td>
                  <td className="p-3">
                    <Badge tone={a.type === "ABSENT" ? "danger" : "neutral"}>{a.type}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payments" && (
        <div className="space-y-4">
          {!finance ? (
            <p className="text-sm text-black/50 dark:text-white/50">You do not have permission to view financial data.</p>
          ) : (
            <>
              <StatCard label="Outstanding" value={formatMoneyClient(finance.outstanding)} tone={finance.outstanding > 0 ? "warning" : "positive"} />
              <div>
                <h3 className="mb-2 text-sm font-semibold">Subscriptions</h3>
                <div className="card overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
                      <tr>
                        <th className="p-3 text-start">{t("payments.month")}</th>
                        <th className="p-3 text-start">{t("common.amount")}</th>
                        <th className="p-3 text-start">Paid</th>
                        <th className="p-3 text-start">Remaining</th>
                        <th className="p-3 text-start">{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance.subscriptions.map((s) => (
                        <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
                          <td className="p-3">{s.period}</td>
                          <td className="p-3">{formatMoneyClient(s.amount)}</td>
                          <td className="p-3">{formatMoneyClient(s.paidAmount)}</td>
                          <td className="p-3">{formatMoneyClient(s.remaining)}</td>
                          <td className="p-3">
                            <Badge tone={s.status === "PAID" ? "success" : "warning"}>{s.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("payments.title")}</h3>
                <div className="card overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
                      <tr>
                        <th className="p-3 text-start">Receipt</th>
                        <th className="p-3 text-start">{t("common.amount")}</th>
                        <th className="p-3 text-start">{t("common.date")}</th>
                        <th className="p-3 text-start">{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finance.payments.map((p) => (
                        <tr key={p.id} className="border-b border-black/5 dark:border-white/5">
                          <td className="p-3 font-mono text-xs">
                            <Link href={`/dashboard/finance/payments/${p.id}`} className="hover:underline">
                              {p.receiptNumber}
                            </Link>
                          </td>
                          <td className="p-3">{formatMoneyClient(p.amount)}</td>
                          <td className="p-3">{formatDateTime(p.paidAt)}</td>
                          <td className="p-3">
                            <Badge tone={p.status === "COMPLETED" ? "success" : "neutral"}>{p.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "exams" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
              <tr>
                <th className="p-3 text-start">{t("common.date")}</th>
                <th className="p-3 text-start">Exam</th>
                <th className="p-3 text-start">{t("common.subject")}</th>
                <th className="p-3 text-start">Score</th>
                <th className="p-3 text-start">%</th>
              </tr>
            </thead>
            <tbody>
              {academics.exams.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-black/50 dark:text-white/50">
                    —
                  </td>
                </tr>
              )}
              {academics.exams.map((e) => (
                <tr key={e.examId} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3">{formatDate(e.date)}</td>
                  <td className="p-3">{e.name}</td>
                  <td className="p-3">{e.subject}</td>
                  <td className="p-3">{e.isAbsent ? "Absent" : e.score === null ? "—" : `${e.score}/${e.maxScore}`}</td>
                  <td className="p-3">{e.percentage === null ? "—" : `${e.percentage}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "recitation" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
              <tr>
                <th className="p-3 text-start">{t("common.date")}</th>
                <th className="p-3 text-start">Content</th>
                <th className="p-3 text-start">Score</th>
                <th className="p-3 text-start">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {academics.recitations.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-black/50 dark:text-white/50">
                    —
                  </td>
                </tr>
              )}
              {academics.recitations.map((r) => (
                <tr key={r.id} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3">{formatDate(r.date)}</td>
                  <td className="p-3">{r.content}</td>
                  <td className="p-3">{r.score === null ? "—" : `${r.score}/${r.maxScore}`}</td>
                  <td className="p-3">
                    <Badge tone="neutral">{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "performance" && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Assignments</h3>
            <div className="card overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
                  <tr>
                    <th className="p-3 text-start">Title</th>
                    <th className="p-3 text-start">Due</th>
                    <th className="p-3 text-start">Grade</th>
                    <th className="p-3 text-start">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {academics.assignments.map((a) => (
                    <tr key={a.id} className="border-b border-black/5 dark:border-white/5">
                      <td className="p-3">{a.title}</td>
                      <td className="p-3">{formatDate(a.dueDate)}</td>
                      <td className="p-3">{a.grade === null ? "—" : `${a.grade}/${a.maxScore}`}</td>
                      <td className="p-3">
                        <Badge tone={a.status === "GRADED" ? "success" : "neutral"}>{a.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "academic" && (
        <div className="card space-y-2 p-4 text-sm">
          <p>
            <span className="text-black/55 dark:text-white/55">{t("nav.stages")}:</span> {student.stage?.name ?? "—"}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">{t("grades.title")}:</span> {student.grade?.name ?? "—"}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">{t("nav.groups")}:</span> {student.group?.name ?? "—"}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">Enrollment date:</span> {formatDate(student.enrollmentDate)}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">Gender:</span> {student.gender}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">Date of birth:</span>{" "}
            {student.dateOfBirth ? formatDate(student.dateOfBirth) : "—"}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">School:</span> {student.school ?? "—"}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">Address:</span> {student.address ?? "—"}
          </p>
          <p>
            <span className="text-black/55 dark:text-white/55">{t("common.notes")}:</span> {student.notes ?? "—"}
          </p>
        </div>
      )}

      {tab === "parents" && (
        <div className="card p-4">
          {parents.length === 0 ? (
            <p className="text-sm text-black/50 dark:text-white/50">{t("student.profile.noParents")}</p>
          ) : (
            <ul className="space-y-2">
              {parents.map((link) => (
                <li
                  key={link.id}
                  className="flex items-center justify-between rounded-lg border border-black/5 p-3 text-sm dark:border-white/10"
                >
                  <div>
                    <p className="font-medium">{link.fullName}</p>
                    <p className="text-black/50 dark:text-white/50">
                      {link.relationship} · {link.phone}
                    </p>
                  </div>
                  {link.isPrimary && (
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">Primary</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div className="card p-4">
          <ul className="space-y-3">
            {timeline.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">—</p>}
            {timeline.map((entry, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <Badge tone="neutral">{entry.kind}</Badge>
                <div>
                  <p>{entry.label}</p>
                  <p className="text-xs text-black/45 dark:text-white/45">{formatDateTime(entry.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
