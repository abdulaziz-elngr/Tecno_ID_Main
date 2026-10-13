"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { fmtMoney } from "@/components/payments/shared";
import { monthName } from "@/lib/subscription-months";

interface Notices {
  currency: string;
  dueDay: number;
  count: number;
  totalOutstanding: number;
  notices: {
    studentId: string;
    fullName: string;
    totalDue: number;
    months: { year: number; month: number; remaining: number }[];
  }[];
}

/**
 * "Monthly Subscription Unpaid" — shown after the due day (the 5th by default)
 * for every student who still owes a month. Computed live by the API, so it
 * stays until the payment is recorded and vanishes right after. Users without
 * payments.view get a 403 and simply see nothing.
 */
export function OverdueNotices({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const { data, error } = useApi<Notices>("/api/payments/overdue-notices");
  const [open, setOpen] = useState(false);
  if (error || !data || data.count === 0) return null;

  const monthsText = (months: Notices["notices"][number]["months"]) =>
    months.map((m) => monthName(m.month, locale)).join("، ");
  const shown = data.notices.slice(0, compact ? 0 : 8);

  return (
    <div role="alert" className="no-print rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">
          ⚠️ {t("notice.title")} — {data.count} · {fmtMoney(data.totalOutstanding, data.currency)}
        </p>
        <div className="flex gap-3">
          {!compact && data.notices.length > shown.length && (
            <button type="button" className="text-xs underline" onClick={() => setOpen((v) => !v)}>
              {open ? "−" : "+"}
            </button>
          )}
          <Link href="/dashboard/finance/records" className="text-xs underline">{t("notice.viewAll")}</Link>
        </div>
      </div>
      {(open ? data.notices : shown).length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {(open ? data.notices : shown).map((n) => (
            <li key={n.studentId}>
              {t("notice.body").replace("{name}", n.fullName).replace("{months}", monthsText(n.months))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
