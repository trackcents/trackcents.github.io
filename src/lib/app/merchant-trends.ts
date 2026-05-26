/**
 * Merchant spend & price-trend tracking (US-PW-A/B) — pure logic.
 *
 * Adapted from the user's cousin's "pricewatch" app. pricewatch tracks the unit
 * price of *items* over time, which needs itemised receipts; bank / credit-card
 * statements only carry the *merchant-level total per visit*. So this module tracks
 * how the amount paid to a given MERCHANT trends over time, and flags the biggest
 * "price jumps" in recurring charges (e.g. a subscription that went $15.99 → $17.99).
 *
 * Constitution / project rule (memory `feedback_no_amount_based_classification`): we
 * NEVER infer a transaction's meaning from its size. Every comparison here is a
 * merchant measured against ITS OWN past charges — structure, not size-as-meaning.
 *
 * Grouping uses the same `normalizeDescriptor` as the recurring detector so "NETFLIX
 * #1234" and "Netflix.com" collapse to one merchant. Only OUTFLOWS (spending) are
 * considered; inflows (deposits/refunds) are excluded from price tracking.
 */
import { normalizeDescriptor } from './paycheck-detector';

export interface MerchantTxn {
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // signed cents; outflow < 0
  description: string;
}

export interface MerchantTrend {
  /** Normalized descriptor key (what we grouped on). */
  merchant_key: string;
  /** Representative human-readable name (the most recent original description). */
  display_name: string;
  occurrences: number;
  /** Sum of charge magnitudes (always ≥ 0). */
  total_spent_minor: bigint;
  /** Mean charge magnitude, rounded to the nearest cent. */
  average_amount_minor: bigint;
  first_date: string;
  last_date: string;
  /** Magnitude of the earliest charge. */
  first_amount_minor: bigint;
  /** Magnitude of the most recent charge. */
  last_amount_minor: bigint;
  /** Magnitude of the charge immediately before the most recent (null if only one). */
  previous_amount_minor: bigint | null;
  /** last − previous (signed; positive = the charge got more expensive). 0n if no previous. */
  jump_minor: bigint;
  /** Percent change of the latest charge vs the previous one, or null if no previous. */
  jump_pct: number | null;
}

export interface LargestPurchase {
  posted_date: string;
  description: string;
  amount_minor: bigint; // magnitude (≥ 0)
}

export interface TrendOptions {
  /** Only include transactions on/after this ISO date (inclusive). Omit for all-time. */
  since?: string;
}

function magnitude(amount: bigint): bigint {
  return amount < 0n ? -amount : amount;
}

/** Round a bigint division (a / b) to nearest, b > 0. */
function divRound(a: bigint, b: bigint): bigint {
  return (a + b / 2n) / b;
}

/** Outflow charges only, optionally windowed, grouped by normalized merchant. */
function groupMerchants(
  txns: readonly MerchantTxn[],
  opts: TrendOptions
): Map<string, MerchantTxn[]> {
  const groups = new Map<string, MerchantTxn[]>();
  for (const t of txns) {
    if (t.amount_minor >= 0n) continue; // spending only
    if (opts.since !== undefined && t.posted_date < opts.since) continue;
    const key = normalizeDescriptor(t.description);
    if (key === '') continue;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [t]);
    else g.push(t);
  }
  return groups;
}

/**
 * One trend per merchant with ≥ 2 outflow charges (a single charge can't trend).
 * Sorted by total spent, descending.
 */
