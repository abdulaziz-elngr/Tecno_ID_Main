"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui";

/**
 * Public parent portal (/parent) — read-only.
 * The guardian types the student's ID and sees
 * attendance, payments, recitation, exams, homework and more.
 * Arabic-only on purpose: this page is for parents, not staff.
 */

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

interface PortalData {
  center: { name: string; phone: string | null; currency: string };
  student: {
    studentCode: string;
    fullName: string;
    status: string;
    school: string | null;
    enrollmentDate: string;
    branch: string;
    stage: string;
    grade: string;
    group: string;
    teacher: string | null;
  };
  upcomingSessions: { id: string; date: string; startMinutes: number; endMinutes: number; status: string }[];
  attendance: {
    summary: { present: number; absent: number; late: number; excused: number; percentage: number };
    records: { date: string; startMinutes: number; group: string; type: string }[];
  };
  finance: {
    exempt: boolean;
    totalDue: number;
    outstandingMonths: number;
    months: {
      key: string;
      year: number;
      month: number;
      amount: number;
      discount: number;
      paid: number;
      remaining: number;
      status: string;
      exempt: boolean;
    }[];
    payments: {
      id: string;
      receiptNumber: string;
      amount: number;
      refundedAmount: number;
      method: string;
      status: string;
      paidAt: string;
    }[];
  };
  recitations: { id: string; date: string; content: string; status: string; score: number | null; maxScore: number }[];
  exams: {
    average: number | null;
    items: {
      id: string;
      name: string;
      subject: string;
      date: string;
      score: number | null;
      maxScore: number;
      percentage: number | null;
      isAbsent: boolean;
    }[];
  };
  assignments: {
    id: string;
    title: string;
    dueDate: string;
    status: string;
    grade: number | null;
    maxScore: number;
    feedback: string | null;
  }[];
  recognitions: { id: string; reason: string; recognizedAt: string }[];
}

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const ATTENDANCE: Record<string, [string, Tone]> = {
  REGULAR: ["حضر", "success"],
  LATE: ["حضر متأخر", "warning"],
  MAKE_UP: ["حضر تعويض", "brand"],
  EXCUSED: ["غياب بعذر", "neutral"],
  ABSENT: ["غائب", "danger"]
};
const LEDGER: Record<string, [string, Tone]> = {
  PAID: ["مدفوع", "success"],
  PARTIAL: ["مدفوع جزئيًا", "warning"],
  UNPAID: ["غير مدفوع", "warning"],
  OVERDUE: ["متأخر", "danger"],
  WAIVED: ["معفى", "neutral"]
};
const PAY_STATUS: Record<string, [string, Tone]> = {
  COMPLETED: ["تم", "success"],
  VOIDED: ["ملغي", "danger"],
  REFUNDED: ["مسترد", "neutral"],
  PARTIALLY_REFUNDED: ["مسترد جزئيًا", "warning"]
};
const METHOD: Record<string, string> = { CASH: "نقدي", BANK_TRANSFER: "تحويل بنكي", CARD: "بطاقة", OTHER: "أخرى" };
const RECITATION: Record<string, [string, Tone]> = {
  COMPLETED: ["سمّع كامل", "success"],
  PARTIAL: ["سمّع جزئيًا", "warning"],
  NOT_COMPLETED: ["لم يسمّع", "danger"],
  ABSENT: ["غائب", "neutral"]
};
const SUBMISSION: Record<string, [string, Tone]> = {
  PENDING: ["لم يُسلَّم بعد", "neutral"],
  SUBMITTED: ["تم التسليم", "success"],
  LATE: ["سُلِّم متأخرًا", "warning"],
  GRADED: ["تم التصحيح", "brand"],
  MISSING: ["لم يُسلَّم", "danger"]
};

const TABS = [
  { id: "overview", label: "الملخص" },
  { id: "attendance", label: "الحضور" },
  { id: "payments", label: "المدفوعات" },
  { id: "recitation", label: "التسميع" },
  { id: "exams", label: "الامتحانات" },
  { id: "homework", label: "الواجبات" }
] as const;
type TabId = (typeof TABS)[number]["id"];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" });
const fmtTime = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "م" : "ص";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
};
const num = (n: number) => n.toLocaleString("ar-EG", { maximumFractionDigits: 2 });


