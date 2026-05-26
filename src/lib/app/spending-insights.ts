/**
 * Month-over-month spending insights (US-INSIGHT) — pure bigint money math, no
 * storage/UI dependency. Built on the signed-off `spendingByCategoryByMonth`
 * (spending-summary.ts): given this period's and the previous period's
 * per-category spend, compute the per-category change and rank the biggest movers.
 *
 * This compares the user's OWN category totals across two periods (like the
 * merchant-trends self-comparison) — it is NOT amount-based classification; we
 * never infer a transaction's meaning from its size. Money is integer cents
 * (bigint) throughout (Principle II). The percentage is a DISPLAY number only
 * (Number), like the existing budget/trends percentages — never used for money
 * arithmetic or storage.
 *
 * Sign convention: the input maps hold POSITIVE spend magnitudes per category
 * (as produced by `spendingByCategory`/`spendingByCategoryByMonth`). A positive
 * `delta_minor` therefore means the user spent MORE this period than last.
 */

import { sortedMonths } from './spending-summary';

export interface CategoryDelta {
  /** Category id, or null for the uncategorized bucket. */
  category_id: string | null;
  /** This period's spend magnitude (positive cents). 0 if the category is absent this period. */
  current_minor: bigint;
  /** Previous period's spend magnitude (positive cents). 0 if absent last period. */
  previous_minor: bigint;
  /** current − previous (signed cents). Positive ⇒ spent MORE this period. */
  delta_minor: bigint;
  /**
   * Display-only percentage change `(delta / previous) * 100`. `null` when
   * `previous_minor` is 0 (a "new" category this period — percentage is undefined,
   * the UI shows "new"). Never used for money math.
   */
  pct_change: number | null;
}

/**
 * Compare per-category spend between a current and a previous period.
 *
 * Returns one `CategoryDelta` per category present in EITHER period, sorted by
 * the magnitude of the change (biggest mover first), with a deterministic
 * tiebreak so the result never depends on input-map iteration order:
 *   |delta| desc → current desc → category_id asc (null last).
 *
 * Pure: does not mutate the inputs.
 */
export function compareCategorySpending(
  current: ReadonlyMap<string | null, bigint>,
  previous: ReadonlyMap<string | null, bigint>
): CategoryDelta[] {
  const categories = new Set<string | null>();
  for (const k of current.keys()) categories.add(k);
  for (const k of previous.keys()) categories.add(k);

  const deltas: CategoryDelta[] = [];
  for (const category_id of categories) {
    const cur = current.get(category_id) ?? 0n;
    const prev = previous.get(category_id) ?? 0n;
    const delta = cur - prev;
    // Display-only percentage. Undefined (null) when there's no prior baseline.
    const pct = prev === 0n ? null : (Number(delta) / Number(prev)) * 100;
    deltas.push({
      category_id,
      current_minor: cur,
      previous_minor: prev,
      delta_minor: delta,
      pct_change: pct
    });
  }

  deltas.sort((a, b) => {
    const ad = a.delta_minor < 0n ? -a.delta_minor : a.delta_minor;
    const bd = b.delta_minor < 0n ? -b.delta_minor : b.delta_minor;
    if (ad !== bd) return ad > bd ? -1 : 1; // bigger absolute change first
    if (a.current_minor !== b.current_minor) return a.current_minor > b.current_minor ? -1 : 1;
    return categoryIdRank(a.category_id).localeCompare(categoryIdRank(b.category_id));
  });
  return deltas;
}

/** Total order helper for category ids: null sorts last (after any real id). */
function categoryIdRank(id: string | null): string {
  return id === null ? '￿' : id;
}

/**
 * Pick the two most recent month buckets from a `spendingByCategoryByMonth`
 * result (outer key 'YYYY-MM'). Returns null when fewer than two months are
 * present (nothing to compare).
 */
export function latestTwoMonthKeys(
  byMonth: ReadonlyMap<string, ReadonlyMap<string | null, bigint>>
): { current: string; previous: string } | null {
  const months = sortedMonths(byMonth);
  if (months.length < 2) return null;
  const current = months[months.length - 1]!;
  const previous = months[months.length - 2]!;
  return { current, previous };
}

export interface TopMovers {
  /** Categories that increased the most (delta > 0), biggest first. */
  increased: CategoryDelta[];
  /** Categories that decreased the most (delta < 0), biggest decrease first. */
  decreased: CategoryDelta[];
}

/**
 * Split a delta list into the top `n` increases and top `n` decreases. Categories
 * with a zero delta are omitted from both. Input order doesn't matter — each side
 * is re-sorted by the magnitude of its change.
 */
export function topMovers(deltas: readonly CategoryDelta[], n: number): TopMovers {
  const limit = n < 0 ? 0 : n;
  const increased = deltas
    .filter((d) => d.delta_minor > 0n)
    .sort((a, b) => (a.delta_minor > b.delta_minor ? -1 : a.delta_minor < b.delta_minor ? 1 : 0))
    .slice(0, limit);
  const decreased = deltas
    .filter((d) => d.delta_minor < 0n)
    .sort((a, b) => (a.delta_minor < b.delta_minor ? -1 : a.delta_minor > b.delta_minor ? 1 : 0))
    .slice(0, limit);
  return { increased, decreased };
}

/**
 * Convenience: compute the month-over-month insight for the two most recent
 * months present in a `spendingByCategoryByMonth` result. Returns null when
 * there aren't two months to compare.
 */
export function monthOverMonthInsight(
  byMonth: ReadonlyMap<string, ReadonlyMap<string | null, bigint>>
): { current: string; previous: string; deltas: CategoryDelta[] } | null {
  const keys = latestTwoMonthKeys(byMonth);
  if (keys === null) return null;
  const current = byMonth.get(keys.current) ?? new Map<string | null, bigint>();
  const previous = byMonth.get(keys.previous) ?? new Map<string | null, bigint>();
  return {
    current: keys.current,
    previous: keys.previous,
    deltas: compareCategorySpending(current, previous)
  };
}
