"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { hasDictKey, useI18n } from "@/lib/i18n";
import { ApiError, apiGet, apiPatch, apiPost, formatDateTime, formatMoneyClient, qs, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Modal, PageHeader, Pager, StatCard, useToast } from "@/components/ui";
import {
  PaymentFilters,
  StatusBadge,
  currentFilters,
  fmtMoney,
  monthLabel,
  type Filters
} from "@/components/payments/shared";

interface Entry {
  year: number; month: number; key: string;
  amount: number; discount: number; paid: number; remaining: number;
  status: string; dueDate: string; virtual: boolean; refunded: boolean;
}
interface RosterRow {
  studentId: string; fullName: string; studentCode: string;
  groupName: string; gradeName: string; stageName: string;
  whatsappNumber: string | null;
  month: Entry;
  outstanding: { year: number; month: number; amount: number; remaining: number; status: string }[];
  lastPaidMonth: { year: number; month: number } | null;
}
interface Roster { paid: RosterRow[]; unpaid: RosterRow[]; env: { currency: string } }
interface Ledger {
  student: {
    id: string; fullName: string; studentCode: string; photoUrl: string | null;
    stage: { name: string }; grade: { name: string }; group: { name: string };
    parents: { name: string; relationship: string | null; phone: string | null; whatsappNumber: string | null }[];
  };
  currency: string; allowPartial: boolean;
  ledger: Entry[]; outstanding: Entry[]; nextEligible: Entry | null; totalDue: number;
  canRecord: boolean; canDiscount: boolean;
}
interface PaymentRow {
  id: string; receiptNumber: string;
  student: { id: string; fullName: string; studentCode: string };
  amount: number; refundedAmount: number; method: string; status: string; paidAt: string;
}

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;

function txTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "VOIDED") return "danger" as const;
  return "warning" as const;
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentsView />
    </Suspense>
  );
}

