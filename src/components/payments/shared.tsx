"use client";

import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { Badge, Field } from "@/components/ui";
import { buildWhatsAppLink } from "@/lib/wa-link";
import { monthLabel } from "@/lib/subscription-months";

export interface FilterTree {
  id: string;
  name: string;
  grades: { id: string; name: string; groups: { id: string; name: string; subject: { name: string } | null }[] }[];
}

export interface Filters {
  year: number;
  month: number;
  stageId: string;
  gradeId: string;
  groupId: string;
}

export function currentFilters(): Filters {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, stageId: "", gradeId: "", groupId: "" };
}

export function statusTone(status: string, refunded = false) {
  if (status === "PAID") return "success" as const;
  if (status === "OVERDUE") return "danger" as const;
  if (status === "PARTIAL") return "warning" as const;
  if (status === "WAIVED") return "brand" as const;
  return refunded ? ("warning" as const) : ("neutral" as const);
}

export function StatusBadge({ status, refunded }: { status: string; refunded?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={statusTone(status, refunded)}>{t(`pay.st.${status}` as never)}</Badge>
      {refunded && status !== "PAID" && <Badge tone="warning">{t("pay.st.REFUNDED")}</Badge>}
    </span>
  );
}

export function fmtMoney(amount: number, currency = "EGP"): string {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

export function monthInputValue(f: { year: number; month: number }) {
  return `${f.year}-${String(f.month).padStart(2, "0")}`;
}

/** Month → Stage → Grade → Group selectors (cascading). */
export function PaymentFilters({ value, onChange }: { value: Filters; onChange: (next: Filters) => void }) {
  const { t } = useI18n();
  const { data: tree } = useApi<FilterTree[]>("/api/payment-filters");
  const stage = tree?.find((s) => s.id === value.stageId);
  const grade = stage?.grades.find((g) => g.id === value.gradeId);

  return (
    <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t("pay.month")}>
        {(id) => (
          <input
            id={id}
            type="month"
            className="input"
            value={monthInputValue(value)}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              if (y && m) onChange({ ...value, year: y, month: m });
            }}
          />
        )}
      </Field>
      <Field label={t("pay.stage")}>
        {(id) => (
          <select id={id} className="input" value={value.stageId} onChange={(e) => onChange({ ...value, stageId: e.target.value, gradeId: "", groupId: "" })}>
            <option value="">{t("pay.allStages")}</option>
            {tree?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("pay.grade")}>
        {(id) => (
          <select id={id} className="input" value={value.gradeId} disabled={!stage} onChange={(e) => onChange({ ...value, gradeId: e.target.value, groupId: "" })}>
            <option value="">{t("pay.allGrades")}</option>
            {stage?.grades.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("pay.group")}>
        {(id) => (
          <select id={id} className="input" value={value.groupId} disabled={!grade} onChange={(e) => onChange({ ...value, groupId: e.target.value })}>
            <option value="">{t("pay.allGroups")}</option>
            {grade?.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.subject ? `${g.name} · ${g.subject.name}` : g.name}</option>
            ))}
          </select>
        )}
      </Field>
    </div>
  );
}

/**
 * Plain click-to-chat WhatsApp link (https://wa.me/<number>?text=...).
 * No WhatsApp API, no tokens, no server call: the staff member's own
 * WhatsApp opens with the message pre-filled.
 */
export function WhatsAppButton({ phone, message, label }: { phone: string | null; message: string; label: string }) {
  const { t } = useI18n();
  const href = phone ? buildWhatsAppLink(phone, message) : null;
  if (!href) {
    return <span className="text-xs text-black/40 dark:text-white/40" title={t("pay.noWhatsapp")}>—</span>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="btn-secondary px-2 py-1 text-xs">
      {label}
    </a>
  );
}

export { monthLabel };
