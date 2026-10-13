"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Main navigation (spec §54).
 *
 * Grouped, collapsible on mobile, and RTL-safe (border-e / start-end
 * logical properties rather than left/right).
 */

type NavKey = Parameters<ReturnType<typeof useI18n>["t"]>[0];

interface NavItem {
  href: string;
  key: NavKey;
}

interface NavSection {
  key: NavKey;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    key: "nav.group.people",
    items: [
      { href: "/dashboard/students", key: "nav.students" },
      { href: "/dashboard/parents", key: "nav.parents" },
      { href: "/dashboard/teachers", key: "nav.teachers" },
      { href: "/dashboard/employees", key: "nav.employees" }
    ]
  },
  {
    key: "nav.group.academic",
    items: [
      { href: "/dashboard/academic/stages", key: "nav.stages" },
      { href: "/dashboard/academic/grades", key: "nav.gradesNav" },
      { href: "/dashboard/academic", key: "nav.groups" },
      { href: "/dashboard/academic/subjects", key: "nav.subjects" }
    ]
  },
  {
    key: "nav.group.attendance",
    items: [
      { href: "/dashboard/academic/lesson-formation", key: "nav.lessonFormation" },
      { href: "/dashboard/attendance/scan", key: "nav.scanner" },
      { href: "/dashboard/academic/sessions", key: "nav.sessions" },
      { href: "/dashboard/attendance/employees", key: "nav.employeeAttendance" }
    ]
  },
  {
    key: "nav.group.performance",
    items: [
      { href: "/dashboard/performance/exams", key: "nav.exams" },
      { href: "/dashboard/performance/recitation", key: "nav.recitation" },
      { href: "/dashboard/performance/assignments", key: "nav.assignments" },
      { href: "/dashboard/performance/students", key: "nav.studentPerformance" }
    ]
  },
  {
    key: "nav.group.finance",
    items: [
      { href: "/dashboard/finance/subscriptions", key: "nav.subscriptions" },
      { href: "/dashboard/finance/payments", key: "nav.payments" },
      { href: "/dashboard/finance/records", key: "nav.paymentRecords" },
      { href: "/dashboard/finance/invoices", key: "nav.invoices" }
    ]
  },
  {
    key: "nav.group.communication",
    items: [
      { href: "/dashboard/communication/notifications", key: "nav.notifications" },
      { href: "/dashboard/communication/templates", key: "nav.templates" }
    ]
  }
];

const TOP: NavItem = { href: "/dashboard", key: "nav.dashboard" };

const BOTTOM: NavItem[] = [
  { href: "/dashboard/reports", key: "nav.reports" },
  { href: "/dashboard/users", key: "nav.users" },
  { href: "/dashboard/audit-logs", key: "nav.auditLogs" },
  { href: "/dashboard/settings", key: "nav.settings" }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/dashboard/academic") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const active = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-tecno-gold/15 text-tecno-gold-dark dark:text-tecno-gold"
          : "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5"
      }`}
    >
      {t(item.key)}
    </Link>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3" aria-label="Main navigation">
      <NavLink item={TOP} onNavigate={onNavigate} />

      {SECTIONS.map((section) => (
        <div key={section.key}>
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
            {t(section.key)}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}

      <div className="space-y-0.5 border-t border-black/5 pt-3 dark:border-white/10">
        {BOTTOM.map((item) => (
          <NavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </nav>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile trigger (§51) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="no-print fixed bottom-4 start-4 z-40 rounded-full bg-tecno-gold px-4 py-3 font-semibold text-tecno-ink shadow-lg md:hidden"
      >
        ☰
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-72 flex-col bg-white dark:bg-surface-dark-muted">
            <div className="flex items-center justify-between border-b border-black/5 p-4 dark:border-white/10">
              <Image src="/logo.png" alt="Tecno" width={110} height={55} priority />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="px-2 text-xl">
                ×
              </button>
            </div>
            <NavContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <aside className="no-print hidden w-64 shrink-0 border-e border-black/5 bg-white md:flex md:flex-col dark:border-white/10 dark:bg-surface-dark-muted">
        <div className="flex items-center gap-2 border-b border-black/5 p-4 dark:border-white/10">
          <Image src="/logo.png" alt="Tecno" width={110} height={55} priority />
        </div>
        <NavContent />
      </aside>
    </>
  );
}
