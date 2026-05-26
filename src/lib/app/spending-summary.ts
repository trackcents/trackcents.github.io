/**
 * Spending-summary aggregation (US-P2-B dashboards) — pure bigint money math,
 * no storage/UI dependency. Feeds three charts: spending-by-category (pie),
 * spending-by-category-over-time (stacked), and net cash flow per month (line).
 *
 * Money is integer minor units (cents) as bigint throughout (Principle II) — no
 * floats ever. Sign convention (matches the adapters / transaction-stream):
 *   amount_minor < 0  → money OUT (purchase, fee, spending)
 *   amount_minor > 0  → money IN  (deposit, payment, refund)
 *
 * v1 scope note: these sums assume a SINGLE home currency. Mixing currencies in a
 * sum would be wrong; multi-currency dashboards need fx conversion, which is
 * deferred (spec US-P3-F). The caller passes transactions already in one currency.
 */

export interface SummaryTransaction {
  posted_date: string; // ISO YYYY-MM-DD (only the YYYY-MM prefix is used for bucketing)
  amount_minor: bigint;
  category_id: string | null;
}

export interface CashFlow {
  /** Sum of inflows (amount > 0), as a positive magnitude. */
  inflow_minor: bigint;
  /** Sum of outflows (amount < 0), as a POSITIVE magnitude. */
  outflow_minor: bigint;
  /** inflow − outflow == the signed sum of all amounts. */
  net_minor: bigint;
}

/** Bucket key 'YYYY-MM' from an ISO date. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Overall inflow / outflow / net across all transactions. */
export function summarize(txns: readonly SummaryTransaction[]): CashFlow {
  let inflow = 0n;
  let outflow = 0n;
  for (const t of txns) {
    if (t.amount_minor > 0n) inflow += t.amount_minor;
    else if (t.amount_minor < 0n) outflow += -t.amount_minor;
  }
  return { inflow_minor: inflow, outflow_minor: outflow, net_minor: inflow - outflow };
}

/**
 * Spending (outflow magnitude) grouped by category. Inflows are excluded — this
 * is the "where did my money go" view. A null category id is the uncategorized
 * bucket. Values are positive bigint magnitudes.
 */
export function spendingByCategory(
  txns: readonly SummaryTransaction[]
): Map<string | null, bigint> {
  const out = new Map<string | null, bigint>();
  for (const t of txns) {
    if (t.amount_minor >= 0n) continue; // inflows are not spending
    const magnitude = -t.amount_minor;
    out.set(t.category_id, (out.get(t.category_id) ?? 0n) + magnitude);
  }
  return out;
}

/** Cash flow per calendar month, keyed 'YYYY-MM'. */
export function netByMonth(txns: readonly SummaryTransaction[]): Map<string, CashFlow> {
  const byMonth = new Map<string, SummaryTransaction[]>();
  for (const t of txns) {
    const key = monthKey(t.posted_date);
    const bucket = byMonth.get(key);
    if (bucket === undefined) byMonth.set(key, [t]);
    else bucket.push(t);
  }
  const result = new Map<string, CashFlow>();
  for (const [key, bucket] of byMonth) result.set(key, summarize(bucket));
  return result;
}

/**
 * Spending (outflow magnitude) per category, per month — the data behind a
 * stacked area/bar chart. Outer key 'YYYY-MM', inner key category id (or null).
 */
export function spendingByCategoryByMonth(
  txns: readonly SummaryTransaction[]
): Map<string, Map<string | null, bigint>> {
  const result = new Map<string, Map<string | null, bigint>>();
  for (const t of txns) {
    if (t.amount_minor >= 0n) continue;
    const key = monthKey(t.posted_date);
    let inner = result.get(key);
    if (inner === undefined) {
      inner = new Map<string | null, bigint>();
      result.set(key, inner);
    }
    inner.set(t.category_id, (inner.get(t.category_id) ?? 0n) - t.amount_minor);
  }
  return result;
}

/** Sorted 'YYYY-MM' keys ascending — convenient for time-axis chart rendering. */
export function sortedMonths(byMonth: ReadonlyMap<string, unknown>): string[] {
  return [...byMonth.keys()].sort();
}