/** Small inline SVG icons (no emoji). */
type IconProps = { className?: string };
const svgProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true
};

function SunIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}
function MoonIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
function MonitorIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function StarIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
    </svg>
  );
}
function MessageIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** Light / dark / system switch. First visit to the portal starts in light mode. */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (!localStorage.getItem("parent-portal-theme-init")) {
        localStorage.setItem("parent-portal-theme-init", "1");
        setTheme("light");
      }
    } catch {
      /* storage blocked: keep the current theme */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) return <div className="h-8 w-[104px]" />;

  const options = [
    { id: "light", label: "فاتح", Icon: SunIcon },
    { id: "dark", label: "داكن", Icon: MoonIcon },
    { id: "system", label: "تلقائي", Icon: MonitorIcon }
  ];
  return (
    <div className="flex items-center rounded-lg border border-black/10 p-0.5 dark:border-white/15" role="group" aria-label="المظهر">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setTheme(o.id)}
          aria-label={o.label}
          title={o.label}
          className={`rounded-md p-1.5 transition-colors ${
            theme === o.id ? "bg-tecno-gold text-tecno-ink" : "opacity-60 hover:opacity-100"
          }`}
        >
          <o.Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string }) {
  const [label, tone] = map[value] ?? [value, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" | "success" }) {
  const color = tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="card p-3 text-center sm:p-4">
      <p className="text-xs text-black/60 dark:text-white/60">{label}</p>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${color}`}>{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="card p-6 text-center text-sm text-black/60 dark:text-white/60">{text}</p>;
}

function Row({ children }: { children: ReactNode }) {
  return <li className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">{children}</li>;
}

export default function ParentPortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<TabId>("overview");

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/parent-portal/data", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()).data);
        return true;
      }
    } catch {
      /* fall through to the login form */
    }
    setData(null);
    return false;
  }, []);

  useEffect(() => {
    load().finally(() => setChecking(false));
  }, [load]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/parent-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentCode: code })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "حصلت مشكلة. حاول مرة تانية.");
        return;
      }
      setTab("overview");
      if (!(await load())) setError("حصلت مشكلة في تحميل البيانات. حاول مرة تانية.");
    } catch {
      setError("حصلت مشكلة في الاتصال. حاول مرة تانية.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/parent-portal/logout", { method: "POST" }).catch(() => undefined);
    setData(null);
    setCode("");
  }

  if (checking) {
    return <div dir="rtl" className="flex min-h-screen items-center justify-center text-sm text-black/60 dark:text-white/60">جاري التحميل…</div>;
  }

  // ---------------------------------------------------------------- login
  if (!data) {
    return (
      <div dir="rtl" className="flex min-h-screen flex-col bg-surface-light-muted dark:bg-surface-dark">
        <div className="flex justify-start p-3 sm:p-4">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center p-4 pt-0">
        <div className="card w-full max-w-sm p-5 sm:p-8">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Image src="/logo.png" alt="Tecno" width={140} height={70} priority />
            <h1 className="text-lg font-bold">بوابة ولي الأمر</h1>
            <p className="text-sm text-black/60 dark:text-white/60">اكتب رقم الـ ID الخاص بابنك لمتابعة حضوره ومستواه ومدفوعاته.</p>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate>
            <div>
              <label htmlFor="code" className="mb-1 block text-sm font-medium">رقم الـ ID</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="off"
                required
                className="input"
                placeholder="مثال: 270001"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
            )}
            <button type="submit" disabled={loading} className="btn-primary">{loading ? "جاري الدخول…" : "عرض بيانات ابني"}</button>
          </form>
        </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ dashboard
  const { student, attendance, finance, exams } = data;
  const cur = data.center.currency;

  return (
    <div dir="rtl" className="min-h-screen bg-surface-light-muted dark:bg-surface-dark">
      <header className="border-b border-black/5 bg-white dark:border-white/10 dark:bg-surface-dark-muted">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Tecno" width={72} height={36} />
            <div>
              <h1 className="text-base font-bold sm:text-lg">{student.fullName}</h1>
              <p className="text-xs text-black/60 dark:text-white/60">
                ID: {student.studentCode} · {student.grade} · {student.group}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button onClick={handleLogout} className="rounded-lg border border-black/10 px-3 py-1.5 text-sm dark:border-white/15">خروج</button>
          </div>
        </div>
        <nav className="no-scrollbar mx-auto flex max-w-4xl gap-1 overflow-x-auto px-3 pb-2 sm:px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === t.id ? "bg-tecno-gold text-tecno-ink" : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-3 sm:p-4">
        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="نسبة الحضور" value={`${num(attendance.summary.percentage)}٪`} tone={attendance.summary.percentage >= 75 ? "success" : "danger"} />
              <Stat label="مرات الغياب" value={num(attendance.summary.absent)} />
              <Stat label="متوسط الامتحانات" value={exams.average === null ? "—" : `${num(exams.average)}٪`} />
              <Stat
                label="المتبقي من المصروفات"
                value={finance.exempt ? "معفى" : `${num(finance.totalDue)} ${cur}`}
                tone={!finance.exempt && finance.totalDue > 0 ? "danger" : "success"}
              />
            </div>

            <section className="card p-4">
              <h2 className="mb-3 font-semibold">بيانات الطالب</h2>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {[
                  ["المرحلة", student.stage],
                  ["الصف", student.grade],
                  ["المجموعة", student.group],
                  ["المدرس", student.teacher],
                  ["المدرسة", student.school],
                  ["الفرع", student.branch],
                  ["تاريخ الالتحاق", fmtDate(student.enrollmentDate)]
                ].map(([k, v]) =>
                  v ? (
                    <div key={k} className="flex justify-between gap-2 border-b border-black/5 pb-1 dark:border-white/10">
                      <dt className="text-black/60 dark:text-white/60">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ) : null
                )}
              </dl>
            </section>

            <section className="card p-4">
              <h2 className="mb-3 font-semibold">الحصص القادمة</h2>
              {data.upcomingSessions.length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">لا توجد حصص مجدولة حاليًا.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {data.upcomingSessions.map((s) => (
                    <li key={s.id} className="flex justify-between border-b border-black/5 pb-1 dark:border-white/10">
                      <span>{fmtDate(s.date)}</span>
                      <span className="text-black/60 dark:text-white/60">{fmtTime(s.startMinutes)} – {fmtTime(s.endMinutes)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.recognitions.length > 0 && (
              <section className="card p-4">
                <h2 className="mb-3 flex items-center gap-1.5 font-semibold">
                  <StarIcon className="h-4 w-4 text-tecno-gold-dark dark:text-tecno-gold" />
                  تكريمات وإنجازات
                </h2>
                <ul className="flex flex-col gap-2 text-sm">
                  {data.recognitions.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2 border-b border-black/5 pb-1 dark:border-white/10">
                      <span>{r.reason}</span>
                      <span className="whitespace-nowrap text-black/60 dark:text-white/60">{fmtDate(r.recognizedAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {tab === "attendance" && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="حضور" value={num(attendance.summary.present)} tone="success" />
              <Stat label="غياب" value={num(attendance.summary.absent)} tone={attendance.summary.absent ? "danger" : undefined} />
              <Stat label="تأخير" value={num(attendance.summary.late)} />
              <Stat label="نسبة الحضور" value={`${num(attendance.summary.percentage)}٪`} />
            </div>
            {attendance.records.length === 0 ? (
              <Empty text="لا توجد سجلات حضور بعد." />
            ) : (
              <ul className="flex flex-col gap-2">
                {attendance.records.map((a, i) => (
                  <Row key={i}>
                    <div>
                      <p className="font-medium">{fmtDate(a.date)}</p>
                      <p className="text-xs text-black/60 dark:text-white/60">{a.group} · {fmtTime(a.startMinutes)}</p>
                    </div>
                    <StatusBadge map={ATTENDANCE} value={a.type} />
                  </Row>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "payments" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="المتبقي" value={finance.exempt ? "معفى" : `${num(finance.totalDue)} ${cur}`} tone={!finance.exempt && finance.totalDue > 0 ? "danger" : "success"} />
              <Stat label="شهور متأخرة" value={num(finance.outstandingMonths)} />
            </div>

            <h2 className="font-semibold">المصروفات الشهرية</h2>
            {finance.months.length === 0 ? (
              <Empty text="لا توجد مصروفات مسجلة." />
            ) : (
              <ul className="flex flex-col gap-2">
                {finance.months.map((m) => (
                  <Row key={m.key}>
                    <div>
                      <p className="font-medium">{MONTHS[m.month - 1]} {m.year}</p>
                      <p className="text-xs text-black/60 dark:text-white/60">
                        المطلوب {num(Math.max(0, m.amount - m.discount))} · المدفوع {num(m.paid)} · المتبقي {num(m.remaining)} {cur}
                      </p>
                    </div>
                    <StatusBadge map={LEDGER} value={m.status} />
                  </Row>
                ))}
              </ul>
            )}

            <h2 className="font-semibold">سجل الدفعات</h2>
            {finance.payments.length === 0 ? (
              <Empty text="لا توجد دفعات مسجلة." />
            ) : (
              <ul className="flex flex-col gap-2">
                {finance.payments.map((p) => (
                  <Row key={p.id}>
                    <div>
                      <p className="font-medium">{num(p.amount)} {cur} · {METHOD[p.method] ?? p.method}</p>
                      <p className="text-xs text-black/60 dark:text-white/60">إيصال {p.receiptNumber} · {fmtDateTime(p.paidAt)}</p>
                    </div>
                    <StatusBadge map={PAY_STATUS} value={p.status} />
                  </Row>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "recitation" &&
          (data.recitations.length === 0 ? (
            <Empty text="لا توجد نتائج تسميع بعد." />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.recitations.map((r) => (
                <Row key={r.id}>
                  <div>
                    <p className="font-medium">{r.content}</p>
                    <p className="text-xs text-black/60 dark:text-white/60">
                      {fmtDate(r.date)}
                      {r.score !== null && ` · الدرجة ${num(r.score)} من ${num(r.maxScore)}`}
                    </p>
                  </div>
                  <StatusBadge map={RECITATION} value={r.status} />
                </Row>
              ))}
            </ul>
          ))}

        {tab === "exams" && (
          <>
            <Stat label="متوسط الامتحانات" value={exams.average === null ? "—" : `${num(exams.average)}٪`} />
            {exams.items.length === 0 ? (
              <Empty text="لا توجد نتائج امتحانات منشورة بعد." />
            ) : (
              <ul className="flex flex-col gap-2">
                {exams.items.map((e) => (
                  <Row key={e.id}>
                    <div>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-black/60 dark:text-white/60">{e.subject} · {fmtDate(e.date)}</p>
                    </div>
                    {e.isAbsent ? (
                      <Badge tone="danger">غائب</Badge>
                    ) : e.score === null ? (
                      <Badge>لم تُرصد الدرجة</Badge>
                    ) : (
                      <Badge tone={(e.percentage ?? 0) >= 50 ? "success" : "danger"}>
                        {num(e.score)} / {num(e.maxScore)} ({num(e.percentage ?? 0)}٪)
                      </Badge>
                    )}
                  </Row>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === "homework" &&
          (data.assignments.length === 0 ? (
            <Empty text="لا توجد واجبات بعد." />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.assignments.map((a) => (
                <Row key={a.id}>
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-black/60 dark:text-white/60">
                      موعد التسليم {fmtDate(a.dueDate)}
                      {a.grade !== null && ` · الدرجة ${num(a.grade)} من ${num(a.maxScore)}`}
                    </p>
                    {a.feedback && (
                      <p className="mt-1 flex items-start gap-1 text-xs">
                        <MessageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{a.feedback}</span>
                      </p>
                    )}
                  </div>
                  <StatusBadge map={SUBMISSION} value={a.status} />
                </Row>
              ))}
            </ul>
          ))}

        <footer className="py-4 text-center text-xs text-black/50 dark:text-white/50">
          {data.center.name && <p>{data.center.name}</p>}
          {data.center.phone && <p>للاستفسار: {data.center.phone}</p>}
        </footer>
      </main>
    </div>
  );
}
