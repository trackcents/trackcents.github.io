/**
 * Paycheck → budget-month attribution (spec 002-income-pockets §6, §7.11).
 *
 * Ties together the existing pure pieces:
 *   detectPaychecks   → which deposits are the recurring biweekly salary
 *   groupIntoBudgetWindows(anchor) → pairs them into budget months on a FIXED
 *                       14-day grid anchored to the user's confirmation
 * and produces a `Map<transactionKey, "YYYY-MM">` so the Paychecks pocket can
 * attribute each paycheck's income to the month it FUNDS, not the calendar month
 * its date falls in (a late-April paycheck funds May, etc.).
 *
 * The grid is anchored to the user's answer, so two deposits landing close
 * together can't fool the cadence — the one ON the grid is the paycheck; the
 * other falls off and is left for the income editor to label (it never becomes a
 * second paycheck here). Pure; no I/O; no Date.now().
 */
import type { ImportRecord } from '../db/store';
import type { ImportSuccess } from './import';
import { detectPaychecks, type Paycheck } from './paycheck-detector';
import { groupIntoBudgetWindows, type BudgetAnchor } from './budget-window';
import { transactionCategoryKey } from './categorization';

/** ImportRecord carries every field detectPaychecks reads — a safe widening. */
function asImportSuccess(imports: ImportRecord[]): ImportSuccess[] {
  return imports as unknown as ImportSuccess[];
}

/** The detected paychecks, newest first (for the confirm sheet's "latest N"). */
export function detectedPaychecksNewestFirst(imports: ImportRecord[]): Paycheck[] {
  return [...detectPaychecks(asImportSuccess(imports)).paychecks].sort((a, b) =>
    a.posted_date < b.posted_date ? 1 : a.posted_date > b.posted_date ? -1 : 0
  );
}

/**
 * A reasonable DEFAULT anchor from the first detected paycheck: a paycheck in the
 * last ~third of a month is usually "for next month" (Hemanth's Apr 24 → May),
 * so day ≥ 21 nudges the suggestion to the next calendar month. Always editable.
 */
export function smartDefaultAnchor(firstPaycheck: Paycheck | undefined): BudgetAnchor | null {
  if (firstPaycheck === undefined) return null;
  const y = Number.parseInt(firstPaycheck.posted_date.slice(0, 4), 10);
  const m = Number.parseInt(firstPaycheck.posted_date.slice(5, 7), 10);
  const d = Number.parseInt(firstPaycheck.posted_date.slice(8, 10), 10);
  if (d >= 21) {
    return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  }
  return { year: y, month: m };
}

/**
 * Map every detected paycheck's transaction key → the budget month it funds,
 * given the user's anchor. Empty when no anchor or no paychecks. The map only
 * contains SALARY deposits, so callers can do `map.get(key) ?? calendarMonth`.
 */
export function paycheckBudgetMonths(
  imports: ImportRecord[],
  anchor: BudgetAnchor | null
): Map<string, string> {
  const out = new Map<string, string>();
  if (anchor === null) return out;
  const paychecks = detectPaychecks(asImportSuccess(imports)).paychecks;
  if (paychecks.length === 0) return out;
  const windows = groupIntoBudgetWindows(paychecks, anchor);
  for (const w of windows) {
    for (const p of w.paychecks) {
      const imp = imports[p.import_index];
      if (imp === undefined) continue;
      out.set(transactionCategoryKey(imp.pdf_source_hash, p.transaction_index), w.budget_month);
    }
  }
  return out;
}
