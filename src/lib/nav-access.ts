/**
 * Which permission(s) a dashboard page needs — used ONLY to hide menu entries and
 * to bounce people away from pages they cannot use. It is a convenience, not a
 * security boundary: every API route still enforces the permission on the server.
 *
 * A user may open a page when they hold AT LEAST ONE of its `any` keys.
 * The most specific (longest) matching rule wins; pages without a rule are open
 * to every signed-in user (e.g. the dashboard home).
 */
export interface AccessRule {
  path: string;
  /** Match only this exact path (not its sub-pages). */
  exact?: boolean;
  any: readonly string[];
}

export const ACCESS_RULES: readonly AccessRule[] = [
  { path: "/dashboard/students", any: ["students.view"] },
  { path: "/dashboard/parents", any: ["parents.view"] },
  { path: "/dashboard/teachers", any: ["teachers.view"] },
  { path: "/dashboard/employees", any: ["employees.view"] },

  // Read-only for the accountant (payments.view); the page hides the edit buttons without academic.groups.manage.
  { path: "/dashboard/academic", exact: true, any: ["academic.groups.manage", "payments.view"] },
  { path: "/dashboard/academic/stages", any: ["academic.stages.manage"] },
  { path: "/dashboard/academic/grades", any: ["academic.grades.manage"] },
  { path: "/dashboard/academic/subjects", any: ["academic.subjects.manage"] },
  { path: "/dashboard/academic/groups", any: ["academic.groups.manage", "students.view", "sessions.view"] },
  { path: "/dashboard/academic/lesson-formation", any: ["sessions.create", "lessons.plan"] },
  { path: "/dashboard/academic/sessions", any: ["sessions.view"] },

  { path: "/dashboard/attendance/scan", any: ["attendance.create"] },
  { path: "/dashboard/attendance/employees", any: ["employees.attendance.view"] },

  { path: "/dashboard/performance/exams", any: ["exams.view"] },
  { path: "/dashboard/performance/recitation", any: ["recitation.view"] },
  { path: "/dashboard/performance/assignments", any: ["assignments.view"] },
  { path: "/dashboard/performance/students", any: ["performance.view"] },

  { path: "/dashboard/finance/subscriptions", any: ["subscriptions.view"] },
  { path: "/dashboard/finance/payments", any: ["payments.view"] },
  { path: "/dashboard/finance/records", any: ["payments.view"] },
  { path: "/dashboard/finance/invoices", any: ["invoices.view"] },
  { path: "/dashboard/finance/deductions", any: ["deductions.view"] },
  { path: "/dashboard/finance/books", any: ["books.view"] },

  { path: "/dashboard/communication/notifications", any: ["notifications.view"] },
  { path: "/dashboard/communication/templates", any: ["whatsapp.view"] },

  { path: "/dashboard/reports", any: ["reports.view", "reports.financial.view"] },
  { path: "/dashboard/users", any: ["users.manage"] },
  { path: "/dashboard/audit-logs", any: ["audit_logs.view"] },
  { path: "/dashboard/settings", any: ["settings.manage"] }
];

function matches(rule: AccessRule, pathname: string): boolean {
  if (rule.exact) return pathname === rule.path;
  return pathname === rule.path || pathname.startsWith(`${rule.path}/`);
}

export function canOpenPath(pathname: string, has: (key: string) => boolean): boolean {
  let best: AccessRule | null = null;
  for (const rule of ACCESS_RULES) {
    if (matches(rule, pathname) && (!best || rule.path.length > best.path.length)) best = rule;
  }
  return best ? best.any.some(has) : true;
}
