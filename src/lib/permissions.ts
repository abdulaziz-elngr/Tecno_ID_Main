/**
 * Central permission catalog for TecnoID.
 *
 * IMPORTANT: This is the single source of truth for permission keys.
 * Both the seed script and every API route import from here so that
 * frontend hints and backend enforcement can never drift apart.
 */

export const PERMISSIONS = {
  students: ["students.view", "students.create", "students.update", "students.delete"],
  parents: ["parents.view", "parents.create", "parents.update"],
  teachers: ["teachers.view", "teachers.create", "teachers.update", "teachers.delete"],
  employees: [
    "employees.view",
    "employees.create",
    "employees.update",
    "employees.delete",
    "employees.attendance.view",
    "employees.attendance.manage"
  ],
  sessions: ["sessions.view", "sessions.create", "sessions.update"],
  attendance: [
    "attendance.view",
    "attendance.create",
    "attendance.update",
    "attendance.delete",
    "attendance.makeup.approve"
  ],
  payments: [
    "payments.view",
    "payments.create",
    "payments.update",
    "payments.refund",
    "payments.void",
    "payments.reprint",
    "subscriptions.view",
    "subscriptions.manage",
    "invoices.view",
    "invoices.void"
  ],
  exams: [
    "exams.view",
    "exams.create",
    "exams.update",
    "exams.publish",
    "grades.enter",
    "grades.update",
    "recitation.view",
    "recitation.manage",
    "assignments.view",
    "assignments.manage"
  ],
  performance: ["performance.view", "performance.recognize"],
  communication: [
    "notifications.view",
    "notifications.send",
    "whatsapp.view",
    "whatsapp.send",
    "whatsapp.templates.manage"
  ],
  reports: ["reports.view", "reports.financial.view", "reports.export"],
  users: ["users.manage", "roles.manage"],
  settings: ["settings.manage"],
  audit: ["audit_logs.view"],
  academic: [
    "academic.stages.manage",
    "academic.grades.manage",
    "academic.subjects.manage",
    "academic.groups.manage",
    "academic.schedule.manage",
    "academic.fees.manage"
  ]
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number];

export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSIONS).flat();

/**
 * Default roles seeded for every new organization.
 * Least-privilege by default; customizable per-organization from the
 * Users & Permissions screen.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  CENTER_OWNER: ALL_PERMISSION_KEYS,
  MANAGER: [
    ...PERMISSIONS.students,
    ...PERMISSIONS.parents,
    ...PERMISSIONS.teachers,
    ...PERMISSIONS.employees,
    ...PERMISSIONS.sessions,
    ...PERMISSIONS.attendance,
    ...PERMISSIONS.payments,
    ...PERMISSIONS.exams,
    ...PERMISSIONS.performance,
    ...PERMISSIONS.communication,
    ...PERMISSIONS.reports,
    ...PERMISSIONS.academic,
    "audit_logs.view"
  ],
  ACCOUNTANT: [
    ...PERMISSIONS.payments,
    "students.view",
    "reports.view",
    "reports.financial.view",
    "reports.export",
    "notifications.view"
  ],
  // Teachers deliberately get NO financial or user-management keys (spec §23).
  TEACHER: [
    "students.view",
    "sessions.view",
    "attendance.view",
    "attendance.create",
    "exams.view",
    "exams.create",
    "exams.update",
    "grades.enter",
    "grades.update",
    "recitation.view",
    "recitation.manage",
    "assignments.view",
    "assignments.manage",
    "performance.view",
    "performance.recognize",
    "reports.view"
  ],
  TEACHER_ASSISTANT: [
    "students.view",
    "sessions.view",
    "attendance.view",
    "attendance.create",
    "recitation.view",
    "recitation.manage"
  ],
  RECEPTIONIST: [
    "students.view",
    "students.create",
    "students.update",
    "parents.view",
    "parents.create",
    "parents.update",
    "sessions.view",
    "attendance.view",
    "attendance.create",
    "payments.view",
    "payments.create",
    "payments.reprint",
    "subscriptions.view",
    "invoices.view",
    "notifications.view"
  ],
  ATTENDANCE_OPERATOR: ["students.view", "sessions.view", "attendance.view", "attendance.create"],
  PARENT: [],
  STUDENT: []
};

export const DEFAULT_ROLE_NAMES = Object.keys(DEFAULT_ROLE_PERMISSIONS);
