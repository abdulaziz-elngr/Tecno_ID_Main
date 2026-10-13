"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPost, currentMonth, formatDate, formatMoneyClient, qs, useApi } from "@/lib/client";
import { Badge, DataTable, ErrorNotice, Field, Modal, PageHeader, Pager, StatCard, useToast } from "@/components/ui";

interface FeeHistory {
  id: string; amount: number; effectiveFrom: string; createdAt: string; isActive: boolean; changedBy: string | null;
}
interface GradeRow {
  id: string; name: string; studentCount: number;
  current: FeeHistory | null; history: FeeHistory[];
}
interface Config {
  canManage: boolean;
  stages: { id: string; name: string; grades: GradeRow[] }[];
}
interface SubscriptionRow {
  id: string;
  student: { id: string; fullName: string; studentCode: string };
  periodYear: number; periodMonth: number;
  amount: number; discount: number; paidAmount: number; remaining: number;
  dueDate: string; status: string;
}

function toneFor(status: string) {
  if (status === "PAID") return "success" as const;
  if (status === "PARTIAL") return "warning" as const;
  if (status === "OVERDUE") return "danger" as const;
  if (status === "WAIVED") return "brand" as const;
  return "neutral" as const;
}

/** Subscriptions: Academic Stage → Grade → Monthly price (history kept), plus the generated student charges. */
export default function SubscriptionsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const cfg = useApi<Config>("/api/grade-fees");
  const [stageId, setStageId] = useState("");
  const stage = cfg.data?.stages.find((s) => s.id === stageId) ?? cfg.data?.stages[0];

  // price editor
  const [editing, setEditing] = useState<GradeRow | null>(null);
  const [price, setPrice] = useState("");
  const [effective, setEffective] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<GradeRow | null>(null);

  // generate for month
  const [month, setMonth] = useState(currentMonth());
  const [genGrade, setGenGrade] = useState<GradeRow | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // charges list
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [year, monthNum] = month.split("-").map(Number);
  const list = useApi<{
    subscriptions: SubscriptionRow[];
    totals: { billed: number; collected: number; outstanding: number };
    pagination: { page: number; totalPages: number };
  }>(`/api/subscriptions${qs({ periodYear: year, periodMonth: monthNum, status: status || undefined, page, pageSize: 25 })}`);

  function openEdit(g: GradeRow) {
    setEditing(g);
    setPrice(g.current ? String(g.current.amount) : "");
    setEffective("");
    setSaveError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true); setSaveError(null);
    try {
      await apiPost("/api/grade-fees", {
        gradeId: editing.id,
        amount: Number(price),
        effectiveFrom: effective || undefined
      });
      toast.success(t("common.saved"));
      setEditing(null);
      cfg.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  async function apply() {
    if (!genGrade) return;
    setGenBusy(true); setGenError(null);
    try {
      const r = await apiPost<{ created: number; skipped: number; noPrice: number }>("/api/subscriptions/generate", {
        periodYear: year, periodMonth: monthNum, gradeId: genGrade.id
      });
      toast.success(t("sub.applied").replace("{created}", String(r.created)).replace("{skipped}", String(r.skipped)).replace("{noPrice}", String(r.noPrice ?? 0)));
      setGenGrade(null);
      list.reload();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed");
    } finally { setGenBusy(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("sub.title")} description={t("sub.pricesTitle")} />
      <ErrorNotice message={cfg.error} />

      <div className="card space-y-3 p-4">
        <Field label={t("sub.stage")}>
          {(id) => (
            <select id={id} className="input max-w-xs" value={stage?.id ?? ""} onChange={(e) => setStageId(e.target.value)}>
              {cfg.data?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Field>
        <DataTable
          columns={[t("sub.grade"), t("sub.price"), t("sub.students"), t("sub.changedAt"), t("common.actions")]}
          loading={cfg.loading}
          isEmpty={(stage?.grades.length ?? 0) === 0}
          emptyTitle={t("sub.noPrice")}
        >
          {stage?.grades.map((g) => (
            <tr key={g.id} className="border-b border-black/5 dark:border-white/5">
              <td className="p-3 font-medium">{g.name}</td>
              <td className="p-3">
                {g.current ? <span className="font-semibold">{formatMoneyClient(g.current.amount)}</span> : <Badge tone="warning">{t("sub.noPrice")}</Badge>}
              </td>
              <td className="p-3">{g.studentCount}</td>
              <td className="p-3 text-xs">
                {g.current ? <>{formatDate(g.current.createdAt)}{g.current.changedBy ? ` · ${g.current.changedBy}` : ""}</> : "—"}
              </td>
              <td className="p-3">
                <div className="flex flex-wrap gap-3">
                  {cfg.data?.canManage && (
                    <button type="button" className="text-xs font-medium hover:underline" onClick={() => openEdit(g)}>
                      {g.current ? t("sub.edit") : t("sub.setPrice")}
                    </button>
                  )}
                  {g.history.length > 0 && <button type="button" className="text-xs hover:underline" onClick={() => setHistoryOf(g)}>{t("sub.history")}</button>}
                  {cfg.data?.canManage && g.current && <button type="button" className="text-xs hover:underline" onClick={() => { setGenGrade(g); setGenError(null); }}>{t("sub.apply")}</button>}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </div>

      <h2 className="text-lg font-semibold">{t("sub.charges")}</h2>
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <Field label={t("common.month")}>
          {(id) => <input id={id} type="month" className="input" value={month} onChange={(e) => { setPage(1); setMonth(e.target.value); }} />}
        </Field>
        <Field label={t("common.status")}>
          {(id) => (
            <select id={id} className="input" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              <option value="">{t("common.all")}</option>
              {["PAID", "PARTIAL", "UNPAID", "OVERDUE", "WAIVED"].map((s) => <option key={s} value={s}>{t(`pay.st.${s}` as never)}</option>)}
            </select>
          )}
        </Field>
      </div>
      {list.data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Billed" value={formatMoneyClient(list.data.totals.billed)} />
          <StatCard label={t("pay.collected")} value={formatMoneyClient(list.data.totals.collected)} tone="positive" />
          <StatCard label={t("pay.outstandingTotal")} value={formatMoneyClient(list.data.totals.outstanding)} tone="negative" />
        </div>
      )}
      <ErrorNotice message={list.error} />
      <DataTable
        columns={[t("common.student"), t("pay.month"), t("pay.histAmount"), t("pay.discount"), t("pay.amountPaid"), t("pay.remainingAfter"), t("common.status")]}
        loading={list.loading}
        isEmpty={(list.data?.subscriptions.length ?? 0) === 0}
        emptyTitle={t("subscriptions.empty")}
      >
        {list.data?.subscriptions.map((s) => (
          <tr key={s.id} className="border-b border-black/5 dark:border-white/5">
            <td className="p-3 font-medium">{s.student.fullName}<span className="ms-2 font-mono text-xs text-black/45 dark:text-white/45">{s.student.studentCode}</span></td>
            <td className="p-3">{s.periodYear}-{String(s.periodMonth).padStart(2, "0")}</td>
            <td className="p-3">{formatMoneyClient(s.amount)}</td>
            <td className="p-3">{formatMoneyClient(s.discount)}</td>
            <td className="p-3">{formatMoneyClient(s.paidAmount)}</td>
            <td className="p-3">{formatMoneyClient(s.remaining)}</td>
            <td className="p-3"><Badge tone={toneFor(s.status)}>{t(`pay.st.${s.status}` as never)}</Badge></td>
          </tr>
        ))}
      </DataTable>
      <Pager page={list.data?.pagination.page ?? 1} totalPages={list.data?.pagination.totalPages ?? 1} onChange={setPage} />

      <Modal open={Boolean(editing)} title={`${stage?.name ?? ""} › ${editing?.name ?? ""}`} onClose={() => setEditing(null)}>
        <form onSubmit={save} className="space-y-3">
          <ErrorNotice message={saveError} />
          <Field label={t("sub.price")} required>
            {(id) => <input id={id} type="number" min={1} step="0.01" required className="input" value={price} onChange={(e) => setPrice(e.target.value)} />}
          </Field>
          <Field label={t("sub.effectiveFrom")} hint={t("sub.effectiveHint")}>
            {(id) => <input id={id} type="date" className="input" value={effective} onChange={(e) => setEffective(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={saving || !Number(price)}>{saving ? t("common.loading") : t("common.save")}</button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(historyOf)} title={`${t("sub.history")} — ${historyOf?.name ?? ""}`} onClose={() => setHistoryOf(null)}>
        <ul className="space-y-1 text-sm">
          {historyOf?.history.map((h) => (
            <li key={h.id} className="flex justify-between gap-3 border-b border-black/5 py-1 dark:border-white/5">
              <span className="font-semibold">{formatMoneyClient(h.amount)}{h.isActive && <Badge tone="success"> ✓</Badge>}</span>
              <span className="text-xs text-black/60 dark:text-white/60">{t("sub.effectiveFrom")} {formatDate(h.effectiveFrom)}{h.changedBy ? ` · ${h.changedBy}` : ""}</span>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={Boolean(genGrade)} title={`${t("sub.apply")} — ${genGrade?.name ?? ""} (${month})`} onClose={() => setGenGrade(null)}>
        <ErrorNotice message={genError} />
        <p className="text-sm text-black/70 dark:text-white/70">{t("sub.applyMsg")}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={() => setGenGrade(null)}>{t("common.cancel")}</button>
          <button type="button" className="btn-primary" disabled={genBusy} onClick={() => void apply()}>{genBusy ? t("common.loading") : t("sub.apply")}</button>
        </div>
      </Modal>
    </div>
  );
}
