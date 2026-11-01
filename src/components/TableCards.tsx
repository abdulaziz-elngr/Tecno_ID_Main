"use client";

import { useEffect } from "react";

/**
 * Phones: wide data tables are shown as stacked "cards" (see `.cards-table`
 * in globals.css) instead of a sideways-scrolling grid. A card needs each
 * value to know its column title, so this component copies the header text
 * onto every cell as `data-label`.
 *
 * It targets every table that declares a minimum width (`min-w-[...]`) —
 * i.e. exactly the wide tables — and keeps new rows labelled as data loads,
 * so individual pages need no changes. Small tables (receipts, 2–3 column
 * summaries) are left alone.
 */
const SELECTOR = 'table[class*="min-w-["]';

function labelTable(table: HTMLTableElement) {
  table.classList.add("cards-table");

  const headRow = table.tHead?.rows[0];
  if (!headRow) return;

  const labels: string[] = [];
  for (const th of Array.from(headRow.cells)) {
    const text = (th.textContent ?? "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < th.colSpan; i++) labels.push(i === 0 ? text : "");
  }

  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        const label = cell.colSpan > 1 ? "" : (labels[col] ?? "");
        if (label) {
          if (cell.dataset.label !== label) cell.dataset.label = label;
        } else if (cell.dataset.label !== undefined) {
          delete cell.dataset.label;
        }
        col += cell.colSpan;
      }
    }
  }
}

function labelAll() {
  document.querySelectorAll<HTMLTableElement>(SELECTOR).forEach(labelTable);
}

export function TableCards() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(labelAll);
    };

    labelAll();
    // Only child additions/removals (new rows, new tables). Setting an
    // attribute does not re-trigger this, so there is no feedback loop.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
