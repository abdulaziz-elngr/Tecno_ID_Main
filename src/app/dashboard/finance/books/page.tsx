"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDate, formatMoneyClient, qs, useApi } from "@/lib/client";
import { EmptyState, ErrorNotice, Field, Modal, PageHeader, StatCard, Badge, useToast } from "@/components/ui";
import { GroupCascade, KindBadge, ProgressBar, type CascadeValue } from "@/components/books/shared";

interface Reservation {
  id: string;
  title: string;
  kind: string;
  status: string;
  stage: string;
  grade: string;
  group: string;
  bookPrice: number;
  reservationFee: number;
  dueDate: string | null;
  students: number;
  paid: number;
  reserved: number;
  unpaid: number;
  collected: number;
  expected: number;
  remaining: number;
}
interface ListData {
  reservations: Reservation[];
  canCreate: boolean;
}

const emptyForm = { title: "", kind: "BOOK", bookPrice: "", reservationFee: "", dueDate: "", notes: "" };

/** حجوزات الكتب والمذكرات — one card per reservation campaign. */
export default function BooksPage() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<CascadeValue>({ stageId: "", gradeId: "", groupId: "" });
  const [status, setStatus] = useState("OPEN");
  const [q, setQ] = useState("");
  const { data, loading, error } = useApi<ListData>(`/api/books${qs({ ...filter, status, q: q.trim() || undefined })}`);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CascadeValue>({ stageId: "", gradeId: "", groupId: "" });
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const list = data?.reservations ?? [];
  const totals = list.reduce((a, r) => ({ collected: a.collected + r.collected, remaining: a.remaining + r.remaining }), { collected: 0, remaining: 0 });

  const price = Number(form.bookPrice);
  const fee = form.reservationFee === "" ? 0 : Number(form.reservationFee);

  async function create() {
    setFormError(null);
    if (form.title.trim().length < 2) return setFormError(t("bk.errTitle"));
    if (!target.groupId) return setFormError(t("bk.errGroup"));
    if (!Number.isFinite(price) || price <= 0) return setFormError(t("bk.errPrice"));
    if (!Number.isFinite(fee) || fee < 0 || fee > price) return setFormError(t("bk.errFee"));
    setBusy(true);
    try {
      const res = await apiPost<{ id: string; students: number }>("/api/books", {
        title: form.title.trim(),
        kind: form.kind,
        groupId: target.groupId,
        bookPrice: price,
        reservationFee: fee,
        dueDate: form.dueDate || undefined,
        notes: form.notes.trim() || undefined
      });
      toast.success(t("bk.created"));
      setOpen(false);
      router.push(`/dashboard/finance/books/${res.id}`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setFormError(code === "DUPLICATE_RESERVATION" ? t("bk.errDuplicate") : e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("bk.title")}
        description={t("bk.subtitle")}
        actions={
          data?.canCreate ? (
            <button
              type="button"
              className="btn-primary w-full sm:w-auto"
              onClick={() => {
                setForm(emptyForm);
                setTarget({ ...filter });
                setFormError(null);
                setOpen(true);
              }}
            >
              {t("bk.new")}
            </button>
          ) : undefined
        }
      />
      <ErrorNotice message={error} />

      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <GroupCascade value={filter} onChange={setFilter} />
        <Field label={t("common.status")}>
          {(id) => (
            <select id={id} className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="OPEN">{t("bk.res.OPEN")}</option>
              <option value="CLOSED">{t("bk.res.CLOSED")}</option>
              <option value="CANCELLED">{t("bk.res.CANCELLED")}</option>
            </select>
          )}
        </Field>
        <Field label={t("common.search")}>
          {(id) => <input id={id} className="input" value={q} placeholder={t("bk.searchPh")} onChange={(e) => setQ(e.target.value)} />}
        </Field>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={t("bk.reservationsCount")} value={list.length} />
          <StatCard label={t("bk.collected")} value={formatMoneyClient(totals.collected)} tone="positive" />
          <StatCard label={t("bk.remaining")} value={formatMoneyClient(totals.remaining)} tone={totals.remaining > 0 ? "warning" : "default"} />
        </div>
      )}

      {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      {!loading && list.length === 0 && <div className="card"><EmptyState title={t("bk.empty")} description={t("bk.emptyHint")} /></div>}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {list.map((r) => (
          <Link key={r.id} href={`/dashboard/finance/books/${r.id}`} className="card block space-y-3 p-4 transition hover:border-tecno-gold/60 hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="break-words text-base font-bold">{r.title}</h2>
                <p className="text-xs text-black/55 dark:text-white/55">{r.grade} · {r.group}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <KindBadge kind={r.kind} />
                {r.status !== "OPEN" && <Badge tone="neutral">{t(`bk.res.${r.status}` as never)}</Badge>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-black/50 dark:text-white/50">{t("bk.price")}: </span><b>{formatMoneyClient(r.bookPrice)}</b></div>
              <div><span className="text-black/50 dark:text-white/50">{t("bk.fee")}: </span><b>{formatMoneyClient(r.reservationFee)}</b></div>
            </div>
            <div className="space-y-1">
              <ProgressBar value={r.collected} max={r.expected} />
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-emerald-700 dark:text-emerald-300">{t("bk.collected")}: {formatMoneyClient(r.collected)}</span>
                <span className={r.remaining > 0 ? "text-amber-700 dark:text-amber-300" : ""}>{t("bk.remaining")}: {formatMoneyClient(r.remaining)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="success">{t("bk.st.PAID")} {r.paid}</Badge>
              <Badge tone="brand">{t("bk.st.RESERVED")} {r.reserved}</Badge>
              <Badge tone="danger">{t("bk.notPaidShort")} {r.unpaid}</Badge>
              <span className="text-xs text-black/50 dark:text-white/50">{t("bk.studentsCount")}: {r.students}</span>
            </div>
            {r.dueDate && <p className="text-xs text-black/50 dark:text-white/50">{t("bk.dueDate")}: {formatDate(r.dueDate)}</p>}
          </Link>
        ))}
      </div>

      <Modal
        open={open}
        title={t("bk.new")}
        onClose={() => !busy && setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void create()}>{busy ? t("common.loading") : t("bk.create")}</button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <ErrorNotice message={formError} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label={t("bk.bookName")} required>
                {(id) => <input id={id} className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
              </Field>
            </div>
            <Field label={t("bk.type")}>
              {(id) => (
                <select id={id} className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="BOOK">{t("bk.kind.BOOK")}</option>
                  <option value="NOTES">{t("bk.kind.NOTES")}</option>
                </select>
              )}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <GroupCascade value={target} onChange={setTarget} groupRequired allLabels={false} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("bk.price")} required>
              {(id) => <input id={id} className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.bookPrice} onChange={(e) => setForm({ ...form, bookPrice: e.target.value })} />}
            </Field>
            <Field label={t("bk.fee")} hint={t("bk.feeHint")}>
              {(id) => <input id={id} className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.reservationFee} onChange={(e) => setForm({ ...form, reservationFee: e.target.value })} />}
            </Field>
            <Field label={t("bk.dueDate")}>
              {(id) => <input id={id} className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
            </Field>
          </div>
          <Field label={t("common.notes")}>
            {(id) => <textarea id={id} className="input min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
          </Field>
          <p className="text-xs text-black/55 dark:text-white/55">{t("bk.createHint")}</p>
        </form>
      </Modal>
    </div>
  );
}
