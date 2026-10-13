import { db } from "./db";
import { renderTemplate, type TemplateVariables } from "./templates";

/**
 * Notification dispatch (spec §22, §56).
 *
 * `dispatchEvent` is the single entry point used by attendance,
 * payments and exams. It looks up the organization's NotificationRule
 * rows for the event, renders the matching template in the recipient's
 * preferred language, then writes an in-app Notification and/or queues
 * nothing else. WhatsApp is NOT sent automatically: staff open wa.me
 * chat links manually (see src/lib/wa-link.ts), so WHATSAPP-channel
 * rules are skipped here.
 */

export type NotificationEventValue =
  | "STUDENT_ABSENT"
  | "STUDENT_LATE"
  | "REPEATED_ABSENCE"
  | "PAYMENT_OVERDUE"
  | "PAYMENT_RECEIVED"
  | "EXAM_PUBLISHED"
  | "ANNOUNCEMENT";

export interface DispatchParams {
  organizationId: string;
  event: NotificationEventValue;
  studentId?: string;
  variables: TemplateVariables;
  /** Fallback title for the in-app notification. */
  title: string;
  actorUserId?: string;
}

export interface DispatchResult {
  inAppCreated: number;
  skippedReason?: string;
}

const EVENT_TYPE: Record<NotificationEventValue, "ATTENDANCE" | "PAYMENT" | "EXAM" | "ADMINISTRATIVE"> = {
  STUDENT_ABSENT: "ATTENDANCE",
  STUDENT_LATE: "ATTENDANCE",
  REPEATED_ABSENCE: "ATTENDANCE",
  PAYMENT_OVERDUE: "PAYMENT",
  PAYMENT_RECEIVED: "PAYMENT",
  EXAM_PUBLISHED: "EXAM",
  ANNOUNCEMENT: "ADMINISTRATIVE"
};

/**
 * Never throws: a notification failure must not fail the business action
 * (payment, attendance, exam publish) that triggered it. Callers await it
 * because serverless functions may be frozen right after the response.
 */
export async function dispatchEvent(params: DispatchParams): Promise<DispatchResult> {
  try {
    return await dispatchEventUnsafe(params);
  } catch (err) {
    console.error("[notifications] dispatch failed", params.event, err instanceof Error ? err.message : "unknown");
    return { inAppCreated: 0, skippedReason: "Dispatch failed." };
  }
}

async function dispatchEventUnsafe(params: DispatchParams): Promise<DispatchResult> {
  const rules = await db.notificationRule.findMany({
    where: { organizationId: params.organizationId, event: params.event, isEnabled: true }
  });

  if (rules.length === 0) {
    return { inAppCreated: 0, skippedReason: "No enabled rule for this event." };
  }

  // Resolve recipients: the student's parents (with notifications enabled).
  const links = params.studentId
    ? await db.studentParent.findMany({
        where: { studentId: params.studentId },
        include: { parent: true, student: { select: { id: true, fullName: true } } }
      })
    : [];

  let inAppCreated = 0;

  for (const rule of rules) {
    // No automatic WhatsApp sending — wa.me links are opened by staff.
    if (rule.channel === "WHATSAPP") continue;
    for (const link of links) {
      const parent = link.parent;
      if (!parent.notificationsEnabled) continue;

      const locale = parent.preferredLanguage === "en" ? "en" : "ar";
      const template = await db.notificationTemplate.findFirst({
        where: {
          organizationId: params.organizationId,
          key: rule.templateKey,
          locale,
          channel: rule.channel,
          isActive: true
        }
      });

      // Fall back to the IN_APP template body if the channel-specific
      // one has not been created yet, so a missing template never
      // silently swallows a parent alert.
      const fallback = template
        ? null
        : await db.notificationTemplate.findFirst({
            where: {
              organizationId: params.organizationId,
              key: rule.templateKey,
              locale,
              isActive: true
            }
          });

      const chosen = template ?? fallback;
      if (!chosen) continue;

      const body = renderTemplate(chosen.body, params.variables);

      await db.notification.create({
        data: {
          organizationId: params.organizationId,
          studentId: params.studentId,
          parentId: parent.id,
          type: EVENT_TYPE[params.event],
          channel: rule.channel,
          title: params.title,
          body,
          meta: params.variables as object
        }
      });
      inAppCreated += 1;
    }
  }

  return { inAppCreated };
}

/** Staff-facing in-app notification (dashboard alerts, system messages). */
export async function notifyUser(params: {
  organizationId: string;
  userId: string;
  type: "ATTENDANCE" | "PAYMENT" | "EXAM" | "ACADEMIC" | "ADMINISTRATIVE" | "SYSTEM";
  title: string;
  body: string;
  meta?: object;
}) {
  return db.notification.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      type: params.type,
      channel: "IN_APP",
      title: params.title,
      body: params.body,
      meta: params.meta
    }
  });
}
