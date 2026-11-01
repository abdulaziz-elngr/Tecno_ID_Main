"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDate, formatMoneyClient, qs, todayISO, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, DataTable, ErrorNotice, Field, Modal, PageHeader, Pager, StatCard, useToast } from "@/components/ui";
import { MonthYearPicker } from "@/components/MonthYearPicker";
import type { TreasurySummaryData } from "@/components/payments/TreasuryStrip";

const CATEGORIES = ["EQUIPMENT", "SUPPLIES", "MAINTENANCE", "CLEANING", "UTILITIES", "PRINTING", "TRANSPORT", "HOSPITALITY", "OTHER"] as const;
const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;

interface Deduction {
  id: string;
  referenceNumber: string;
  title: string;
  category: string;
  amount: number;
  spentAt: string;
  vendor: string | null;
  requestedBy: string | null;
  method: string;
  notes: string | null;
  status: "ACTIVE" | "VOIDED";
  recordedBy: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}
interface ListData {
  items: Deduction[];
  summary: TreasurySummaryData;
  canCreate: boolean;
  canVoid: boolean;
  pagination: { page: number; totalPages: number; total: number };
}

const emptyForm = () => ({ title: "", amount: "", category: "SUPPLIES", date: todayISO(), vendor: "", requestedBy: "", method: "CASH", notes: "" });

