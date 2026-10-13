import { type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import {
  DEFAULT_PAYMENT_RULES,
  SETTING_KEYS,
  getAnalyticsThresholds,
  getCenterProfile,
  getLateThresholdMinutes,
  getMakeUpRules,
  getPaymentRules,
  setSetting
} from "@/lib/settings";
import { handleApiError, ok, readJson } from "@/lib/api";

const SCOPE = "settings";

const updateSchema = z.object({
  center: z
    .object({
      name: z.string().trim().min(2).max(160).optional(),
      address: z.string().trim().max(300).nullable().optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      whatsappNumber: z.string().trim().max(30).nullable().optional(),
      currency: z.string().trim().min(1).max(10).optional(),
      timezone: z.string().trim().min(3).max(60).optional(),
      logoUrl: z.string().trim().max(500).nullable().optional()
    })
    .optional(),
  attendanceRules: z
    .object({
      respectCapacity: z.boolean().optional(),
      maxMakeUpsPerMonth: z.number().int().min(0).max(31).optional(),
      maxDaysAfterOrigin: z.number().int().min(0).max(365).optional()
    })
    .optional(),
  lateThresholdMinutes: z.number().int().min(0).max(240).optional(),
  paymentRules: z
    .object({
      defaultMonthlyAmount: z.number().min(0).max(1_000_000).optional(),
      dueDayOfMonth: z.number().int().min(1).max(28).optional(),
      allowPartialPayments: z.boolean().optional()
    })
    .optional(),
  analyticsThresholds: z
    .object({
      lowAttendancePercent: z.number().min(0).max(100).optional(),
      lowGradePercent: z.number().min(0).max(100).optional(),
      decliningTrend: z.number().optional(),
      improvingTrend: z.number().optional(),
      missingAssignmentsCount: z.number().int().min(0).max(50).optional(),
      repeatedAbsenceCount: z.number().int().min(1).max(20).optional()
    })
    .optional()
});

export async function GET() {
  try {
    const ctx = await requirePermission("settings.manage");

    const [center, attendanceRules, lateThresholdMinutes, paymentRules, analyticsThresholds] =
      await Promise.all([
        getCenterProfile(ctx.organizationId),
        getMakeUpRules(ctx.organizationId),
        getLateThresholdMinutes(ctx.organizationId),
        getPaymentRules(ctx.organizationId),
        getAnalyticsThresholds(ctx.organizationId)
      ]);

    return ok({
      center,
      attendanceRules,
      lateThresholdMinutes,
      paymentRules,
      analyticsThresholds,
      defaults: { paymentRules: DEFAULT_PAYMENT_RULES }
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requirePermission("settings.manage");
    const input = await readJson(request, updateSchema);

    const before = {
      center: await getCenterProfile(ctx.organizationId),
      attendanceRules: await getMakeUpRules(ctx.organizationId),
      paymentRules: await getPaymentRules(ctx.organizationId)
    };

    if (input.center) {
      const center = await db.center.findFirst({
        where: { organizationId: ctx.organizationId, deletedAt: null }
      });
      if (center) {
        await db.center.update({ where: { id: center.id }, data: input.center });
      }
    }

    if (input.attendanceRules) {
      const merged = { ...before.attendanceRules, ...input.attendanceRules };
      await setSetting(ctx.organizationId, SETTING_KEYS.attendanceRules, merged);
    }
    if (input.lateThresholdMinutes !== undefined) {
      await setSetting(ctx.organizationId, SETTING_KEYS.lateThreshold, {
        minutes: input.lateThresholdMinutes
      });
    }
    if (input.paymentRules) {
      await setSetting(ctx.organizationId, SETTING_KEYS.paymentRules, {
        ...before.paymentRules,
        ...input.paymentRules
      });
    }
    if (input.analyticsThresholds) {
      const current = await getAnalyticsThresholds(ctx.organizationId);
      await setSetting(ctx.organizationId, SETTING_KEYS.analyticsThresholds, {
        ...current,
        ...input.analyticsThresholds
      });
    }

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPDATE_SETTINGS",
      entityType: "SystemSetting",
      beforeValue: before,
      afterValue: input
    });

    return ok({ saved: true });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