export function merchantTrends(
  txns: readonly MerchantTxn[],
  opts: TrendOptions = {}
): MerchantTrend[] {
  const groups = groupMerchants(txns, opts);
  const out: MerchantTrend[] = [];

  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    // Order by date, then a deterministic tiebreak (amount, then description) so
    // same-day charges have NO input-order dependence — the same data imported in
    // a different order must yield identical trends (INV4 permutation invariance;
    // DECISIONS D13). Same-day charges have no true temporal order, so any total
    // order is defensible; determinism is what matters for a finance tool.
    const sorted = [...group].sort((a, b) => {
      if (a.posted_date !== b.posted_date) return a.posted_date < b.posted_date ? -1 : 1;
      if (a.amount_minor !== b.amount_minor) return a.amount_minor < b.amount_minor ? -1 : 1;
      return a.description < b.description ? -1 : a.description > b.description ? 1 : 0;
    });
    const mags = sorted.map((t) => magnitude(t.amount_minor));
    const total = mags.reduce((s, m) => s + m, 0n);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const lastMag = mags[mags.length - 1]!;
    const prevMag = mags.length >= 2 ? mags[mags.length - 2]! : null;
    const jump = prevMag === null ? 0n : lastMag - prevMag;
    const jumpPct =
      prevMag === null || prevMag === 0n ? null : (Number(jump) / Number(prevMag)) * 100;

    out.push({
      merchant_key: key,
      display_name: last.description,
      occurrences: sorted.length,
      total_spent_minor: total,
      average_amount_minor: divRound(total, BigInt(sorted.length)),
      first_date: first.posted_date,
      last_date: last.posted_date,
      first_amount_minor: mags[0]!,
      last_amount_minor: lastMag,
      previous_amount_minor: prevMag,
      jump_minor: jump,
      jump_pct: jumpPct
    });
  }

  return out.sort((a, b) =>
    a.total_spent_minor < b.total_spent_minor
      ? 1
      : a.total_spent_minor > b.total_spent_minor
        ? -1
        : a.merchant_key < b.merchant_key
          ? -1
          : 1
  );
}

/**
 * Recurring merchants whose most recent charge differs from the one before it,
 * ranked by the SIZE of the change (biggest price jump first). This surfaces
 * "your subscription/bill went up" without any amount-based meaning inference —
 * each merchant is only ever compared to its own prior charge.
 */
export function priceJumps(txns: readonly MerchantTxn[], opts: TrendOptions = {}): MerchantTrend[] {
  return merchantTrends(txns, opts)
    .filter((m) => m.jump_minor !== 0n)
    .sort((a, b) => {
      const pa = a.jump_pct === null ? 0 : Math.abs(a.jump_pct);
      const pb = b.jump_pct === null ? 0 : Math.abs(b.jump_pct);
      if (pa !== pb) return pb - pa;
      const ja = magnitude(a.jump_minor);
      const jb = magnitude(b.jump_minor);
      return ja < jb ? 1 : ja > jb ? -1 : 0;
    });
}

/** Merchants ranked by how often they were charged (most frequent first). */
export function frequentMerchants(
  txns: readonly MerchantTxn[],
  opts: TrendOptions = {}
): MerchantTrend[] {
  return merchantTrends(txns, opts).sort((a, b) =>
    a.occurrences !== b.occurrences
      ? b.occurrences - a.occurrences
      : a.total_spent_minor < b.total_spent_minor
        ? 1
        : a.total_spent_minor > b.total_spent_minor
          ? -1
          : 0
  );
}

/**
 * The single largest outflow transactions (by magnitude), windowed, capped at
 * `limit` (default 10). Pure sort — no merchant grouping, no classification.
 */
export function largestPurchases(
  txns: readonly MerchantTxn[],
  opts: TrendOptions & { limit?: number } = {}
): LargestPurchase[] {
  const limit = opts.limit ?? 10;
  const rows: LargestPurchase[] = [];
  for (const t of txns) {
    if (t.amount_minor >= 0n) continue;
    if (opts.since !== undefined && t.posted_date < opts.since) continue;
    rows.push({
      posted_date: t.posted_date,
      description: t.description,
      amount_minor: magnitude(t.amount_minor)
    });
  }
  // Full total order (magnitude desc → date desc → description) so the result
  // never depends on input order for equal-magnitude rows (DECISIONS D13).
  rows.sort((a, b) => {
    if (a.amount_minor !== b.amount_minor) return a.amount_minor < b.amount_minor ? 1 : -1;
    if (a.posted_date !== b.posted_date) return a.posted_date < b.posted_date ? 1 : -1;
    return a.description < b.description ? -1 : a.description > b.description ? 1 : 0;
  });
  return rows.slice(0, limit);
}