function PaymentsView() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"collect" | "transactions">("collect");
  return (
    <div className="space-y-5">
      <PageHeader title={t("pay.title")} />
      <div className="no-print flex gap-2" role="tablist">
        {(["collect", "transactions"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            type="button"
            onClick={() => setTab(k)}
            className={tab === k ? "btn-primary" : "btn-secondary"}
          >
            {t(`pay.tab.${k}` as never)}
          </button>
        ))}
      </div>
      {tab === "collect" ? <CollectTab locale={locale} /> : <TransactionsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collect: Month → Stage → Grade → Group → search/scan → pay
// ---------------------------------------------------------------------------
function CollectTab({ locale }: { locale: "ar" | "en" }) {
  const { t } = useI18n();
  const search0 = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => {
    const base = currentFilters();
    const y = Number(search0.get("year"));
    const m = Number(search0.get("month"));
    return y && m ? { ...base, year: y, month: m } : base;
  });
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [exact, setExact] = useState(false);
  const search = useSearchParams();
  const [selected, setSelected] = useState<string | null>(search.get("studentId"));
  const inputRef = useRef<HTMLInputElement>(null);

  const ready = Boolean(filters.groupId) || Boolean(submitted);
  const url = ready
    ? `/api/payment-records${qs({
        year: filters.year, month: filters.month,
        stageId: exact ? undefined : filters.stageId,
        gradeId: exact ? undefined : filters.gradeId,
        groupId: exact ? undefined : filters.groupId,
        q: submitted || undefined,
        exact: exact ? "1" : undefined
      })}`
    : null;
  const roster = useApi<Roster>(url);
  const rows = [...(roster.data?.unpaid ?? []), ...(roster.data?.paid ?? [])];

  // A barcode gun types the code + Enter: an exact code match ignores the filters
  // and opens the student immediately.
  async function runSearch(raw: string, fromScanner: boolean) {
    const text = raw.trim();
    setSubmitted(text);
    setExact(fromScanner);
    if (fromScanner && text) {
      try {
        const res = await apiGet<Roster>(
          `/api/payment-records${qs({ year: filters.year, month: filters.month, q: text, exact: "1" })}`
        );
        const hit = [...res.data.unpaid, ...res.data.paid];
        if (hit.length === 1) setSelected(hit[0]!.studentId);
        else if (hit.length === 0) setExact(false); // not a code: fall back to name search
      } catch {
        setExact(false);
      }
    }
  }

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <>
      <PaymentFilters value={filters} onChange={(f) => { setFilters(f); setSubmitted(""); setQ(""); setExact(false); }} />
      <form
        className="card flex flex-wrap gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter on a code-looking value is treated as a scan.
          void runSearch(q, /^[A-Za-z0-9-]{4,}$/.test(q.trim()));
        }}
      >
        <input ref={inputRef} className="input min-w-[220px] flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pay.search")} aria-label={t("pay.search")} />
        <button type="submit" className="btn-primary">{t("pay.searchBtn")}</button>
      </form>

      {!ready && <p className="text-sm text-black/60 dark:text-white/60">{t("pay.pickFilters")}</p>}
      <ErrorNotice message={roster.error} />

      {ready && (
        <DataTable
          columns={[t("pay.colStudent"), t("pay.colCode"), t("pay.colGroup"), t("pay.colAmount"), t("pay.colStatus"), t("pay.colLastPaid"), t("pay.colOutstanding"), t("pay.colAction")]}
          loading={roster.loading}
          isEmpty={rows.length === 0}
          emptyTitle={t("pay.noStudents")}
        >
          {rows.map((r) => (
            <tr key={r.studentId} className="border-b border-black/5 dark:border-white/5">
              <td className="p-3 font-medium">{r.fullName}</td>
              <td className="p-3 font-mono text-xs">{r.studentCode}</td>
              <td className="p-3">{r.groupName}</td>
              <td className="p-3">{fmtMoney(r.month.amount - r.month.discount, roster.data?.env.currency)}</td>
              <td className="p-3"><StatusBadge status={r.month.status} refunded={r.month.refunded} /></td>
              <td className="p-3">{r.lastPaidMonth ? monthLabel(r.lastPaidMonth, locale) : t("pay.none")}</td>
              <td className="p-3">{r.outstanding.length > 0 ? r.outstanding.map((o) => `${o.month}/${o.year}`).join("، ") : t("pay.none")}</td>
              <td className="p-3">
                <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => setSelected(r.studentId)}>
                  {t("pay.collect")}
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {selected && (
        <StudentPaymentModal
          studentId={selected}
          target={{ year: filters.year, month: filters.month }}
          locale={locale}
          onClose={() => { setSelected(null); roster.reload(); inputRef.current?.focus(); setQ(""); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Student payment screen
// ---------------------------------------------------------------------------
function StudentPaymentModal({
  studentId, target, locale, onClose
}: { studentId: string; target: { year: number; month: number }; locale: "ar" | "en"; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Ledger>(`/api/payments/ledger${qs({ studentId })}`);

  const [chosen, setChosen] = useState<{ year: number; month: number } | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("CASH");
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ paymentId: string; receiptNumber: string } | null>(null);
  const [me, setMe] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((b) => setMe(b?.fullName ?? "")).catch(() => {});
  }, []);

  // Choose the month once the ledger arrives: the requested month if it is the
  // next eligible one, otherwise the oldest unpaid month (+ a clear warning).
  useEffect(() => {
    if (!data || chosen) return;
    const next = data.nextEligible;
    if (!next) return;
    if (next.year === target.year && next.month === target.month) {
      setChosen({ year: next.year, month: next.month });
      return;
    }
    const req = data.ledger.find((e) => e.year === target.year && e.month === target.month);
    const requestedOpen = req && ["UNPAID", "PARTIAL", "OVERDUE"].includes(req.status);
    if (requestedOpen) {
      setWarn(t("pay.prevUnpaid") + " " + t("pay.mustPayFirst").replace("{month}", monthLabel(next, locale)));
    }
    setChosen({ year: next.year, month: next.month });
  }, [data, chosen, target.year, target.month, locale, t]);

  const entry = data && chosen ? data.ledger.find((e) => e.year === chosen.year && e.month === chosen.month) : null;
  const canPayChosen = Boolean(data && entry && data.nextEligible && entry.key === data.nextEligible.key);
  const discountNum = Number(discount) || 0;
  const due = entry ? Math.max(0, entry.amount - Math.max(entry.discount, discountNum) - entry.paid) : 0;
  const payNum = amount === "" ? due : Number(amount);
  const remainingAfter = Math.max(0, Math.round((due - payNum) * 100) / 100);

  function pickMonth(e: Entry) {
    if (data?.nextEligible && e.key !== data.nextEligible.key && ["UNPAID", "PARTIAL", "OVERDUE"].includes(e.status)) {
      setWarn(t("pay.prevUnpaid") + " " + t("pay.mustPayFirst").replace("{month}", monthLabel(data.nextEligible, locale)));
      setChosen({ year: data.nextEligible.year, month: data.nextEligible.month });
    } else {
      setWarn(null);
      setChosen({ year: e.year, month: e.month });
    }
    setAmount(""); setDiscount("");
  }

  async function confirm() {
    if (!chosen) return;
    setBusy(true); setFormError(null);
    try {
      const res = await apiPost<{ paymentId: string; receiptNumber: string }>("/api/payments/month", {
        studentId, periodYear: chosen.year, periodMonth: chosen.month, method,
        amount: amount === "" ? undefined : Number(amount),
        discount: discountNum > 0 ? discountNum : undefined,
        notes: notes.trim() || undefined
      });
      setConfirmOpen(false);
      setDone(res);
      toast.success(t("pay.recorded"));
      reload();
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof ApiError && err.code === "OUT_OF_ORDER") {
        const oldest = (err.details as { oldest?: Entry } | undefined)?.oldest;
        if (oldest) {
          setWarn(t("pay.prevUnpaid") + " " + t("pay.mustPayFirst").replace("{month}", monthLabel(oldest, locale)));
          setChosen({ year: oldest.year, month: oldest.month });
        }
        reload();
      }
      const code = (err as { code?: string }).code;
      setFormError(code && hasDictKey(`err.${code}`) ? t(`err.${code}` as never) : err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  const s = data?.student;
  const parent = s?.parents[0];

  return (
    <Modal open title={s ? s.fullName : t("pay.title")} onClose={onClose}>
      <ErrorNotice message={error} />
      {loading && <p className="text-sm">…</p>}
      {data && s && (
        <div className="space-y-4">
          <section className="flex gap-3">
            {s.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.photoUrl} alt={s.fullName} className="h-20 w-20 rounded-lg object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-black/5 text-2xl dark:bg-white/10">{s.fullName.slice(0, 1)}</div>
            )}
            <dl className="min-w-0 flex-1 space-y-0.5 text-sm">
              <div className="font-bold">{s.fullName} <span className="font-mono text-xs font-normal">{s.studentCode}</span></div>
              <div>{s.stage.name} · {s.grade.name} · {s.group.name}</div>
              {parent && (
                <div className="text-black/60 dark:text-white/60">
                  {t("pay.parent")}: {parent.name} · {parent.phone ?? parent.whatsappNumber ?? "—"}
                </div>
              )}
            </dl>
          </section>

          {warn && (
            <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              ⚠️ {warn}
            </div>
          )}

          <section>
            <h3 className="mb-1 text-sm font-semibold">{t("pay.history")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-start text-xs text-black/50 dark:text-white/50">
                  <tr><th className="p-1 text-start">{t("pay.month")}</th><th className="p-1 text-start">{t("pay.histAmount")}</th><th className="p-1 text-start">{t("pay.colStatus")}</th></tr>
                </thead>
                <tbody>
                  {[...data.ledger].reverse().map((e) => {
                    const open = ["UNPAID", "PARTIAL", "OVERDUE"].includes(e.status);
                    return (
                      <tr key={e.key} className={`border-t border-black/5 dark:border-white/5 ${chosen?.year === e.year && chosen?.month === e.month ? "bg-tecno-gold/10" : ""} ${e.status === "OVERDUE" ? "font-medium" : ""}`}>
                        <td className="p-1">
                          {open && data.canRecord ? (
                            <button type="button" className="hover:underline" onClick={() => pickMonth(e)}>{monthLabel(e, locale)}</button>
                          ) : monthLabel(e, locale)}
                        </td>
                        <td className="p-1">{fmtMoney(e.amount - e.discount, data.currency)}</td>
                        <td className="p-1"><StatusBadge status={e.status} refunded={e.refunded} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {data.outstanding.length > 1 && (
            <p className="text-sm text-red-700 dark:text-red-300">
              {t("pay.colOutstanding")}: {data.outstanding.map((o) => monthLabel(o, locale)).join("، ")} — {fmtMoney(data.totalDue, data.currency)}
            </p>
          )}

          {done ? (
            <div className="space-y-2 rounded-lg bg-emerald-500/10 p-3 text-sm">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">{t("pay.recorded")} · {done.receiptNumber}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => window.open(`/dashboard/finance/payments/${done.paymentId}?print=1`, "_blank")}>{t("pay.printReceipt")}</button>
                <button type="button" className="btn-secondary" onClick={onClose}>{t("pay.close")}</button>
              </div>
            </div>
          ) : !data.nextEligible ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">{t("pay.allPaid")}</p>
          ) : (
            data.canRecord && entry && canPayChosen && (
              <section className="space-y-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
                <h3 className="text-sm font-semibold">{t("pay.nextEligible")}: {monthLabel(entry, locale)}</h3>
                <ErrorNotice message={formError} />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-black/60 dark:text-white/60">{t("pay.colAmount")}</span><div className="font-semibold">{fmtMoney(entry.amount, data.currency)}</div></div>
                  <div><span className="text-black/60 dark:text-white/60">{t("pay.total")}</span><div className="font-semibold">{fmtMoney(due, data.currency)}</div></div>
                  {data.canDiscount && entry.paid === 0 && (
                    <label className="text-sm">{t("pay.discount")}
                      <input className="input mt-1" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                    </label>
                  )}
                  <label className="text-sm">{t("pay.amountPaid")}
                    <input className="input mt-1" type="number" min={0.01} step="0.01" max={due} placeholder={String(due)} value={amount} disabled={!data.allowPartial} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <div><span className="text-black/60 dark:text-white/60">{t("pay.remainingAfter")}</span><div className="font-semibold">{fmtMoney(remainingAfter, data.currency)}</div></div>
                  <label className="text-sm">{t("pay.method")}
                    <select className="input mt-1" value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
                      {METHODS.map((m) => <option key={m} value={m}>{t(`pay.method.${m}` as never)}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">{t("pay.notes")}
                  <input className="input mt-1" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <button type="button" className="btn-primary w-full" disabled={busy || payNum <= 0 || payNum > due} onClick={() => setConfirmOpen(true)}>
                  {t("pay.recordPayment")}
                </button>
              </section>
            )
          )}

          <ConfirmDialog
            open={confirmOpen}
            title={t("pay.confirmTitle")}
            message={
              entry
                ? [
                    `${t("common.student")}: ${s.fullName}`,
                    `${t("pay.month")}: ${monthLabel(entry, locale)}`,
                    `${t("common.amount")}: ${fmtMoney(payNum, data.currency)}`,
                    `${t("pay.method")}: ${t(`pay.method.${method}` as never)}`,
                    `${t("pay.date")}: ${new Date().toLocaleString()}`,
                    me ? `${t("pay.recordedBy")}: ${me}` : ""
                  ].filter(Boolean).join("\n")
                : ""
            }
            confirmLabel={t("pay.confirmBtn")}
            busy={busy}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => void confirm()}
          />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Transactions: list, reprint, refund
// ---------------------------------------------------------------------------
function TransactionsTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<{
    payments: PaymentRow[]; totals: { collected: number }; pagination: { page: number; totalPages: number };
  }>(`/api/payments${qs({ page, pageSize: 25 })}`);

  const [target, setTarget] = useState<PaymentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reprint = useCallback(async (p: PaymentRow) => {
    try {
      await apiPost(`/api/payments/${p.id}/reprint`);
      window.open(`/dashboard/finance/payments/${p.id}?print=1&copy=1`, "_blank");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }, []);

  async function doRefund(reason: string) {
    if (!target) return;
    setBusy(true); setErr(null);
    try {
      await apiPatch(`/api/payments/${target.id}`, {
        action: "REFUND", reason, amount: Math.round((target.amount - target.refundedAmount) * 100) / 100
      });
      toast.success(t("pay.refunded"));
      setTarget(null);
      reload();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setTarget(null);
      setErr(code && hasDictKey(`err.${code}`) ? t(`err.${code}` as never) : e instanceof Error ? e.message : "Failed");
      reload();
    } finally { setBusy(false); }
  }

  return (
    <>
      <ErrorNotice message={error ?? err} />
      {data && <StatCard label={t("pay.collected")} value={formatMoneyClient(data.totals.collected)} tone="positive" />}
      <DataTable
        columns={[t("pay.txReceipt"), t("common.student"), t("common.amount"), t("pay.method"), t("common.date"), t("pay.txStatus"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.payments.length ?? 0) === 0}
        emptyTitle={t("payments.empty")}
      >
        {data?.payments.map((p) => (
          <tr key={p.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-mono text-xs"><Link href={`/dashboard/finance/payments/${p.id}`} className="hover:underline">{p.receiptNumber}</Link></td>
            <td className="p-3 font-medium">{p.student.fullName}<span className="ms-2 font-mono text-xs text-black/45 dark:text-white/45">{p.student.studentCode}</span></td>
            <td className="p-3">{formatMoneyClient(p.amount)}{p.refundedAmount > 0 && <span className="ms-1 text-xs text-amber-600 dark:text-amber-400">(-{formatMoneyClient(p.refundedAmount)})</span>}</td>
            <td className="p-3">{p.method}</td>
            <td className="p-3">{formatDateTime(p.paidAt)}</td>
            <td className="p-3"><Badge tone={txTone(p.status)}>{p.status}</Badge></td>
            <td className="p-3">
              <div className="flex gap-3">
                <button type="button" className="text-xs hover:underline" onClick={() => void reprint(p)}>{t("pay.reprint")}</button>
                {(p.status === "COMPLETED" || p.status === "PARTIALLY_REFUNDED") && (
                  <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => setTarget(p)}>{t("pay.refund")}</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={data?.pagination.page ?? 1} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />
      <ConfirmDialog
        open={Boolean(target)}
        title={t("pay.refundTitle")}
        message={`${t("pay.refundMsg")}\n${target?.receiptNumber ?? ""}`}
        confirmLabel={t("pay.refund")}
        requireReason
        busy={busy}
        onCancel={() => setTarget(null)}
        onConfirm={(reason) => void doRefund(reason)}
      />
    </>
  );
}

