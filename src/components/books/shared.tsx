"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { Badge, Field } from "@/components/ui";
import type { FilterTree } from "@/components/payments/shared";

export const ITEM_STATUSES = ["PAID", "RESERVED", "PARTIAL", "UNPAID"] as const;

export function itemTone(status: string) {
  if (status === "PAID") return "success" as const;
  if (status === "RESERVED") return "brand" as const;
  if (status === "PARTIAL") return "warning" as const;
  return "danger" as const;
}

export function BookStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={itemTone(status)}>{t(`bk.st.${status}` as never)}</Badge>;
}

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useI18n();
  return <Badge tone="neutral">{t(`bk.kind.${kind}` as never)}</Badge>;
}

export interface CascadeValue {
  stageId: string;
  gradeId: string;
  groupId: string;
}

/** Stage → Grade → Group selectors (cascading). `groupRequired` marks the group as mandatory. */
export function GroupCascade({
  value,
  onChange,
  groupRequired = false,
  allLabels = true
}: {
  value: CascadeValue;
  onChange: (next: CascadeValue) => void;
  groupRequired?: boolean;
  allLabels?: boolean;
}) {
  const { t } = useI18n();
  const { data: tree } = useApi<FilterTree[]>("/api/payment-filters");
  const stage = tree?.find((s) => s.id === value.stageId);
  const grade = stage?.grades.find((g) => g.id === value.gradeId);

  useEffect(() => {
    if (tree && tree.length === 1 && !value.stageId) onChange({ stageId: tree[0]!.id, gradeId: "", groupId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, value.stageId]);

  return (
    <>
      <Field label={t("pay.stage")}>
        {(id) => (
          <select id={id} className="input" value={value.stageId} onChange={(e) => onChange({ stageId: e.target.value, gradeId: "", groupId: "" })}>
            <option value="">{allLabels ? t("pay.allStages") : t("common.select")}</option>
            {tree?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("pay.grade")}>
        {(id) => (
          <select id={id} className="input" value={value.gradeId} disabled={!stage} onChange={(e) => onChange({ ...value, gradeId: e.target.value, groupId: "" })}>
            <option value="">{allLabels ? t("pay.allGrades") : t("common.select")}</option>
            {stage?.grades.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("pay.group")} required={groupRequired}>
        {(id) => (
          <select id={id} className="input" value={value.groupId} disabled={!grade} onChange={(e) => onChange({ ...value, groupId: e.target.value })}>
            <option value="">{allLabels ? t("pay.allGroups") : t("common.select")}</option>
            {grade?.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.subject ? `${g.name} · ${g.subject.name}` : g.name}</option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

/** Prints a book receipt without leaving the page (hidden iframe, same idea as printReceiptSilently). */
export function printBookReceipt(paymentId: string): void {
  if (typeof window === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  iframe.src = `/dashboard/finance/books/receipt/${encodeURIComponent(paymentId)}?print=1&embed=1`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    if (timer) clearTimeout(timer);
    iframe.remove();
  };
  function onMessage(event: MessageEvent) {
    const d = event.data as { type?: string; id?: string } | null;
    if (event.origin === window.location.origin && d?.type === "receipt-printed" && d.id === paymentId) cleanup();
  }
  window.addEventListener("message", onMessage);
  timer = setTimeout(cleanup, 120_000);
  document.body.appendChild(iframe);
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
