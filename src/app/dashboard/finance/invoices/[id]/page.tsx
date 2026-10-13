"use client";

import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatMoneyClient, useApi } from "@/lib/client";
import { Badge, ErrorNotice, PageHeader } from "@/components/ui";

interface InvoiceDetail {
  center: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    currency: string;
  };
  invoice: {
    id: string;
    invoiceNumber: string;
    issuedAt: string;
    status: string;
    description: string | null;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    voidReason: string | null;
  };
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    parent: { fullName: string; phone: string } | null;
  };
  payment: {
    receiptNumber: string;
    method: string;
    paidAt: string;
    status: string;
    lines: { description: string; amount: number }[];
  };
}

export default function InvoiceDetailPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { data, loading, error } = useApi<InvoiceDetail>(`/api/invoices/${params.id}`);

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("invoices.title")} />
        <ErrorNotice message={error} />
        {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  const { center, invoice, student, payment } = data;

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={invoice.invoiceNumber} description={formatDate(invoice.issuedAt)} />
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.push("/dashboard/finance/invoices")}>
            {t("common.back")}
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            {t("common.print")}
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />

      <div className="print-sheet card mx-auto max-w-2xl space-y-6 p-8">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 pb-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            {center.logoUrl && (
              <Image src={center.logoUrl} alt={center.name} width={56} height={56} className="rounded-lg object-contain" unoptimized />
            )}
            <div>
              <p className="text-lg font-bold">{center.name}</p>
              {center.address && <p className="text-xs text-black/55 dark:text-white/55">{center.address}</p>}
              {center.phone && <p className="text-xs text-black/55 dark:text-white/55">{center.phone}</p>}
            </div>
          </div>
          <div className="text-end">
            <p className="font-mono text-sm">{invoice.invoiceNumber}</p>
            <p className="text-xs text-black/55 dark:text-white/55">{formatDate(invoice.issuedAt)}</p>
            <Badge tone={invoice.status === "VOID" ? "danger" : "success"}>{invoice.status}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 text-sm min-[420px]:grid-cols-2 [&>*]:min-w-0 [&>*]:break-words">
          <div>
            <p className="text-xs uppercase text-black/45 dark:text-white/45">{t("common.student")}</p>
            <p className="font-medium">{student.fullName}</p>
            <p className="font-mono text-xs text-black/55 dark:text-white/55">{student.studentCode}</p>
          </div>
          {student.parent && (
            <div>
              <p className="text-xs uppercase text-black/45 dark:text-white/45">{t("nav.parents")}</p>
              <p className="font-medium">{student.parent.fullName}</p>
              <p className="text-xs text-black/55 dark:text-white/55">{student.parent.phone}</p>
            </div>
          )}
          <div>
            <p className="text-xs uppercase text-black/45 dark:text-white/45">Receipt</p>
            <p className="font-mono">{payment.receiptNumber}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-black/45 dark:text-white/45">Method</p>
            <p>{payment.method}</p>
          </div>
        </div>

        <table className="w-full text-start text-sm">
          <thead className="border-b border-black/10 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-2 text-start font-medium">Description</th>
              <th className="p-2 text-end font-medium">{t("common.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {payment.lines.length > 0 ? (
              payment.lines.map((line, idx) => (
                <tr key={idx} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-2">{line.description}</td>
                  <td className="p-2 text-end">{formatMoneyClient(line.amount, center.currency)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-2" colSpan={2}>
                  {invoice.description ?? "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="ms-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span>{t("common.amount")}</span>
            <span>{formatMoneyClient(invoice.totalAmount, center.currency)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Paid</span>
            <span>{formatMoneyClient(invoice.paidAmount, center.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-black/10 pt-1 font-semibold dark:border-white/10">
            <span>Remaining</span>
            <span>{formatMoneyClient(invoice.remainingAmount, center.currency)}</span>
          </div>
        </div>

        {invoice.voidReason && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            Voided: {invoice.voidReason}
          </p>
        )}
      </div>
    </div>
  );
}
