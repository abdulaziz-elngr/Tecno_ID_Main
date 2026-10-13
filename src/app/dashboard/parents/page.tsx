"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/client";
import { buildWhatsAppLink } from "@/lib/wa-link";

interface ParentRow {
  id: string;
  fullName: string;
  phone: string;
  whatsappNumber: string | null;
  preferredLanguage: string;
  students: { relationship: string; student: { id: string; fullName: string; studentCode: string } }[];
}

interface ListResponse {
  data: ParentRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface GroupOption {
  id: string;
  name: string;
  grade?: { id: string; name: string } | null;
}

export default function ParentsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Real groups from the database (GET /api/groups is readable by every role that can open this page).
  const { data: groups } = useApi<GroupOption[]>("/api/groups");
  const groupLabel = (g: GroupOption) => (g.grade?.name ? `${g.name} — ${g.grade.name}` : g.name);

  // Search, group filter and pagination share one request, so they always combine.
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());
    if (groupFilter) params.set("groupId", groupFilter);

    const controller = new AbortController();
    fetch(`/api/parents?${params.toString()}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to load parents.");
        }
        return r.json();
      })
      .then(setResult)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search, groupFilter, page]);

  const filtering = search.trim() !== "" || groupFilter !== "";

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{t("parents.title")}</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder={t("parents.search")}
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="input w-auto min-w-[12rem]"
          aria-label={t("students.filterByGroup")}
          value={groupFilter}
          onChange={(e) => {
            setPage(1);
            setGroupFilter(e.target.value);
          }}
        >
          <option value="">{t("students.allGroups")}</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {groupLabel(g)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-start text-sm">
          <thead className="border-b border-black/5 text-black/60 dark:border-white/10 dark:text-white/60">
            <tr>
              <th className="p-3 text-start">{t("parents.title")}</th>
              <th className="p-3 text-start">{t("parents.phone")}</th>
              <th className="p-3 text-start">{t("parents.whatsapp")}</th>
              <th className="p-3 text-start">{t("parents.students")}</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-black/5 dark:border-white/5">
                  <td className="p-3" colSpan={4}>
                    <span className="block h-4 w-full animate-pulse rounded bg-black/10 dark:bg-white/10" />
                  </td>
                </tr>
              ))}

            {!loading && result?.data.length === 0 && (
              <tr>
                <td className="p-6 text-center text-black/50 dark:text-white/50" colSpan={4}>
                  {filtering ? t("parents.emptyFiltered") : t("parents.empty")}
                </td>
              </tr>
            )}

            {!loading &&
              result?.data.map((p) => {
                // Only the NUMBER is stored; the chat link is built here (wa.me), never saved.
                const whatsappLink = buildWhatsAppLink(p.whatsappNumber || p.phone);
                return (
                  <tr key={p.id} className="border-b border-black/5 dark:border-white/5">
                    <td className="p-3 font-medium">{p.fullName}</td>
                    <td className="p-3" dir="ltr">
                      <span className="inline-block">{p.phone}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span dir="ltr">{p.whatsappNumber ?? "—"}</span>
                        {whatsappLink ? (
                          <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${t("parents.whatsappOpen")} — ${p.fullName}`}
                            title={t("parents.whatsappOpen")}
                            className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                          >
                            {t("parents.whatsapp")}
                          </a>
                        ) : (
                          <span
                            role="img"
                            aria-disabled="true"
                            aria-label={t("parents.whatsappInvalid")}
                            title={t("parents.whatsappInvalid")}
                            className="cursor-not-allowed rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium opacity-40 dark:border-white/10"
                          >
                            {t("parents.whatsapp")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      {p.students.map((s) => (
                        <span
                          key={s.student.id}
                          className="me-1 inline-block rounded-full bg-tecno-gold/15 px-2 py-0.5 text-xs text-tecno-gold-dark dark:text-tecno-gold"
                          title={s.relationship}
                        >
                          {s.student.fullName}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {result && result.pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            ‹
          </button>
          <span className="text-sm">
            {result.pagination.page} / {result.pagination.totalPages}
          </span>
          <button
            disabled={page >= result.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
