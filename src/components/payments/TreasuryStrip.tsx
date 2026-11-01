"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { formatMoneyClient, qs, useApi } from "@/lib/client";
import { StatCard } from "@/components/ui";
import { usePermissions } from "@/components/PermissionsProvider";

export interface TreasuryBucket {
  tuition: number;
  books: number;
  income: number;
  deductions: number;
  net: number;
}
export interface TreasurySummaryData {
  year: number;
  month: number;
  total: TreasuryBucket;
  monthly: TreasuryBucket;
}

/**
 * "Total المبلغ" and "فلوس الشهر" after the treasury deductions ("خصم مبلغ").
 * Reads the single treasury calculation, so it always agrees with the treasury page,
 * the dashboard and the financial report.
 */
export function TreasuryStrip({ year, month }: { year?: number; month?: number }) {
  const { t } = useI18n();
  const { has } = usePermissions();
  const { data } = useApi<TreasurySummaryData>(`/api/treasury/summary${qs({ year, month })}`);
  if (!data) return null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("tre.totalBalance")}
          value={formatMoneyClient(data.total.net)}
          hint={`${t("tre.income")} ${formatMoneyClient(data.total.income)} − ${t("tre.deductions")} ${formatMoneyClient(data.total.deductions)}`}
          tone={data.total.net < 0 ? "negative" : "positive"}
        />
        <StatCard
          label={t("tre.monthIncome")}
          value={formatMoneyClient(data.monthly.income)}
          hint={`${t("tre.tuition")} ${formatMoneyClient(data.monthly.tuition)} · ${t("tre.books")} ${formatMoneyClient(data.monthly.books)}`}
          tone="positive"
        />
        <StatCard label={t("tre.monthDeductions")} value={formatMoneyClient(data.monthly.deductions)} tone={data.monthly.deductions > 0 ? "warning" : "default"} />
        <StatCard label={t("tre.monthNet")} value={formatMoneyClient(data.monthly.net)} tone={data.monthly.net < 0 ? "negative" : "positive"} />
      </div>
      {has("deductions.view") && (
        <Link href="/dashboard/finance/deductions" className="inline-block text-xs text-tecno-gold-dark hover:underline dark:text-tecno-gold">
          {t("tre.openDeductions")} ←
        </Link>
      )}
    </div>
  );
}
