"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { currentMonth } from "@/lib/client";

const YEARS_BACK = 5;
const YEARS_AHEAD = 2;

/**
 * Month + year selector that replaces <input type="month">.
 * The user first picks the month by name (January, February…) and then the
 * year. The value stays the same "YYYY-MM" string the pages already use, so
 * it is a drop-in replacement.
 */
export function MonthYearPicker({
  id,
  value,
  onChange,
  className = ""
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { locale } = useI18n();

  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  const fallback = currentMonth();
  const [yearStr, monthStr] = (match ? value : fallback).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { month: "long", timeZone: "UTC" });
    return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2026, i, 1))));
  }, [locale]);

  const years = useMemo(() => {
    const now = Number(currentMonth().slice(0, 4));
    const from = Math.min(now - YEARS_BACK, year);
    const to = Math.max(now + YEARS_AHEAD, year);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [year]);

  const emit = (y: number, m: number) => onChange(`${y}-${String(m).padStart(2, "0")}`);

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      <select id={id} className="input" value={month} onChange={(e) => emit(year, Number(e.target.value))} aria-label="Month">
        {monthNames.map((name, i) => (
          <option key={i + 1} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <select className="input" value={year} onChange={(e) => emit(Number(e.target.value), month)} aria-label="Year">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
