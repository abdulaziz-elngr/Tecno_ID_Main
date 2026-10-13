"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { LanguageThemeSwitcher } from "./LanguageThemeSwitcher";

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
    <header className="no-print flex items-center justify-between border-b border-black/5 bg-white px-4 py-3 dark:border-white/10 dark:bg-surface-dark-muted">
      <div className="text-sm text-black/60 dark:text-white/60">
        {me ? `${me.fullName} — ${me.roles.join(", ")}` : "\u00A0"}
      </div>
      <div className="flex items-center gap-3">
        <LanguageThemeSwitcher />
        <button
          onClick={handleLogout}
          className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          {t("common.logout")}
        </button>
      </div>
    </header>
  );
}
