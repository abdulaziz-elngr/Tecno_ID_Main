"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiPatch, apiPost, useApi } from "@/lib/client";
import { Badge, ErrorNotice, Field, PageHeader, useToast } from "@/components/ui";

interface SettingsData {
  center: {
    name: string;
    address: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    currency: string;
    timezone: string;
    logoUrl: string | null;
  };
  attendanceRules: {
    respectCapacity: boolean;
    maxMakeUpsPerMonth: number;
    maxDaysAfterOrigin: number;
  };
  lateThresholdMinutes: number;
  paymentRules: {
    defaultMonthlyAmount: number;
    dueDayOfMonth: number;
    allowPartialPayments: boolean;
  };
  analyticsThresholds: {
    lowAttendancePercent: number;
    lowGradePercent: number;
    decliningTrend: number;
    improvingTrend: number;
    missingAssignmentsCount: number;
    repeatedAbsenceCount: number;
  };
}

export default function SettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<SettingsData>("/api/settings");

  const [form, setForm] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function saveSection(payload: Record<string, unknown>, key: string) {
    setSaving(key);
    setSaveError(null);
    try {
      await apiPatch("/api/settings", payload);
      toast.success(t("settings.saved"));
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(null);
    }
  }

  if (loading || !form) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("settings.title")} />
        <ErrorNotice message={error} />
        {loading && <p className="text-sm text-black/50 dark:text-white/50">{t("common.loading")}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("settings.title")} />
      <ErrorNotice message={error ?? saveError} />

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">{t("settings.center")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            {(id) => (
              <input id={id} className="input" value={form.center.name} onChange={(e) => setForm({ ...form, center: { ...form.center, name: e.target.value } })} />
            )}
          </Field>
          <Field label="Currency">
            {(id) => (
              <input id={id} className="input" value={form.center.currency} onChange={(e) => setForm({ ...form, center: { ...form.center, currency: e.target.value } })} />
            )}
          </Field>
          <Field label="Phone">
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.center.phone ?? ""}
                onChange={(e) => setForm({ ...form, center: { ...form.center, phone: e.target.value } })}
              />
            )}
          </Field>
          <Field label="WhatsApp number">
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.center.whatsappNumber ?? ""}
                onChange={(e) => setForm({ ...form, center: { ...form.center, whatsappNumber: e.target.value } })}
              />
            )}
          </Field>
          <Field label="Address">
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.center.address ?? ""}
                onChange={(e) => setForm({ ...form, center: { ...form.center, address: e.target.value } })}
              />
            )}
          </Field>
          <Field label="Timezone">
            {(id) => (
              <input
                id={id}
                className="input"
                value={form.center.timezone}
                onChange={(e) => setForm({ ...form, center: { ...form.center, timezone: e.target.value } })}
              />
            )}
          </Field>
        </div>
        <button type="button" className="btn-primary" disabled={saving === "center"} onClick={() => saveSection({ center: form.center }, "center")}>
          {saving === "center" ? t("common.loading") : t("common.save")}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">{t("settings.attendanceRules")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.attendanceRules.respectCapacity}
              onChange={(e) => setForm({ ...form, attendanceRules: { ...form.attendanceRules, respectCapacity: e.target.checked } })}
              className="h-4 w-4"
            />
            Enforce group capacity (spec §3, §9)
          </label>
          <Field label="Max make-ups / month" hint="0 = unlimited">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="input"
                value={form.attendanceRules.maxMakeUpsPerMonth}
                onChange={(e) =>
                  setForm({ ...form, attendanceRules: { ...form.attendanceRules, maxMakeUpsPerMonth: Number(e.target.value) } })
                }
              />
            )}
          </Field>
          <Field label="Make-up window (days)" hint="0 = no limit">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="input"
                value={form.attendanceRules.maxDaysAfterOrigin}
                onChange={(e) =>
                  setForm({ ...form, attendanceRules: { ...form.attendanceRules, maxDaysAfterOrigin: Number(e.target.value) } })
                }
              />
            )}
          </Field>
          <Field label="Late threshold (minutes)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="input"
                value={form.lateThresholdMinutes}
                onChange={(e) => setForm({ ...form, lateThresholdMinutes: Number(e.target.value) })}
              />
            )}
          </Field>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={saving === "attendanceRules"}
          onClick={() =>
            saveSection(
              { attendanceRules: form.attendanceRules, lateThresholdMinutes: form.lateThresholdMinutes },
              "attendanceRules"
            )
          }
        >
          {saving === "attendanceRules" ? t("common.loading") : t("common.save")}
        </button>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">{t("settings.fees")}</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          {t("sub.pricesTitle")}: {t("sub.stage")} → {t("sub.grade")} → {t("sub.price")}
        </p>
        <Link href="/dashboard/finance/subscriptions" className="btn-secondary inline-block">
          {t("sub.title")}
        </Link>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">{t("settings.paymentRules")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due day of month">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                max={28}
                className="input"
                value={form.paymentRules.dueDayOfMonth}
                onChange={(e) => setForm({ ...form, paymentRules: { ...form.paymentRules, dueDayOfMonth: Number(e.target.value) } })}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.paymentRules.allowPartialPayments}
              onChange={(e) => setForm({ ...form, paymentRules: { ...form.paymentRules, allowPartialPayments: e.target.checked } })}
              className="h-4 w-4"
            />
            Allow partial payments
          </label>
        </div>
        <button type="button" className="btn-primary" disabled={saving === "paymentRules"} onClick={() => saveSection({ paymentRules: form.paymentRules }, "paymentRules")}>
          {saving === "paymentRules" ? t("common.loading") : t("common.save")}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">{t("settings.analytics")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Low attendance (%)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                className="input"
                value={form.analyticsThresholds.lowAttendancePercent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    analyticsThresholds: { ...form.analyticsThresholds, lowAttendancePercent: Number(e.target.value) }
                  })
                }
              />
            )}
          </Field>
          <Field label="Low average grade (%)">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                className="input"
                value={form.analyticsThresholds.lowGradePercent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    analyticsThresholds: { ...form.analyticsThresholds, lowGradePercent: Number(e.target.value) }
                  })
                }
              />
            )}
          </Field>
          <Field label="Consecutive absence warning">
            {(id) => (
              <input
                id={id}
                type="number"
                min={1}
                className="input"
                value={form.analyticsThresholds.repeatedAbsenceCount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    analyticsThresholds: { ...form.analyticsThresholds, repeatedAbsenceCount: Number(e.target.value) }
                  })
                }
              />
            )}
          </Field>
          <Field label="Missing assignments warning">
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                className="input"
                value={form.analyticsThresholds.missingAssignmentsCount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    analyticsThresholds: { ...form.analyticsThresholds, missingAssignmentsCount: Number(e.target.value) }
                  })
                }
              />
            )}
          </Field>
          <Field label="Declining trend slope" hint="Exam trend at or below this is flagged as declining">
            {(id) => (
              <input
                id={id}
                type="number"
                className="input"
                value={form.analyticsThresholds.decliningTrend}
                onChange={(e) =>
                  setForm({
                    ...form,
                    analyticsThresholds: { ...form.analyticsThresholds, decliningTrend: Number(e.target.value) }
                  })
                }
              />
            )}
          </Field>
          <Field label="Improving trend slope" hint="Exam trend at or above this is flagged as improving">
            {(id) => (
              <input
                id={id}
                type="number"
                className="input"
                value={form.analyticsThresholds.improvingTrend}
                onChange={(e) =>
                  setForm({
                    ...form,
                    analyticsThresholds: { ...form.analyticsThresholds, improvingTrend: Number(e.target.value) }
                  })
                }
              />
            )}
          </Field>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={saving === "analyticsThresholds"}
          onClick={() => saveSection({ analyticsThresholds: form.analyticsThresholds }, "analyticsThresholds")}
        >
          {saving === "analyticsThresholds" ? t("common.loading") : t("common.save")}
        </button>
      </section>

    </div>
  );
}
