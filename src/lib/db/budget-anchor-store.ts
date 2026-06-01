/**
 * Persistence for the paycheck-window "anchor" (spec 002-income-pockets §6, §7.11)
 * — the single answer "which budget month does your first paycheck fund?". From
 * it, every paycheck pair is mapped to a budget month (see budget-window.ts).
 *
 * Plain localStorage (a `{year, month}` pair carries no sensitive data), shared by
 * Home, the on-upload paycheck-confirm sheet, and the /budget view (which
 * previously kept its own private copy of this).
 */
import type { BudgetAnchor } from '../app/budget-window';

const ANCHOR_KEY = 'mtrb.budget.anchor';

/** Load the stored anchor, or null if unset / unparseable. */
export function loadAnchor(): BudgetAnchor | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(ANCHOR_KEY);
  if (raw === null) return null;
  try {
    const a = JSON.parse(raw) as BudgetAnchor;
    if (Number.isInteger(a.year) && Number.isInteger(a.month) && a.month >= 1 && a.month <= 12) {
      return a;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Persist the anchor. */
export function saveAnchor(anchor: BudgetAnchor): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor));
}

/** Forget the anchor (e.g. a "redo paycheck setup" action). */
export function clearAnchor(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(ANCHOR_KEY);
}
