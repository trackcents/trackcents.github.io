// Budget-month grouping (US-P2-D, increment 2).
//
// Takes the paychecks produced by the detector (paycheck-detector.ts) and
// groups them into "budget months" — the user's real planning unit.
//
// The core insight from the user's 2026-05-23 design conversation
// (specs/001-money-tracker-mvp/design-paycheck-windows.md, "Anchoring +
// grouping"):
//
//   - Budget months are ANCHORED to the first paycheck, NOT to the calendar.
//     The user tells us, once, which budget month their FIRST detected
//     paycheck funds.  Example: a paycheck received May 23 mentally funds
//     JUNE bills — so the anchor maps that paycheck to 2026-06 even though
//     its posted_date is in May.
//
//   - From that anchor we walk forward, assigning TWO consecutive paychecks
//     to each budget month (biweekly → ~2 per month), and the budget-month
//     LABEL advances by one calendar month per window.
//
//   - A trailing odd paycheck becomes a single-paycheck, in-progress window.
//     We deliberately do NOT auto-detect "3-paycheck months" or auto-label a
//     savings paycheck here — that's deferred (the user marks a paycheck as
//     savings manually).  Grouping is purely structural.
//
// Pure function — same paychecks + anchor in, same windows out.  No side
// effects, no money arithmetic (this module never touches amounts), no I/O.

import type { Paycheck } from './paycheck-detector';

/** Two biweekly paychecks fund one budget month.  Named, not inlined, so the
 *  one place this assumption lives is obvious if we ever support a different
 *  pay cadence. */
const PAYCHECKS_PER_BUDGET_MONTH = 2;

// ── Input ──────────────────────────────────────────────────────────────────

/** The one-time setup answer: which budget month does the FIRST detected
 *  paycheck fund?  This captures the user's personal forward-offset (a late-May
 *  paycheck can fund June) without any calendar-based guessing. */
export interface BudgetAnchor {
  /** Four-digit calendar year, e.g. 2026. */
  year: number;
  /** Calendar month, 1 (January) – 12 (December). */
  month: number;
}

// ── Output ─────────────────────────────────────────────────────────────────

export interface BudgetWindow {
  /** Sequential 0-based position in chronological order. */
  index: number;
  /** The budget month this window funds, as "YYYY-MM".  Derived by advancing
   *  the anchor one calendar month per window — NOT from the paycheck dates. */
  budget_month: string;
  /** The 1 or 2 paychecks funding this window, in chronological order. */
  paychecks: Paycheck[];
  /** ISO date (YYYY-MM-DD) the window opens — its first paycheck's posted_date. */
  start_date: string;
  /** ISO date the window closes — the day BEFORE the next window opens.  null
   *  for the final window, which is still in progress (we don't yet know when
   *  the next pair of paychecks will arrive). */
  end_date: string | null;
  /** true when the window has its full complement of PAYCHECKS_PER_BUDGET_MONTH
   *  paychecks; false for a trailing single paycheck (an in-progress month). */
  complete: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Advance a (year, month) budget label by `delta` calendar months, wrapping
 *  across year boundaries in both directions. */
function addMonths(
  year: number,
  month1to12: number,
  delta: number
): { year: number; month: number } {
  const zeroBased = month1to12 - 1 + delta;
  const newYear = year + Math.floor(zeroBased / 12);
  const newMonth0 = ((zeroBased % 12) + 12) % 12;
  return { year: newYear, month: newMonth0 + 1 };
}

/** Format a (year, month) pair as a sortable "YYYY-MM" label. */
function fmtBudgetMonth(year: number, month1to12: number): string {
  return `${year}-${String(month1to12).padStart(2, '0')}`;
}

/** The ISO date one day before the given ISO date.  Used to close a window the
 *  day before the next one opens. */
function isoMinusOneDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Main grouper ──────────────────────────────────────────────────────────────

/**
 * Group detected paychecks into anchored budget-month windows.
 *
 * @param paychecks  Paychecks from the detector.  Assumed (and re-sorted here
 *                   to be safe) in chronological order by posted_date.
 * @param anchor     Which budget month the FIRST paycheck funds.
 * @returns          One BudgetWindow per pair of paychecks, in chronological
 *                   order.  Empty input → empty array.
 * @throws           If the anchor month is out of the 1–12 range — a bad anchor
 *                   would silently mislabel every window, so we refuse it loudly
 *                   rather than produce wrong budget months.
 */
export function groupIntoBudgetWindows(
  paychecks: Paycheck[],
  anchor: BudgetAnchor
): BudgetWindow[] {
  if (!Number.isInteger(anchor.month) || anchor.month < 1 || anchor.month > 12) {
    throw new Error(
      `groupIntoBudgetWindows: anchor.month must be an integer 1-12, got ${anchor.month}`
    );
  }
  if (!Number.isInteger(anchor.year) || anchor.year < 1970 || anchor.year > 9999) {
    throw new Error(
      `groupIntoBudgetWindows: anchor.year must be a 4-digit integer, got ${anchor.year}`
    );
  }
  if (paychecks.length === 0) return [];

  // Defensive: never trust caller ordering for a money-planning view.  Ties on
  // posted_date (e.g. a split direct deposit landing twice on one day) break
  // deterministically by import_index then transaction_index, so the output is
  // a pure function of the paychecks' CONTENT, not their input array order.
  const sorted = [...paychecks].sort((a, b) => {
    if (a.posted_date !== b.posted_date) return a.posted_date < b.posted_date ? -1 : 1;
    if (a.import_index !== b.import_index) return a.import_index - b.import_index;
    return a.transaction_index - b.transaction_index;
  });

  // Chunk into consecutive pairs.
  const windows: BudgetWindow[] = [];
  for (let i = 0; i < sorted.length; i += PAYCHECKS_PER_BUDGET_MONTH) {
    const slice = sorted.slice(i, i + PAYCHECKS_PER_BUDGET_MONTH);
    const index = windows.length;
    const bm = addMonths(anchor.year, anchor.month, index);
    windows.push({
      index,
      budget_month: fmtBudgetMonth(bm.year, bm.month),
      paychecks: slice,
      start_date: slice[0]!.posted_date,
      end_date: null, // filled in below once we know the next window's start
      complete: slice.length === PAYCHECKS_PER_BUDGET_MONTH
    });
  }

  // Close each window the day before the next one opens.  The last window
  // stays open (end_date = null) — it's the in-progress budget month.
  // Clamp to never invert: if the next window opens on the SAME day (only
  // possible when 3+ paychecks share one date), the naive "day before" would
  // fall before this window's own start_date, so pin end_date to start_date.
  // A window may be zero-length but never inverted (start_date <= end_date).
  for (let i = 0; i < windows.length - 1; i++) {
    const end = isoMinusOneDay(windows[i + 1]!.start_date);
    windows[i]!.end_date = end < windows[i]!.start_date ? windows[i]!.start_date : end;
  }

  return windows;
}
