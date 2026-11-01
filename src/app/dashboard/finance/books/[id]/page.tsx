"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiPatch, apiPost, formatDate, formatDateTime, formatMoneyClient, useApi } from "@/lib/client";
import { Badge, ConfirmDialog, ErrorNotice, Field, Modal, PageHeader, StatCard, useToast } from "@/components/ui";
import { BookStatusBadge, KindBadge, ProgressBar, printBookReceipt } from "@/components/books/shared";
import { WhatsAppButton } from "@/components/payments/shared";

interface PaymentRow {
  id: string;
  receiptNumber: string;
  amount: number;
  method: string;
  status: string;
  paidAt: string;
  notes: string | null;
  voidReason: string | null;
}
interface ItemRow {
  itemId: string;
  price: number;
  discount: number;
  payable: number;
  paid: number;
  remaining: number;
  status: "UNPAID" | "PARTIAL" | "RESERVED" | "PAID";
  deliveredAt: string | null;
  student: { id: string; fullName: string; studentCode: string; inGroup: boolean; parentName: string | null; whatsapp: string | null };
  payments: PaymentRow[];
}
interface Detail {
  reservation: {
    id: string;
    title: string;
    kind: string;
    status: "OPEN" | "CLOSED" | "CANCELLED";
    stage: string;
    grade: string;
    group: string;
    bookPrice: number;
    reservationFee: number;
    dueDate: string | null;
    notes: string | null;
  };
  totals: { students: number; PAID: number; RESERVED: number; PARTIAL: number; UNPAID: number; collected: number; expected: number; remaining: number };
  items: ItemRow[];
  can: { update: boolean; collect: boolean; void: boolean };
}

type Tab = "ALL" | "PAID" | "RESERVED" | "UNPAID";
const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"] as const;

