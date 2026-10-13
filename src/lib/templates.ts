/**
 * Message template rendering for notifications and WhatsApp.
 *
 * Placeholders use {{snake_case}} and are HTML-free plain text. Any
 * placeholder with no supplied value renders as an empty string rather
 * than leaking the raw token to a parent's phone.
 */

export type TemplateVariables = Record<string, string | number | null | undefined>;

export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function extractPlaceholders(body: string): string[] {
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Seeded default templates — Arabic and English, per event (spec §21). */
export const DEFAULT_TEMPLATES: {
  key: string;
  type: "ATTENDANCE" | "PAYMENT" | "EXAM" | "ACADEMIC" | "ADMINISTRATIVE" | "SYSTEM";
  name: string;
  ar: string;
  en: string;
}[] = [
  {
    key: "attendance.absent",
    type: "ATTENDANCE",
    name: "Absence notification",
    ar: "عزيزي {{parent_name}},\nنحيطكم علماً بغياب الطالب {{student_name}} عن حصة {{group_name}} ({{stage_name}} - {{grade_name}}) بتاريخ {{date}} الساعة {{time}}.\nمع تحيات {{center_name}}.",
    en: "Dear {{parent_name}},\nWe would like to inform you that {{student_name}} was absent from today's session on {{date}} at {{time}} ({{group_name}}, {{grade_name}}, {{stage_name}}).\nThank you — {{center_name}}."
  },
  {
    key: "attendance.late",
    type: "ATTENDANCE",
    name: "Late arrival notification",
    ar: "عزيزي {{parent_name}},\nنحيطكم علماً بتأخر الطالب {{student_name}} عن حصة {{group_name}} بتاريخ {{date}} الساعة {{time}} بمقدار {{late_minutes}} دقيقة.\nمع تحيات {{center_name}}.",
    en: "Dear {{parent_name}},\n{{student_name}} arrived {{late_minutes}} minutes late to the {{group_name}} session on {{date}} at {{time}}.\nThank you — {{center_name}}."
  },
  {
    key: "payment.reminder",
    type: "PAYMENT",
    name: "Unpaid subscription reminder",
    ar: "عزيزي {{parent_name}},\nنذكركم بأن اشتراك شهر {{period}} للطالب {{student_name}} ({{grade_name}}, {{group_name}}) بمبلغ {{amount}} لم يتم سداده حتى الآن.\nمع تحيات {{center_name}}.",
    en: "Dear {{parent_name}},\nThis is a reminder that the {{period}} tuition payment of {{amount}} for {{student_name}} ({{grade_name}}, {{group_name}}) is currently outstanding.\nThank you — {{center_name}}."
  },
  {
    key: "payment.received",
    type: "PAYMENT",
    name: "Payment confirmation",
    ar: "عزيزي {{parent_name}},\nتم استلام مبلغ {{amount}} للطالب {{student_name}} بإيصال رقم {{receipt_number}}.\nشكراً لكم — {{center_name}}.",
    en: "Dear {{parent_name}},\nWe have received a payment of {{amount}} for {{student_name}} (receipt {{receipt_number}}).\nThank you — {{center_name}}."
  },
  {
    key: "exam.result",
    type: "EXAM",
    name: "Exam result",
    ar: "عزيزي {{parent_name}},\nنتيجة الطالب {{student_name}} في اختبار {{exam_name}} ({{subject_name}}): {{score}} من {{max_score}} ({{percentage}}%).\nمع تحيات {{center_name}}.",
    en: "Dear {{parent_name}},\n{{student_name}} scored {{score}} out of {{max_score}} ({{percentage}}%) in the {{exam_name}} {{subject_name}} exam.\nThank you — {{center_name}}."
  },
  {
    key: "general.announcement",
    type: "ADMINISTRATIVE",
    name: "General announcement",
    ar: "{{message}}\n\n{{center_name}}",
    en: "{{message}}\n\n{{center_name}}"
  }
];
