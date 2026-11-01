"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatMoneyClient, useApi } from "@/lib/client";
import { usePermissions } from "@/components/PermissionsProvider";
import { BookStatusBadge, KindBadge } from "@/components/books/shared";

interface Item {
  itemId: string;
  reservationId: string;
  title: string;
  kind: string;
  reservationStatus: string;
  payable: number;
  paid: number;
  remaining: number;
  status: string;
  dueDate: string | null;
}

/** The student's book / notes reservations on his profile (who paid, who did not, how much remains). */
export function StudentBooksCard({ studentId }: { studentId: string }) {
  const { t } = useI18n();
  const { has } = usePermissions();
  const allowed = has("books.view");
  const { data } = useApi<{ items: Item[]; totalRemaining: number }>(allowed ? `/api/students/${studentId}/books` : null);
  if (!allowed || !data || data.items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("bk.title")}</h3>
        {data.totalRemaining > 0 && (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("bk.remaining")}: {formatMoneyClient(data.totalRemaining)}</span>
        )}
      </div>
      <div className="card divide-y divide-black/5 dark:divide-white/10">
        {data.items.map((b) => (
          <Link key={b.itemId} href={`/dashboard/finance/books/${b.reservationId}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">{b.title} <KindBadge kind={b.kind} /></p>
              <p className="text-xs text-black/55 dark:text-white/55">
                {t("bk.price")} {formatMoneyClient(b.payable)} · {t("bk.paid")} {formatMoneyClient(b.paid)} · {t("bk.remaining")} {formatMoneyClient(b.remaining)}
                {b.dueDate ? ` · ${t("bk.dueDate")} ${formatDate(b.dueDate)}` : ""}
              </p>
            </div>
            <BookStatusBadge status={b.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
