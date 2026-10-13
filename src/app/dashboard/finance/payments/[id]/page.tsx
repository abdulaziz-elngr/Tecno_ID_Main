"use client";

import { Suspense, useEffect } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { formatDateTime, useApi } from "@/lib/client";
import { ErrorNotice, PageHeader } from "@/components/ui";
import { fmtMoney, monthLabel } from "@/components/payments/shared";

interface ReceiptData {
  id: string;
  receiptNumber: string;
  amount: number;
  refundedAmount: number;
  method: string;
  status: string;
  paidAt: string;
  notes: string | null;
  cashierName: string | null;
  center: { name: string; logoUrl: string | null; address: string | null; phone: string | null; currency: string };
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    stage: { name: string } | null;
    grade: { name: string } | null;
    group: { name: string } | null;
  };
  allocations: { id: string; amount: number; subscription: { periodYear: number; periodMonth: number } }[];
}

/**
 * Payment receipt — thermal-printer-ready (80mm). Reprinting just re-renders
 * the ORIGINAL transaction (GET only); it never creates or changes a payment.
 * `?print=1` opens the print dialog automatically; `?copy=1` marks it as a reprint.
 */
export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <ReceiptView />
    </Suspense>
  );
}

function ReceiptView() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const params = useParams<{ id: string }>();
  const { data: r, loading, error } = useApi<ReceiptData>(`/api/payments/${params.id}`);
  const isCopy = search.get("copy") === "1";

  useEffect(() => {
    if (r && search.get("print") === "1") {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [r, search]);

  return (
    <div className="space-y-5">
      <div className="no-print flex items-center justify-between">
        <PageHeader title={t("receipt.title")} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.push("/dashboard/finance/payments")}>
            {t("common.back")}
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            {t("common.print")}
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />
      {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}

      {r && (
        <div className="print-sheet print-receipt card mx-auto max-w-sm space-y-3 border border-black/10 p-5 text-sm dark:border-white/10">
          <div className="text-center">
            {r.center.logoUrl && (
              <Image src={r.center.logoUrl} alt="" width={56} height={56} unoptimized className="mx-auto mb-1 h-14 w-14 object-contain" />
            )}
            <p className="text-base font-bold">{r.center.name}</p>
            {r.center.address && <p className="text-xs">{r.center.address}</p>}
            {r.center.phone && <p className="text-xs">{r.center.phone}</p>}
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">{t("receipt.title")}</p>
            {isCopy && <p className="text-xs font-semibold">({t("receipt.copy")})</p>}
          </div>
          <hr className="border-dashed border-black/20 dark:border-white/20" />
          <dl className="space-y-1">
            <Row label={t("receipt.number")} value={r.receiptNumber} strong />
            <Row label={t("receipt.student")} value={r.student.fullName} />
            <Row label={t("receipt.code")} value={r.student.studentCode} />
            <Row label={t("receipt.stage")} value={r.student.stage?.name ?? "—"} />
            <Row label={t("receipt.grade")} value={r.student.grade?.name ?? "—"} />
            <Row label={t("receipt.group")} value={r.student.group?.name ?? "—"} />
          </dl>
          <hr className="border-dashed border-black/20 dark:border-white/20" />
          <dl className="space-y-1">
            {r.allocations.map((a) => (
              <Row
                key={a.id}
                label={`${t("receipt.month")} ${monthLabel({ year: a.subscription.periodYear, month: a.subscription.periodMonth }, locale)}`}
                value={fmtMoney(a.amount, r.center.currency)}
              />
            ))}
            <Row label={t("receipt.method")} value={t(`pay.method.${r.method}` as never)} />
            <Row label={t("receipt.date")} value={formatDateTime(r.paidAt)} />
            <Row label={t("receipt.cashier")} value={r.cashierName ?? "—"} />
            <Row label={t("receipt.total")} value={fmtMoney(r.amount, r.center.currency)} strong />
          </dl>
          {r.refundedAmount > 0 && (
            <p className="text-center text-xs font-semibold text-red-600">
              {t("receipt.refunded")}: {fmtMoney(r.refundedAmount, r.center.currency)}
            </p>
          )}
          <hr className="border-dashed border-black/20 dark:border-white/20" />
          <p className="text-center text-xs text-black/50 dark:text-white/50">{t("receipt.thanks")}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-bold" : ""}`}>
      <dt className="text-black/60 dark:text-white/60">{label}</dt>
      <dd className="text-end">{value}</dd>
    </div>
  );
}