/** One reservation: every student of the group, who paid / who did not, collect, discount, deliver. */
export default function BookReservationPage() {
  const { t } = useI18n();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const { data, loading, error, reload } = useApi<Detail>(`/api/books/${params.id}`);
  const [tab, setTab] = useState<Tab>("ALL");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // collect modal
  const [collect, setCollect] = useState<ItemRow | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [note, setNote] = useState("");
  const [printAfter, setPrintAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  // discount / edit / void
  const [discountFor, setDiscountFor] = useState<ItemRow | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [edit, setEdit] = useState({ title: "", bookPrice: "", reservationFee: "", dueDate: "", notes: "" });
  const [voidPay, setVoidPay] = useState<PaymentRow | null>(null);
  const [statusAsk, setStatusAsk] = useState<"CLOSED" | "OPEN" | "CANCELLED" | null>(null);

  const r = data?.reservation;
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((it) => {
      if (tab === "PAID" && it.status !== "PAID") return false;
      if (tab === "RESERVED" && it.status !== "RESERVED") return false;
      if (tab === "UNPAID" && !(it.status === "UNPAID" || it.status === "PARTIAL")) return false;
      if (!needle) return true;
      return it.student.fullName.toLowerCase().includes(needle) || it.student.studentCode.toLowerCase().includes(needle);
    });
  }, [data, tab, q]);

  const unpaidCount = (data?.totals.UNPAID ?? 0) + (data?.totals.PARTIAL ?? 0);
  const open = r?.status === "OPEN";

  function openCollect(it: ItemRow) {
    setCollect(it);
    setAmount(String(it.remaining));
    setMethod("CASH");
    setNote("");
    setCollectError(null);
  }

  const amountNum = Number(amount);
  const amountOk = collect !== null && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= collect.remaining + 0.001;

  async function submitCollect() {
    if (!collect || !amountOk) return setCollectError(t("bk.errCollectAmount"));
    setBusy(true);
    setCollectError(null);
    try {
      const res = await apiPost<{ paymentId: string; receiptNumber: string }>(`/api/books/${params.id}/items/${collect.itemId}/payments`, {
        amount: amountNum,
        method,
        notes: note.trim() || undefined
      });
      toast.success(`${t("bk.collectedOk")} · ${res.receiptNumber}`);
      setCollect(null);
      if (printAfter) printBookReceipt(res.paymentId);
      reload();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setCollectError(code === "OVERPAYMENT" ? t("bk.errCollectAmount") : e instanceof Error ? e.message : "Failed");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function toggleDelivered(it: ItemRow) {
    setActionError(null);
    try {
      await apiPatch(`/api/books/${params.id}/items/${it.itemId}`, { delivered: !it.deliveredAt });
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function saveDiscount() {
    if (!discountFor) return;
    const v = discountValue === "" ? 0 : Number(discountValue);
    if (!Number.isFinite(v) || v < 0 || v > discountFor.price) return setCollectError(t("bk.errDiscount"));
    setBusy(true);
    try {
      await apiPatch(`/api/books/${params.id}/items/${discountFor.itemId}`, { discount: v });
      toast.success(t("common.saved"));
      setDiscountFor(null);
      reload();
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!r) return;
    const price = Number(edit.bookPrice);
    const fee = edit.reservationFee === "" ? 0 : Number(edit.reservationFee);
    if (edit.title.trim().length < 2 || !Number.isFinite(price) || price <= 0 || fee < 0 || fee > price) return setCollectError(t("bk.errFee"));
    setBusy(true);
    try {
      await apiPatch(`/api/books/${r.id}`, {
        title: edit.title.trim(),
        bookPrice: price,
        reservationFee: fee,
        dueDate: edit.dueDate || null,
        notes: edit.notes.trim() || null
      });
      toast.success(t("common.saved"));
      setEditOpen(false);
      reload();
    } catch (e) {
      setCollectError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function doVoidPayment(reason: string) {
    if (!voidPay) return;
    setBusy(true);
    try {
      await apiPost(`/api/books/payments/${voidPay.id}/void`, { reason });
      toast.success(t("bk.paymentVoided"));
      setVoidPay(null);
      reload();
    } catch (e) {
      setVoidPay(null);
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function doChangeStatus() {
    if (!r || !statusAsk) return;
    setBusy(true);
    try {
      await apiPatch(`/api/books/${r.id}`, { status: statusAsk });
      setStatusAsk(null);
      reload();
    } catch (e) {
      setStatusAsk(null);
      const code = (e as { code?: string }).code;
      setActionError(code === "HAS_PAYMENTS" ? t("bk.errHasPayments") : e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function reminder(it: ItemRow) {
    return `${t("bk.waHello")} ${it.student.parentName ?? ""}،\n${t("bk.waBody")} «${r?.title}» ${t("bk.waStudent")} ${it.student.fullName}.\n${t("bk.remaining")}: ${formatMoneyClient(it.remaining)}`;
  }

  return (
    <div className="space-y-5">
      <Link href="/dashboard/finance/books" className="no-print inline-block text-sm text-tecno-gold-dark hover:underline dark:text-tecno-gold">
        → {t("bk.back")}
      </Link>
      <ErrorNotice message={error ?? actionError} />
      {loading && !data && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}

      {r && data && (
        <>
          <PageHeader
            title={r.title}
            description={`${r.stage} · ${r.grade} · ${r.group}`}
            actions={
              <>
                <KindBadge kind={r.kind} />
                {r.status !== "OPEN" && <Badge tone="neutral">{t(`bk.res.${r.status}` as never)}</Badge>}
                {data.can.update && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setEdit({ title: r.title, bookPrice: String(r.bookPrice), reservationFee: String(r.reservationFee), dueDate: r.dueDate ? r.dueDate.slice(0, 10) : "", notes: r.notes ?? "" });
                        setCollectError(null);
                        setEditOpen(true);
                      }}
                    >
                      {t("common.edit")}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setStatusAsk(open ? "CLOSED" : "OPEN")}>
                      {open ? t("bk.close") : t("bk.reopen")}
                    </button>
                  </>
                )}
              </>
            }
          />

          <div className="card grid gap-3 p-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-black/50 dark:text-white/50">{t("bk.price")}</p><p className="font-bold">{formatMoneyClient(r.bookPrice)}</p></div>
            <div><p className="text-xs text-black/50 dark:text-white/50">{t("bk.fee")}</p><p className="font-bold">{formatMoneyClient(r.reservationFee)}</p></div>
            <div><p className="text-xs text-black/50 dark:text-white/50">{t("bk.dueDate")}</p><p className="font-bold">{r.dueDate ? formatDate(r.dueDate) : "—"}</p></div>
            <div>
              <p className="text-xs text-black/50 dark:text-white/50">{t("bk.progress")}</p>
              <div className="mt-2"><ProgressBar value={data.totals.collected} max={data.totals.expected} /></div>
            </div>
            {r.notes && <p className="text-xs text-black/60 sm:col-span-4 dark:text-white/60">{r.notes}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatCard label={t("bk.studentsCount")} value={data.totals.students} />
            <StatCard label={t("bk.st.PAID")} value={data.totals.PAID} tone="positive" />
            <StatCard label={t("bk.st.RESERVED")} value={data.totals.RESERVED} />
            <StatCard label={t("bk.notPaidShort")} value={unpaidCount} tone={unpaidCount > 0 ? "negative" : "default"} />
            <StatCard label={t("bk.collected")} value={formatMoneyClient(data.totals.collected)} tone="positive" />
            <StatCard label={t("bk.remaining")} value={formatMoneyClient(data.totals.remaining)} tone={data.totals.remaining > 0 ? "warning" : "default"} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["ALL", "PAID", "RESERVED", "UNPAID"] as Tab[]).map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setTab(x)}
                className={`rounded-full border px-3 py-1.5 text-sm ${tab === x ? "border-tecno-gold bg-tecno-gold/15 font-semibold" : "border-black/10 dark:border-white/10"}`}
              >
                {t(`bk.tab.${x}` as never)}
              </button>
            ))}
            <input className="input ms-auto w-full sm:w-64" value={q} placeholder={t("bk.searchStudent")} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[820px] text-start text-sm">
              <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
                <tr>
                  {[t("pay.colStudent"), t("bk.price"), t("bk.paid"), t("bk.remaining"), t("common.status"), t("bk.delivery"), t("common.actions")].map((c) => (
                    <th key={c} className="p-3 text-start font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-black/50 dark:text-white/50">{t("bk.noStudents")}</td></tr>
                )}
                {items.map((it) => (
                  <Fragment key={it.itemId}>
                    <tr className="border-b border-black/5 align-top dark:border-white/5">
                      <td className="p-3">
                        <p className="font-medium">{it.student.fullName}</p>
                        <p className="font-mono text-xs text-black/45 dark:text-white/45">{it.student.studentCode}</p>
                        {!it.student.inGroup && <Badge tone="warning">{t("bk.leftGroup")}</Badge>}
                      </td>
                      <td className="p-3">
                        {formatMoneyClient(it.payable)}
                        {it.discount > 0 && <p className="text-xs text-emerald-700 dark:text-emerald-300">{t("bk.discount")} {formatMoneyClient(it.discount)}</p>}
                      </td>
                      <td className="p-3 text-emerald-700 dark:text-emerald-300">{formatMoneyClient(it.paid)}</td>
                      <td className={`p-3 font-semibold ${it.remaining > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{formatMoneyClient(it.remaining)}</td>
                      <td className="p-3"><BookStatusBadge status={it.status} /></td>
                      <td className="p-3">
                        {it.deliveredAt ? (
                          <button type="button" className="text-xs text-emerald-700 underline dark:text-emerald-300" disabled={!data.can.collect && !data.can.update} onClick={() => void toggleDelivered(it)}>
                            ✓ {t("bk.delivered")} · {formatDate(it.deliveredAt)}
                          </button>
                        ) : (
                          (data.can.collect || data.can.update) && it.paid > 0 ? (
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void toggleDelivered(it)}>{t("bk.markDelivered")}</button>
                          ) : <span className="text-xs text-black/40 dark:text-white/40">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {data.can.collect && open && it.remaining > 0 && (
                            <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => openCollect(it)}>{t("bk.collect")}</button>
                          )}
                          {data.can.update && open && (
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => { setDiscountFor(it); setDiscountValue(String(it.discount || "")); setCollectError(null); }}>{t("bk.discount")}</button>
                          )}
                          {it.payments.length > 0 && (
                            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setExpanded(expanded === it.itemId ? null : it.itemId)}>
                              {t("bk.history")} ({it.payments.length})
                            </button>
                          )}
                          {it.remaining > 0 && <WhatsAppButton phone={it.student.whatsapp} label={t("pay.whatsapp")} message={reminder(it)} />}
                        </div>
                      </td>
                    </tr>
                    {expanded === it.itemId && (
                      <tr className="border-b border-black/5 bg-black/[0.02] dark:border-white/5 dark:bg-white/[0.03]">
                        <td colSpan={7} className="p-3">
                          <ul className="space-y-1.5 text-xs">
                            {it.payments.map((p) => (
                              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                                <span className={p.status === "VOIDED" ? "line-through opacity-60" : ""}>
                                  <span className="font-mono">{p.receiptNumber}</span> · {formatMoneyClient(p.amount)} · {t(`pay.method.${p.method}` as never)} · {formatDateTime(p.paidAt)}
                                  {p.notes ? ` · ${p.notes}` : ""}
                                </span>
                                <span className="flex items-center gap-2">
                                  {p.status === "VOIDED" ? (
                                    <Badge tone="neutral">{t("bk.voided")}{p.voidReason ? `: ${p.voidReason}` : ""}</Badge>
                                  ) : (
                                    <>
                                      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => printBookReceipt(p.id)}>{t("common.print")}</button>
                                      {data.can.void && (
                                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setVoidPay(p)}>{t("bk.voidPayment")}</button>
                                      )}
                                    </>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Collect */}
      <Modal
        open={collect !== null}
        title={t("bk.collect")}
        onClose={() => !busy && setCollect(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setCollect(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn-primary" disabled={busy || !amountOk} onClick={() => void submitCollect()}>{busy ? t("common.loading") : t("bk.confirmCollect")}</button>
          </>
        }
      >
        {collect && r && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitCollect(); }}>
            <ErrorNotice message={collectError} />
            <div className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
              <p className="font-semibold">{collect.student.fullName} <span className="font-mono text-xs text-black/50 dark:text-white/50">{collect.student.studentCode}</span></p>
              <p className="text-xs text-black/60 dark:text-white/60">{r.title}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <div><p className="text-black/50 dark:text-white/50">{t("bk.price")}</p><b>{formatMoneyClient(collect.payable)}</b></div>
                <div><p className="text-black/50 dark:text-white/50">{t("bk.paid")}</p><b>{formatMoneyClient(collect.paid)}</b></div>
                <div><p className="text-black/50 dark:text-white/50">{t("bk.remaining")}</p><b className="text-amber-700 dark:text-amber-300">{formatMoneyClient(collect.remaining)}</b></div>
              </div>
            </div>
            <Field label={t("common.amount")} required>
              {(id) => (
                <input id={id} className="input" type="number" inputMode="decimal" min="0" step="0.01" autoFocus onFocus={(e) => e.currentTarget.select()} value={amount} onChange={(e) => setAmount(e.target.value)} />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              {collect.paid < r.reservationFee && r.reservationFee > 0 && (
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setAmount(String(Math.min(collect.remaining, r.reservationFee - collect.paid)))}>
                  {t("bk.payFee")} ({formatMoneyClient(Math.min(collect.remaining, r.reservationFee - collect.paid))})
                </button>
              )}
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setAmount(String(collect.remaining))}>
                {t("bk.payAll")} ({formatMoneyClient(collect.remaining)})
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("pay.method")}>
                {(id) => (
                  <select id={id} className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map((x) => <option key={x} value={x}>{t(`pay.method.${x}` as never)}</option>)}
                  </select>
                )}
              </Field>
              <Field label={t("common.notes")}>
                {(id) => <input id={id} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} />
              {t("bk.printAfter")}
            </label>
          </form>
        )}
      </Modal>

      {/* Discount */}
      <Modal
        open={discountFor !== null}
        title={t("bk.discount")}
        onClose={() => !busy && setDiscountFor(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDiscountFor(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveDiscount()}>{t("common.save")}</button>
          </>
        }
      >
        {discountFor && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void saveDiscount(); }}>
            <ErrorNotice message={collectError} />
            <p className="text-sm font-medium">{discountFor.student.fullName}</p>
            <Field label={t("bk.discountAmount")} hint={`${t("bk.price")}: ${formatMoneyClient(discountFor.price)}`}>
              {(id) => <input id={id} className="input" type="number" min="0" step="0.01" autoFocus value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />}
            </Field>
          </form>
        )}
      </Modal>

      {/* Edit reservation */}
      <Modal
        open={editOpen}
        title={t("common.edit")}
        onClose={() => !busy && setEditOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditOpen(false)}>{t("common.cancel")}</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveEdit()}>{t("common.save")}</button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
          <ErrorNotice message={collectError} />
          <Field label={t("bk.bookName")} required>
            {(id) => <input id={id} className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("bk.price")} required>
              {(id) => <input id={id} className="input" type="number" min="0" step="0.01" value={edit.bookPrice} onChange={(e) => setEdit({ ...edit, bookPrice: e.target.value })} />}
            </Field>
            <Field label={t("bk.fee")}>
              {(id) => <input id={id} className="input" type="number" min="0" step="0.01" value={edit.reservationFee} onChange={(e) => setEdit({ ...edit, reservationFee: e.target.value })} />}
            </Field>
            <Field label={t("bk.dueDate")}>
              {(id) => <input id={id} className="input" type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} />}
            </Field>
          </div>
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input min-h-[60px]" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />}
          </Field>
          <p className="text-xs text-black/55 dark:text-white/55">{t("bk.editHint")}</p>
        </form>
      </Modal>

      <ConfirmDialog
        open={voidPay !== null}
        title={t("bk.voidPayment")}
        message={voidPay ? `${voidPay.receiptNumber} — ${formatMoneyClient(voidPay.amount)}. ${t("bk.voidPaymentMsg")}` : ""}
        confirmLabel={t("bk.voidPayment")}
        requireReason
        busy={busy}
        onCancel={() => setVoidPay(null)}
        onConfirm={(reason) => void doVoidPayment(reason)}
      />
      <ConfirmDialog
        open={statusAsk !== null}
        title={statusAsk === "OPEN" ? t("bk.reopen") : t("bk.close")}
        message={statusAsk === "OPEN" ? t("bk.reopenMsg") : t("bk.closeMsg")}
        confirmLabel={statusAsk === "OPEN" ? t("bk.reopen") : t("bk.close")}
        busy={busy}
        onCancel={() => setStatusAsk(null)}
        onConfirm={() => void doChangeStatus()}
      />
    </div>
  );
}
