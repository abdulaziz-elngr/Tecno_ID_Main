"use client";

import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import { useEffect, useState } from "react";

export function LanguageThemeSwitcher() {
  const { locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // لتفادي مشاكل Hydration Mismatch الخاصة بـ useTheme في Next.js
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex items-center gap-2">
      {/* اختيار اللغة */}
      <select
        aria-label="Language"
        value={locale}
        onChange={(e) => setLocale(e.target.value as "ar" | "en")}
        className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10 dark:bg-zinc-900 dark:text-white"
      >
        <option value="ar">العربية</option>
        <option value="en">English</option>
      </select>

      {/* محول الثيمات بأيقونات SVG */}
      {mounted && (
        <div className="flex items-center rounded-lg border border-black/10 p-0.5 dark:border-white/10 bg-transparent">
          <button
            type="button"
            onClick={() => setTheme("light")}
            aria-label="Light theme"
            className={`rounded-md p-1.5 transition-colors ${
              theme === "light"
                ? "bg-black/10 text-black dark:bg-white/20 dark:text-white"
                : "text-zinc-500 hover:text-black dark:hover:text-white"
            }`}
          >
            <SunIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setTheme("dark")}
            aria-label="Dark theme"
            className={`rounded-md p-1.5 transition-colors ${
              theme === "dark"
                ? "bg-black/10 text-black dark:bg-white/20 dark:text-white"
                : "text-zinc-500 hover:text-black dark:hover:text-white"
            }`}
          >
            <MoonIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setTheme("system")}
            aria-label="System theme"
            className={`rounded-md p-1.5 transition-colors ${
              theme === "system"
                ? "bg-black/10 text-black dark:bg-white/20 dark:text-white"
                : "text-zinc-500 hover:text-black dark:hover:text-white"
            }`}
          >
            <MonitorIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

{/* أيقونات SVG متناسقة */}
function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}
