/**
 * Transfer detection (US-P3-D) — pure logic.
 *
 * Money moved between the user's OWN accounts (e.g. checking → savings, or a
 * checking→checking move) is NOT spending or income — but it shows up as an
 * outflow in one account and an inflow in another, distorting cash-flow and
 * category totals. This detector pairs an outflow in account A with an
 * equal-magnitude inflow in a DIFFERENT account B within a small date window, so
 * the UI can offer to exclude both sides from spending.
 *
 * This is STRUCTURAL pairing (conservation: the same amount left A and arrived in
 * B within days), the same family as the credit-card reconciliation (US-P1-D) —
 * NOT amount-based classification (we never guess a transaction's MEANING from its
 * size; we only match equal-and-opposite movements across accounts). The user
 * confirms; nothing is auto-excluded. Money is bigint cents (constitution II).
 */

export interface TransferTxn {
  /** Stable annotation key (`<pdf_source_hash>#<txIndex>`). */
  key: string;
  /** Account identity (bank + type + last4) — two statements of the SAME account share this. */
  account_id: string;
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // signed; outflow < 0, inflow > 0
  description: string;
}

export interface TransferPair {
  outflow_key: string;
  inflow_key: string;
  /** Magnitude moved (≥ 0). */
  amount_minor: bigint;
  out_account_id: string;
  in_account_id: string;
  out_date: string;
  in_date: string;
  /** |in_date − out_date| in days. */
  gap_days: number;
  /** 'high' when a descriptor hints "transfer"/"xfer"/"to savings"; else 'medium'. */
  confidence: 'high' | 'medium';
}

export interface TransferOptions {
  /** Max days between the two legs to still count as one transfer. Default 5. */
  maxGapDays?: number;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
  return Math.abs(Math.round(ms / 86_400_000));
}

const TRANSFER_HINT =
  /transfer|xfer|to savings|to checking|wire|zelle|move to|online banking transfer/i;

/**
 * Find likely transfer pairs. Greedy: each transaction is used at most once; for
 * each outflow (earliest first) we take the closest-dated unused inflow of the
 * SAME magnitude in a DIFFERENT account within `maxGapDays`. Deterministic and
 * pure — input order does not change the result (we sort internally), and the
 * input array is not mutated.
 */
export function detectTransfers(
  txns: readonly TransferTxn[],
  opts: TransferOptions = {}
): TransferPair[] {
  const maxGap = opts.maxGapDays ?? 5;

  // Stable ordering so the greedy choice is deterministic regardless of input order.
  const byDateThenKey = (a: TransferTxn, b: TransferTxn): number =>
    a.posted_date < b.posted_date
      ? -1
      : a.posted_date > b.posted_date
        ? 1
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0;

  const outflows = txns
    .filter((t) => t.amount_minor < 0n)
    .slice()
    .sort(byDateThenKey);
  const inflows = txns
    .filter((t) => t.amount_minor > 0n)
    .slice()
    .sort(byDateThenKey);

  const usedInflow = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const out of outflows) {
    const mag = -out.amount_minor;
    let best: TransferTxn | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const inf of inflows) {
      if (usedInflow.has(inf.key)) continue;
      if (inf.account_id === out.account_id) continue; // must be a DIFFERENT account
      if (inf.amount_minor !== mag) continue; // equal and opposite
      const gap = daysBetween(out.posted_date, inf.posted_date);
      if (gap > maxGap) continue;
      // Prefer the smallest gap; tie-break deterministically by inflow key.
      if (gap < bestGap || (gap === bestGap && best !== null && inf.key < best.key)) {
        best = inf;
        bestGap = gap;
      }
    }
    if (best !== null) {
      usedInflow.add(best.key);
      const hinted = TRANSFER_HINT.test(out.description) || TRANSFER_HINT.test(best.description);
      pairs.push({
        outflow_key: out.key,
        inflow_key: best.key,
        amount_minor: mag,
        out_account_id: out.account_id,
        in_account_id: best.account_id,
        out_date: out.posted_date,
        in_date: best.posted_date,
        gap_days: bestGap,
        confidence: hinted ? 'high' : 'medium'
      });
    }
  }

  // Sort output by out_date for stable, predictable consumption.
  return pairs.sort((a, b) =>
    a.out_date < b.out_date
      ? -1
      : a.out_date > b.out_date
        ? 1
        : a.outflow_key < b.outflow_key
          ? -1
          : 1
  );
}
