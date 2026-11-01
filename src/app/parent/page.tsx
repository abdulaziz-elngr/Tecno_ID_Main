"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
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
  books: {
    totalDue: number;
    items: {
      itemId: string;
      title: string;
      kind: string;
      reservationStatus: string;
      payable: number;
      reservationFee: number;
      paid: number;
      remaining: number;
      status: string;
      dueDate: string | null;
      deliveredAt: string | null;
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
const BOOK_STATUS: Record<string, [string, Tone]> = {
  UNPAID: ["لم يدفع", "danger"],
  PARTIAL: ["دفع جزء (الحجز لم يكتمل)", "warning"],
  RESERVED: ["تم الحجز", "brand"],
  PAID: ["مدفوع بالكامل", "success"]
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
  { id: "books", label: "الكتب والمذكرات" },
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
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-surface-light-muted p-4 dark:bg-surface-dark">
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
                placeholder="مثال: 260001"
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
          <button onClick={handleLogout} className="rounded-lg border border-black/10 px-3 py-1.5 text-sm dark:border-white/15">خروج</button>
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
        {/* Unpaid book / notes reservations are shown on EVERY tab so the guardian cannot miss them. */}
        {data.books.items
          .filter((b) => b.reservationStatus === "OPEN" && b.remaining > 0)
          .map((b) => (
            <div
              key={b.itemId}
              role="alert"
              className={`rounded-xl border p-3 text-sm sm:p-4 ${
                b.status === "UNPAID" || b.status === "PARTIAL"
                  ? "border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
              }`}
            >
              <p className="font-semibold">
                {b.status === "UNPAID"
                  ? `لم يتم دفع حجز ${b.kind === "NOTES" ? "مذكرة" : "كتاب"} «${b.title}»`
                  : b.status === "PARTIAL"
                    ? `لم يكتمل حجز ${b.kind === "NOTES" ? "مذكرة" : "كتاب"} «${b.title}»`
                    : `متبقي مبلغ من ${b.kind === "NOTES" ? "مذكرة" : "كتاب"} «${b.title}»`}
              </p>
              <p className="mt-1 text-xs opacity-90">
                {b.status === "UNPAID" && b.reservationFee > 0 ? `مبلغ الحجز ${num(b.reservationFee)} ${cur} · ` : ""}
                السعر {num(b.payable)} · المدفوع {num(b.paid)} · المتبقي {num(b.remaining)} {cur}
                {b.dueDate ? ` · آخر موعد ${fmtDate(b.dueDate)}` : ""}
              </p>
              <button type="button" onClick={() => setTab("books")} className="mt-2 text-xs font-medium underline">التفاصيل</button>
            </div>
          ))}

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
                <h2 className="mb-3 font-semibold">تكريمات وإنجازات ⭐</h2>
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

        {tab === "books" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="المتبقي من الكتب والمذكرات" value={`${num(data.books.totalDue)} ${cur}`} tone={data.books.totalDue > 0 ? "danger" : "success"} />
              <Stat label="عدد الحجوزات" value={num(data.books.items.length)} />
            </div>
            {data.books.items.length === 0 ? (
              <Empty text="لا توجد حجوزات كتب أو مذكرات." />
            ) : (
              <ul className="flex flex-col gap-2">
                {data.books.items.map((b) => (
                  <Row key={b.itemId}>
                    <div>
                      <p className="font-medium">{b.kind === "NOTES" ? "مذكرة" : "كتاب"}: {b.title}</p>
                      <p className="text-xs text-black/60 dark:text-white/60">
                        السعر {num(b.payable)} · المدفوع {num(b.paid)} · المتبقي {num(b.remaining)} {cur}
                        {b.dueDate ? ` · آخر موعد ${fmtDate(b.dueDate)}` : ""}
                      </p>
                      {b.deliveredAt && <p className="text-xs text-emerald-700 dark:text-emerald-300">✓ تم استلام الكتاب · {fmtDate(b.deliveredAt)}</p>}
                    </div>
                    <StatusBadge map={BOOK_STATUS} value={b.status} />
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
                    {a.feedback && <p className="mt-1 text-xs">💬 {a.feedback}</p>}
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
