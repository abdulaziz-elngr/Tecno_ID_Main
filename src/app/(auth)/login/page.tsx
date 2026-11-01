"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { LanguageThemeSwitcher } from "@/components/LanguageThemeSwitcher";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? t("login.error.generic"));
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(t("login.error.generic"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-light-muted dark:bg-surface-dark">
      {/* In normal flow (not absolute) so it can never overlap the card on short/small screens */}
      <div className="flex justify-end p-3 sm:p-4">
        <LanguageThemeSwitcher />
      </div>

      <div className="flex flex-1 items-center justify-center p-4 pt-0 sm:pt-4">
      <div className="card w-full max-w-sm p-5 sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Image src="/logo.png" alt="Tecno" width={140} height={70} priority />
          <h1 className="text-lg font-bold">{t("login.title")}</h1>
          <p className="text-sm text-black/60 dark:text-white/60">{t("login.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              {t("login.email")}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              {t("login.password")}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                className="input pe-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                aria-pressed={showPassword}
                title={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
              >
                {showPassword ? (
                  /* eye-off */
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  /* eye */
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? t("common.loading") : t("login.submit")}
          </button>
        </form>
      </div>
      </div>
    </div>
  );
}
