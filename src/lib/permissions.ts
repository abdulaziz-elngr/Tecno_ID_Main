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
  // "lessons.plan" = form (تشكيل) and delete monthly lesson plans, always limited to the
  // caller's own groups for teaching logins. Unlike "sessions.create" it cannot create
  // ad-hoc sessions or generate sessions for other groups.
  sessions: ["sessions.view", "sessions.create", "sessions.update", "lessons.plan"],
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
  // "خصم مبلغ": money taken out of the treasury. Totals everywhere are computed from ACTIVE rows.
  deductions: ["deductions.view", "deductions.create", "deductions.void"],
  // حجوزات الكتب والمذكرات
  books: ["books.view", "books.create", "books.update", "books.collect", "books.void"],
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
    ...PERMISSIONS.deductions,
    ...PERMISSIONS.books,
    ...PERMISSIONS.exams,
    ...PERMISSIONS.performance,
    ...PERMISSIONS.communication,
    ...PERMISSIONS.reports,
    ...PERMISSIONS.academic,
    "audit_logs.view"
  ],
  // ACCOUNTANT — everything about money, for every student / stage / group:
  // payments, subscriptions, invoices, financial reports, and the monthly price of
  // each grade (academic.fees.manage). To work with payers he can also LOOK at
  // students, their parents and the groups (read-only: no students.update / create /
  // delete, no academic.groups.manage). No attendance, exams or teacher access.
  ACCOUNTANT: [
    ...PERMISSIONS.payments,
    ...PERMISSIONS.deductions,
    ...PERMISSIONS.books,
    "academic.fees.manage",
    "students.view",
    "parents.view",
    "reports.financial.view",
    "reports.export"
  ],
  // TEACHER — own groups only (enforced in src/lib/group-access.ts).
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
  // TEACHER_ASSISTANT — everything about the group(s) he is responsible for:
  // attendance, recitation, homework, exams/grades and student performance.
  // Never finance, users, settings or other groups (group scoping is enforced
  // on the server by resolveOwnGroupIds in src/lib/group-access.ts).
  TEACHER_ASSISTANT: [
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
    // Forms the monthly lessons (تشكيل الحصص) of his own group(s) only.
    "lessons.plan"
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
    "notifications.view",
    // Books: can look at reservations and collect money, never create/void.
    "books.view",
    "books.collect"
  ],
  ATTENDANCE_OPERATOR: ["students.view", "sessions.view", "attendance.view", "attendance.create"],
  PARENT: [],
  STUDENT: []
};

export const DEFAULT_ROLE_NAMES = Object.keys(DEFAULT_ROLE_PERMISSIONS);
