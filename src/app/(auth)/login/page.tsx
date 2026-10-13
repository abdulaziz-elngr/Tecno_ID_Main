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
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
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
