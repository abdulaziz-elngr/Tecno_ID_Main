"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { apiPost, formatDateTime, qs, useApi } from "@/lib/client";
import { DataTable, ErrorNotice, PageHeader, StatCard, useToast } from "@/components/ui";
import {
  PaymentFilters,
  StatusBadge,
  WhatsAppButton,
  currentFilters,
  fmtMoney,
  monthLabel,
  type Filters
} from "@/components/payments/shared";
import { paidMessage, unpaidMessage } from "@/lib/subscription-months";

interface Row {
  studentId: string;
  fullName: string;
  studentCode: string;
  groupName: string;
  whatsappNumber: string | null;
  month: { year: number; month: number; amount: number; discount: number; paid: number; remaining: number; status: string; refunded: boolean };
  outstanding: { year: number; month: number; amount: number; remaining: number; status: string }[];
  totalDue: number;
  payment: { id: string; receiptNumber: string; paidAt: string; method: string; amount: number } | null;
}
interface Roster {
  paid: Row[];
  unpaid: Row[];
  totals: { paidCount: number; unpaidCount: number; collected: number; outstanding: number };
  env: { currency: string };
}

/** Payment Records: who paid / who did not for a month, with receipts, Excel export and WhatsApp links. */
export default function PaymentRecordsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<Filters>(currentFilters());
  const [actionError, setActionError] = useState<string | null>(null);

  const url = `/api/payment-records${qs({ year: f.year, month: f.month, stageId: f.stageId, gradeId: f.gradeId, groupId: f.groupId })}`;
  const { data, loading, error } = useApi<Roster>(url);
  const cur = data?.env.currency ?? "EGP";
  const label = monthLabel({ year: f.year, month: f.month }, locale);

  function exportHref(section: "paid" | "unpaid") {
    return `/api/payment-records/export${qs({ year: f.year, month: f.month, stageId: f.stageId, gradeId: f.gradeId, groupId: f.groupId, section, locale })}`;
  }

  async function reprint(id: string) {
    setActionError(null);
    try {
      await apiPost(`/api/payments/${id}/reprint`);
      window.open(`/dashboard/finance/payments/${id}?print=1&copy=1`, "_blank");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("rec.title")} />
      <PaymentFilters value={f} onChange={setF} />
      <ErrorNotice message={error ?? actionError} />

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t("pay.paidStudents")} value={data.totals.paidCount} tone="positive" />
          <StatCard label={t("pay.unpaidStudents")} value={data.totals.unpaidCount} tone="warning" />
          <StatCard label={t("pay.collected")} value={fmtMoney(data.totals.collected, cur)} tone="positive" />
          <StatCard label={t("pay.outstandingTotal")} value={fmtMoney(data.totals.outstanding, cur)} tone="negative" />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* SECTION 1 — paid */}
        <section className="space-y-2" aria-label={t("rec.paid")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-emerald-700 dark:text-emerald-300">{t("rec.paid")} ({data?.totals.paidCount ?? 0})</h2>
            <a className="btn-secondary px-3 py-1 text-xs" href={exportHref("paid")}>{t("rec.exportPaid")}</a>
          </div>
          <DataTable
            columns={[t("pay.colStudent"), t("pay.colGroup"), t("rec.colAmount"), t("rec.colPaidAt"), t("rec.colMethod"), t("rec.colReceipt"), t("common.actions")]}
            loading={loading}
            isEmpty={(data?.paid.length ?? 0) === 0}
            emptyTitle={t("rec.empty")}
          >
            {data?.paid.map((r) => (
              <tr key={r.studentId} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">{r.fullName}<div className="font-mono text-xs text-black/45 dark:text-white/45">{r.studentCode}</div></td>
                <td className="p-3">{r.groupName}</td>
                <td className="p-3">{fmtMoney(r.month.paid, cur)}</td>
                <td className="p-3 text-xs">{r.payment ? formatDateTime(r.payment.paidAt) : <StatusBadge status={r.month.status} />}</td>
                <td className="p-3 text-xs">{r.payment ? t(`pay.method.${r.payment.method}` as never) : "—"}</td>
                <td className="p-3 font-mono text-xs">{r.payment?.receiptNumber ?? "—"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    {r.payment && (
                      <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => void reprint(r.payment!.id)}>{t("pay.reprint")}</button>
                    )}
                    <WhatsAppButton
                      phone={r.whatsappNumber}
                      label={t("pay.whatsapp")}
                      message={paidMessage({ studentName: r.fullName, monthLabel: label, amount: r.month.paid, currency: cur, locale })}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </section>

        {/* SECTION 2 — did not pay */}
        <section className="space-y-2" aria-label={t("rec.unpaid")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-red-700 dark:text-red-300">{t("rec.unpaid")} ({data?.totals.unpaidCount ?? 0})</h2>
            <a className="btn-secondary px-3 py-1 text-xs" href={exportHref("unpaid")}>{t("rec.exportUnpaid")}</a>
          </div>
          <DataTable
            columns={[t("pay.colStudent"), t("pay.colGroup"), t("rec.colDue"), t("rec.colOutstanding"), t("pay.colStatus"), t("common.actions")]}
            loading={loading}
            isEmpty={(data?.unpaid.length ?? 0) === 0}
            emptyTitle={t("rec.empty")}
          >
            {data?.unpaid.map((r) => (
              <tr key={r.studentId} className="border-b border-black/5 dark:border-white/5">
                <td className="p-3 font-medium">{r.fullName}<div className="font-mono text-xs text-black/45 dark:text-white/45">{r.studentCode}</div></td>
                <td className="p-3">{r.groupName}</td>
                <td className="p-3">{fmtMoney(r.month.remaining, cur)}</td>
                <td className="p-3 text-xs">{r.outstanding.map((o) => `${o.month}/${o.year}`).join("، ")}</td>
                <td className="p-3"><StatusBadge status={r.month.status} refunded={r.month.refunded} /></td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/dashboard/finance/payments${qs({ studentId: r.studentId, year: f.year, month: f.month })}`} className="btn-primary px-2 py-1 text-xs">{t("pay.recordPayment")}</Link>
                    <WhatsAppButton
                      phone={r.whatsappNumber}
                      label={t("pay.whatsapp")}
                      message={unpaidMessage({
                        studentName: r.fullName,
                        months: r.outstanding.map((o) => ({ label: monthLabel(o, locale), amount: o.remaining })),
                        currency: cur,
                        locale
                      })}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </section>
      </div>
    </div>
  );
}
