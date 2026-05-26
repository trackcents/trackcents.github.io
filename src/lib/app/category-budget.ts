/**
 * Per-category monthly budgets (US-P4-A) — pure logic.
 *
 * The user sets a monthly spending LIMIT per category; this computes how much
 * they've spent toward each limit and flags over-budget. NO amount-based
 * classification — the user chooses the limits; we only compare their spend to
 * their own limit (memory `feedback_no_amount_based_classification`). Money is
 * bigint cents (constitution II); `pct` is a float for DISPLAY only.
 *
 * Refund-aware: it consumes the SAME `SummaryTransaction[]` that the dashboard
 * uses, where `summaryFromImports` has already relabeled a refund to its original
 * purchase's category. So a signed sum per category nets a refund against the
 * purchase before we take the spending magnitude — a $50 buy + $20 refund counts
 * as $30 toward the budget.
 */
import type { SummaryTransaction } from './spending-summary';

export interface CategoryBudget {
  category_id: string;
  /** The user's monthly limit (positive cents). */
  limit_minor: bigint;
  /** Net spending toward this category this period (≥ 0n). */
  spent_minor: bigint;
  /** limit − spent; negative means over budget. */
  remaining_minor: bigint;
  /** spent / limit × 100 for the progress bar (0 when limit is 0). */
  pct: number;
  /** True when spent strictly exceeds the limit. */
  over: boolean;
}

/**
 * Net spending per category: signed sum per category, then the spending
 * magnitude = max(0, −sum). A category whose inflows (incl. refunds relabeled to
 * it) exceed its outflows nets to 0 spending, never negative. Pure.
 */
export function netSpendingByCategory(
  txns: readonly SummaryTransaction[]
): Map<string | null, bigint> {
  const signed = new Map<string | null, bigint>();
  for (const t of txns) {
    signed.set(t.category_id, (signed.get(t.category_id) ?? 0n) + t.amount_minor);
  }
  const spending = new Map<string | null, bigint>();
  for (const [cat, sum] of signed) {
    spending.set(cat, sum < 0n ? -sum : 0n);
  }
  return spending;
}

/**
 * One budget row per category that has a positive limit, sorted by how close to
 * (or over) the limit it is — most-over first, so the at-risk categories surface.
 * Non-positive limits are ignored (a 0 limit means "no budget set"). Pure.
 */
export function computeCategoryBudgets(
  limits: Record<string, bigint>,
  txns: readonly SummaryTransaction[]
): CategoryBudget[] {
  const spending = netSpendingByCategory(txns);
  const rows: CategoryBudget[] = [];
  for (const [category_id, limit_minor] of Object.entries(limits)) {
    if (limit_minor <= 0n) continue;
    const spent_minor = spending.get(category_id) ?? 0n;
    rows.push({
      category_id,
      limit_minor,
      spent_minor,
      remaining_minor: limit_minor - spent_minor,
      pct: (Number(spent_minor) / Number(limit_minor)) * 100,
      over: spent_minor > limit_minor
    });
  }
  return rows.sort((a, b) => {
    if (a.pct !== b.pct) return b.pct - a.pct; // most-over / closest first
    return a.category_id < b.category_id ? -1 : a.category_id > b.category_id ? 1 : 0;
  });
}

/** Sum of all limits and all spending toward them (for a header total). */
export function budgetTotals(rows: readonly CategoryBudget[]): {
  limit_minor: bigint;
  spent_minor: bigint;
  remaining_minor: bigint;
} {
  let limit = 0n;
  let spent = 0n;
  for (const r of rows) {
    limit += r.limit_minor;
    spent += r.spent_minor;
  }
  return { limit_minor: limit, spent_minor: spent, remaining_minor: limit - spent };
}