/** خصم مبلغ — money taken out of the treasury. Totals everywhere drop by it automatically. */
export default function DeductionsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [allTime, setAllTime] = useState(false);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Deduction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [y, m] = month.split("-").map(Number);
  const url = `/api/deductions${qs({ year: y, month: m, ...(allTime ? { year: undefined, month: undefined } : {}), category, status, q: q.trim() || undefined, page, pageSize: 20 })}`;
  const { data, loading, error, reload } = useApi<ListData>(url);

  const summary = data?.summary;
  const available = summary?.total.net ?? 0;
  const amountNum = Number(form.amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const tooMuch = validAmount && amountNum > available;
  const after = validAmount ? available - amountNum : available;

  const monthTitle = useMemo(() => (summary ? `${summary.month}/${summary.year}` : ""), [summary]);

  function openForm() {
    setForm(emptyForm());
    setFormError(null);
    setOpen(true);
  }

  async function save() {
    setFormError(null);
    if (form.title.trim().length < 2) return setFormError(t("tre.errTitle"));
    if (!validAmount) return setFormError(t("tre.errAmount"));
    if (tooMuch) return setFormError(t("tre.errBalance"));
    setBusy(true);
    try {
      await apiPost("/api/deductions", {
        title: form.title.trim(),
        amount: amountNum,
        category: form.category,
        // today → let the server stamp the real time; another day → noon of that day
        ...(form.date && form.date !== todayISO() ? { spentAt: new Date(`${form.date}T12:00:00`).toISOString() } : {}),
        vendor: form.vendor.trim() || undefined,
        requestedBy: form.requestedBy.trim() || undefined,
        method: form.method,
        notes: form.notes.trim() || undefined
      });
      toast.success(t("tre.saved"));
      setOpen(false);
      reload();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setFormError(code === "INSUFFICIENT_BALANCE" ? t("tre.errBalance") : e instanceof Error ? e.message : "Failed");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function doVoid(reason: string) {
    if (!voidTarget) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/api/deductions/${voidTarget.id}/void`, { reason });
      toast.success(t("tre.voided"));
      setVoidTarget(null);
      reload();
    } catch (e) {
      setVoidTarget(null);
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("tre.title")}
        description={t("tre.subtitle")}
        actions={
          data?.canCreate ? (
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={openForm}>
              {t("tre.new")}
            </button>
          ) : undefined
        }
      />

      <ErrorNotice message={error ?? actionError} />

      {summary && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={t("tre.totalBalance")}
              value={formatMoneyClient(summary.total.net)}
              hint={`${t("tre.income")} ${formatMoneyClient(summary.total.income)} − ${t("tre.deductions")} ${formatMoneyClient(summary.total.deductions)}`}
              tone={summary.total.net < 0 ? "negative" : "positive"}
            />
            <StatCard
              label={`${t("tre.monthIncome")} (${monthTitle})`}
              value={formatMoneyClient(summary.monthly.income)}
              hint={`${t("tre.tuition")} ${formatMoneyClient(summary.monthly.tuition)} · ${t("tre.books")} ${formatMoneyClient(summary.monthly.books)}`}
              tone="positive"
            />
            <StatCard label={t("tre.monthDeductions")} value={formatMoneyClient(summary.monthly.deductions)} tone={summary.monthly.deductions > 0 ? "warning" : "default"} />
            <StatCard label={t("tre.monthNet")} value={formatMoneyClient(summary.monthly.net)} tone={summary.monthly.net < 0 ? "negative" : "positive"} />
          </div>
          <p className="text-xs text-black/50 dark:text-white/50">{t("tre.linkedHint")}</p>
        </div>
      )}

      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t("pay.month")}>
          {(id) => (
            <MonthYearPicker
              id={id}
              value={month}
              onChange={(v) => {
                setMonth(v);
                setAllTime(false);
                setPage(1);
              }}
            />
          )}
        </Field>
        <Field label={t("tre.category")}>
          {(id) => (
            <select id={id} className="input" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">{t("tre.allCategories")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`tre.cat.${c}` as never)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("common.status")}>
          {(id) => (
            <select id={id} className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">{t("common.all")}</option>
              <option value="ACTIVE">{t("tre.st.ACTIVE")}</option>
              <option value="VOIDED">{t("tre.st.VOIDED")}</option>
            </select>
          )}
        </Field>
        <Field label={t("common.search")}>
          {(id) => <input id={id} className="input" value={q} placeholder={t("tre.searchPh")} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={allTime} onChange={(e) => { setAllTime(e.target.checked); setPage(1); }} />
          {t("tre.allTime")}
        </label>
      </div>

      <DataTable
        columns={[t("tre.colRef"), t("common.date"), t("tre.colTitle"), t("tre.category"), t("tre.colWho"), t("common.amount"), t("common.status"), t("common.actions")]}
        loading={loading}
        isEmpty={(data?.items.length ?? 0) === 0}
        emptyTitle={t("tre.empty")}
      >
        {data?.items.map((d) => (
          <tr key={d.id} className={`border-b border-black/5 align-top dark:border-white/5 ${d.status === "VOIDED" ? "opacity-60" : ""}`}>
            <td className="p-3 font-mono text-xs">{d.referenceNumber}</td>
            <td className="p-3 text-xs">{formatDate(d.spentAt)}</td>
            <td className="p-3">
              <p className={`font-medium ${d.status === "VOIDED" ? "line-through" : ""}`}>{d.title}</p>
              {d.vendor && <p className="text-xs text-black/50 dark:text-white/50">{t("tre.vendor")}: {d.vendor}</p>}
              {d.notes && <p className="text-xs text-black/50 dark:text-white/50">{d.notes}</p>}
              {d.status === "VOIDED" && d.voidReason && (
                <p className="text-xs text-red-600 dark:text-red-400">{t("tre.voidReason")}: {d.voidReason}</p>
              )}
            </td>
            <td className="p-3 text-xs">{t(`tre.cat.${d.category}` as never)}</td>
            <td className="p-3 text-xs">
              {d.requestedBy && <p>{t("tre.requestedBy")}: {d.requestedBy}</p>}
              <p className="text-black/50 dark:text-white/50">{d.recordedBy ?? "—"}</p>
            </td>
            <td className="p-3 font-semibold text-red-600 dark:text-red-400">− {formatMoneyClient(d.amount)}</td>
            <td className="p-3">
              <Badge tone={d.status === "ACTIVE" ? "warning" : "neutral"}>{t(`tre.st.${d.status}` as never)}</Badge>
            </td>
            <td className="p-3">
              {d.status === "ACTIVE" && data.canVoid && (
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setVoidTarget(d)}>
                  {t("tre.void")}
                </button>
              )}
            </td>
          </tr>
        ))}
      </DataTable>
      <Pager page={page} totalPages={data?.pagination.totalPages ?? 1} onChange={setPage} />

      <Modal
        open={open}
        title={t("tre.new")}
        onClose={() => !busy && setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button type="button" className="btn-primary" disabled={busy || tooMuch} onClick={() => void save()}>
              {busy ? t("common.loading") : t("tre.confirmDeduct")}
            </button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ErrorNotice message={formError} />
          <Field label={t("tre.colTitle")} required hint={t("tre.titleHint")}>
            {(id) => <input id={id} className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.amount")} required>
              {(id) => (
                <input id={id} className="input" inputMode="decimal" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              )}
            </Field>
            <Field label={t("tre.category")}>
              {(id) => (
                <select id={id} className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{t(`tre.cat.${c}` as never)}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("common.date")}>
              {(id) => <input id={id} className="input" type="date" max={todayISO()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}
            </Field>
            <Field label={t("pay.method")}>
              {(id) => (
                <select id={id} className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {METHODS.map((x) => (
                    <option key={x} value={x}>{t(`pay.method.${x}` as never)}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("tre.vendor")}>
              {(id) => <input id={id} className="input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />}
            </Field>
            <Field label={t("tre.requestedBy")}>
              {(id) => <input id={id} className="input" value={form.requestedBy} onChange={(e) => setForm({ ...form, requestedBy: e.target.value })} />}
            </Field>
          </div>
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input min-h-[70px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
          </Field>

          {/* Live effect on the treasury before the operator confirms. */}
          <div className={`rounded-lg border p-3 text-sm ${tooMuch ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"}`}>
            <div className="flex justify-between gap-3"><span>{t("tre.balanceNow")}</span><b>{formatMoneyClient(available)}</b></div>
            <div className="flex justify-between gap-3"><span>{t("tre.thisDeduction")}</span><b className="text-red-600 dark:text-red-400">− {formatMoneyClient(validAmount ? amountNum : 0)}</b></div>
            <hr className="my-1.5 border-black/10 dark:border-white/10" />
            <div className="flex justify-between gap-3"><span>{t("tre.balanceAfter")}</span><b className={after < 0 ? "text-red-600 dark:text-red-400" : ""}>{formatMoneyClient(after)}</b></div>
            {tooMuch && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{t("tre.errBalance")}</p>}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={voidTarget !== null}
        title={t("tre.voidTitle")}
        message={voidTarget ? `${voidTarget.referenceNumber} — ${voidTarget.title} (${formatMoneyClient(voidTarget.amount)}). ${t("tre.voidMsg")}` : ""}
        confirmLabel={t("tre.void")}
        requireReason
        busy={busy}
        onCancel={() => setVoidTarget(null)}
        onConfirm={(reason) => void doVoid(reason)}
      />
    </div>
  );
}
