"use client";

import { Suspense, useEffect } from "react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { formatDateTime, formatMoneyClient, useApi } from "@/lib/client";
import { ErrorNotice, PageHeader } from "@/components/ui";

interface Receipt {
  center: { name: string; phone: string | null; address: string | null; logoUrl: string | null; currency: string };
  receiptNumber: string;
  status: string;
  voidReason: string | null;
  amount: number;
  method: string;
  paidAt: string;
  notes: string | null;
  cashier: string | null;
  student: { fullName: string; studentCode: string };
  book: { title: string; kind: string; price: number; discount: number };
  paidTotal: number;
  remaining: number;
}

/** Book / notes receipt (80mm thermal). GET only: printing never creates or changes a payment. */
export default function BookReceiptPage() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  );
}

function View() {
  const { t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const params = useParams<{ paymentId: string }>();
  const { data: r, loading, error } = useApi<Receipt>(`/api/books/payments/${params.paymentId}`);
  const embed = search.get("embed") === "1";

  useEffect(() => {
    if (!r || search.get("print") !== "1") return;
    const timer = setTimeout(
      () => {
        if (embed) {
          const notify = () => window.parent?.postMessage({ type: "receipt-printed", id: params.paymentId }, window.location.origin);
          window.addEventListener("afterprint", notify, { once: true });
        }
        window.print();
      },
      embed ? 700 : 400
    );
    return () => clearTimeout(timer);
  }, [r, search, embed, params.paymentId]);

  const cur = r?.center.currency ?? "EGP";
  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t("bk.receiptTitle")} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.back()}>{t("common.back")}</button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>{t("common.print")}</button>
        </div>
      </div>
      <ErrorNotice message={error} />
      {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      {r && (
        <div className="print-sheet print-receipt card mx-auto max-w-sm space-y-3 border border-black/10 p-5 text-sm dark:border-white/10">
          <div className="text-center">
            {r.center.logoUrl && <Image src={r.center.logoUrl} alt="" width={56} height={56} unoptimized className="mx-auto mb-1 h-14 w-14 object-contain" />}
            <p className="text-base font-bold">{r.center.name}</p>
            {r.center.address && <p className="text-xs">{r.center.address}</p>}
            {r.center.phone && <p className="text-xs">{r.center.phone}</p>}
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">{t("bk.receiptTitle")}</p>
            {r.status !== "COMPLETED" && <p className="text-xs font-semibold text-red-600">({t("bk.voided")}{r.voidReason ? `: ${r.voidReason}` : ""})</p>}
          </div>
          <hr className="border-dashed border-black/20 dark:border-white/20" />
          <dl className="space-y-1">
            <Row label={t("receipt.number")} value={r.receiptNumber} strong />
            <Row label={t("receipt.student")} value={r.student.fullName} />
            <Row label={t("receipt.code")} value={r.student.studentCode} />
            <Row label={t(`bk.kind.${r.book.kind}` as never)} value={r.book.title} />
          </dl>
          <hr className="border-dashed border-black/20 dark:border-white/20" />
          <dl className="space-y-1">
            <Row label={t("bk.price")} value={formatMoneyClient(r.book.price - r.book.discount, cur)} />
            <Row label={t("receipt.method")} value={t(`pay.method.${r.method}` as never)} />
            <Row label={t("receipt.date")} value={formatDateTime(r.paidAt)} />
            <Row label={t("receipt.cashier")} value={r.cashier ?? "—"} />
            <Row label={t("receipt.total")} value={formatMoneyClient(r.amount, cur)} strong />
            <Row label={t("bk.paidSoFar")} value={formatMoneyClient(r.paidTotal, cur)} />
            <Row label={t("bk.remaining")} value={formatMoneyClient(r.remaining, cur)} strong />
          </dl>
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
