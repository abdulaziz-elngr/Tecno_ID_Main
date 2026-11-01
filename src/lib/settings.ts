import { db } from "./db";
import { DEFAULT_MAKEUP_RULES, type MakeUpRules } from "./attendance";
import { DEFAULT_THRESHOLDS, type AnalyticsThresholds } from "./analytics";
import { TtlCache } from "./ttl-cache";

/** Settings are read on every scan; they change only from the Settings screen (which clears this cache). */
const settingCache = new TtlCache<unknown>(60 * 1000, 200);

/**
 * Typed access to per-organization settings stored in SystemSetting.
 * Every getter falls back to a documented default so a fresh
 * organization works before anyone opens the Settings screen.
 */

export const SETTING_KEYS = {
  attendanceRules: "attendance.rules",
  lateThreshold: "attendance.lateThresholdMinutes",
  analyticsThresholds: "analytics.thresholds",
  paymentRules: "payment.rules",
  whatsapp: "whatsapp.settings",
  general: "general"
} as const;

export interface PaymentRules {
  defaultMonthlyAmount: number;
  dueDayOfMonth: number;
  allowPartialPayments: boolean;
  /** "YYYY-MM": first month the center collects fees. Earlier months are never owed. null = no limit. */
  billingStartMonth: string | null;
}

export const DEFAULT_PAYMENT_RULES: PaymentRules = {
  defaultMonthlyAmount: 500,
  dueDayOfMonth: 5,
  allowPartialPayments: true,
  billingStartMonth: null
};

export function clearSettingsCache(): void {
  settingCache.clear();
}

async function readSetting<T>(organizationId: string, key: string, fallback: T): Promise<T> {
  return (await settingCache.wrap(`${organizationId}:${key}`, async () => {
    const row = await db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId, key } }
    });
    if (!row) return fallback;
    return { ...fallback, ...(row.value as object) } as T;
  })) as T;
}

export function getMakeUpRules(organizationId: string): Promise<MakeUpRules> {
  return readSetting(organizationId, SETTING_KEYS.attendanceRules, DEFAULT_MAKEUP_RULES);
}

export function getAnalyticsThresholds(organizationId: string): Promise<AnalyticsThresholds> {
  return readSetting(organizationId, SETTING_KEYS.analyticsThresholds, DEFAULT_THRESHOLDS);
}

export function getPaymentRules(organizationId: string): Promise<PaymentRules> {
  return readSetting(organizationId, SETTING_KEYS.paymentRules, DEFAULT_PAYMENT_RULES);
}

export async function getLateThresholdMinutes(organizationId: string): Promise<number> {
  return (await settingCache.wrap(`${organizationId}:${SETTING_KEYS.lateThreshold}:minutes`, async () => {
    const row = await db.systemSetting.findUnique({
      where: { organizationId_key: { organizationId, key: SETTING_KEYS.lateThreshold } }
    });
    const value = row?.value as { minutes?: number } | undefined;
    return typeof value?.minutes === "number" ? value.minutes : 15;
  })) as number;
}

export async function setSetting(organizationId: string, key: string, value: object) {
  settingCache.clear();
  return db.systemSetting.upsert({
    where: { organizationId_key: { organizationId, key } },
    update: { value },
    create: { organizationId, key, value }
  });
}

export async function getCenterProfile(organizationId: string) {
  const center = await settingCache.wrap(`${organizationId}:center-profile`, () =>
    db.center.findFirst({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        address: true,
        phone: true,
        whatsappNumber: true,
        currency: true,
        timezone: true
      }
    })
  ) as Awaited<ReturnType<typeof db.center.findFirst>> & { id: string };
  return (
    center ?? {
      id: "",
      name: "TecnoID",
      logoUrl: "/logo.png",
      address: null,
      phone: null,
      whatsappNumber: null,
      currency: "EGP",
      timezone: "Africa/Cairo"
    }
  );
}
