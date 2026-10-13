"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { LanguageThemeSwitcher } from "./LanguageThemeSwitcher";
import { OPEN_NAV_EVENT } from "./Sidebar";

interface Me {
  fullName: string;
  roles: string[];
}

export function Topbar() {
  const { t } = useI18n();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-black/5 bg-white px-3 py-2 sm:gap-3 sm:px-4 sm:py-3 dark:border-white/10 dark:bg-surface-dark-muted">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Hamburger: phones + tablets only (the sidebar is permanent from lg) */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_NAV_EVENT))}
          aria-label="Open navigation"
          className="shrink-0 rounded-lg border border-black/10 p-2 hover:bg-black/5 lg:hidden dark:border-white/10 dark:hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="min-w-0 truncate text-sm text-black/60 dark:text-white/60">
          {me ? `${me.fullName} — ${me.roles.join(", ")}` : "\u00A0"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <LanguageThemeSwitcher />
        <button
          onClick={handleLogout}
          aria-label={t("common.logout")}
          title={t("common.logout")}
          className="rounded-lg border border-black/10 px-2.5 py-1.5 text-sm font-medium hover:bg-black/5 sm:px-3 dark:border-white/10 dark:hover:bg-white/5"
        >
          {/* Icon on very small screens, text from sm up */}
          <svg viewBox="0 0 24 24" className="h-4 w-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          <span className="hidden sm:inline">{t("common.logout")}</span>
        </button>
      </div>
    </header>
  );
}
