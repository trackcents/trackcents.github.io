// Per-card transaction streams + FIFO attribution of payments to purchases.
//
// Why this exists (the bug it fixes, 2026-05-23):
//   The first cut of reconciliation linked a bank-side payment of $X to a
//   single credit-card statement — the one whose closing date fell near the
//   payment date.  Then the drill page showed THAT statement's transactions
//   and called them "what your $X paid for."  Wrong.  A CC payment pays down
//   the running balance, which is made up of purchases from the PRIOR
//   statement (whose total became "Previous Balance"), not the receiving
//   statement's own purchases.  Example: user paid Discover $351.27 on
//   2026-03-03.  The March Discover statement had only $15.07 of new
//   purchases — the $351.27 paid off February's $341.27 balance plus $10
//   left over.
//
// What this module does:
//   1. Group every imported transaction by (bank_name, account_last_4) — the
//      stable card identity that spans statements.
//   2. Sort chronologically by posted_date.
//   3. For each card, walk forward maintaining a FIFO queue of unpaid
//      purchases.  When a payment or refund appears, consume the oldest
//      unpaid purchases until the payment amount is exhausted.  Record the
//      mapping (payment → list of {purchase, covered_amount}).
//   4. If a payment runs out of queue (consumes everything and still has
//      $X remaining), record $X as `uncovered_amount` — that part of the
//      payment went to pre-epoch balance we don't have records for.
//
// Sign convention reminder (per ParsedTransaction contract):
//   purchase / fee / interest:  amount_minor < 0  (you owe more)
//   payment_to_card / refund:    amount_minor > 0  (you owe less)
//
// FIFO is a convention, not a bank-side fact (banks just track a running
// balance).  But FIFO matches a normal human's mental model: "the dollars
// you paid off the oldest charges first."  Users can override individual
// attributions later (deferred to a manual-link feature).

import type { ParsedTransaction } from '../adapters/types';
import type { ImportSuccess } from './import';

/**
 * Stable identity for one card across many statements.  Two statements with
 * the same bank_name AND the same account_last_4 are treated as the same
 * card.  account_last_4 of null means "card last_4 was not extracted" — those
 * transactions cannot be merged into a single stream and are skipped.
 */
export interface CardKey {
  bank_name: string;
  account_last_4: string;
}

export function cardKeyString(k: CardKey): string {
  // Injective encoding (IV&V D20). A plain `${bank}::${last4}` separator
  // COLLIDES when a field straddles the separator — e.g. {bank_name:'',
  // account_last_4:':'} and {bank_name:':', account_last_4:''} both produce
  // ':::', which would merge two DIFFERENT cards into one stream and
  // mis-attribute a payment across cards (a money-truth error on US-P1-D).
  // JSON-encoding the field tuple is injective for ALL string inputs, so the
  // R1 distinct-identity guarantee holds unconditionally — not just for the
  // 4-digit-last4 / registry-bank-name production domain. The key is purely an
  // internal Map key (built + looked up via this same function, never
  // persisted), so the format is free to change.
  return JSON.stringify([k.bank_name, k.account_last_4]);
}

/**
 * One transaction in the per-card stream, with provenance pointers back to
 * which import it came from so the UI can link back to the full statement.
 */
export interface StreamTransaction {
  /** Which import (index in the original imports array) this came from. */
  import_index: number;
  /** Which row within that import's transactions array. */
  transaction_index: number;
  /** Convenience copy of the underlying ParsedTransaction. */
  txn: ParsedTransaction;
}

/**
 * Complete chronological stream for one card.
 */
export interface CardStream {
  key: CardKey;
  transactions: StreamTransaction[];
}

/**
 * One element of the FIFO attribution for a payment.
 */
export interface AttributedPurchase {
  /** The stream-position of the purchase that was paid for. */
  purchase_position: number;
  /** How many cents of this purchase the payment covered.  Equals the
   *  purchase amount if fully consumed; less if the payment ran out
   *  partway through this purchase. */
  covered_amount_minor: bigint;
}

/**
 * Attribution result for ONE payment (or refund-treated-as-payment).
 */
export interface PaymentAttribution {
  /** The stream-position of the payment transaction. */
  payment_position: number;
  /**
   * Oldest-first list of purchases this payment paid for.  A purchase may
   * be partially covered if it's the last one and the payment ran out.
   */
  paid_for: AttributedPurchase[];
  /**
   * If > 0, the payment was larger than the sum of available unpaid
   * purchases at the time.  That excess went to pre-epoch balance the
   * stream doesn't know about.
   */
  uncovered_amount_minor: bigint;
}

/**
 * Build per-card transaction streams from the full set of imports.
 *
 * Returns a map keyed by `cardKeyString(key)`.  Statements without an
 * `account_last_4` cannot be merged into a card stream and are SKIPPED
 * entirely (callers should fall back to per-statement views for those).
 *
 * Only credit-card and loan account types are included by default — those
 * are the ones for which "running balance + payment attribution" is the
 * useful question.  Checking / savings accounts have their own stream
 * concept (paycheck windows) but aren't included here.
 */
export function buildCardStreams(imports: ImportSuccess[]): Map<string, CardStream> {
  const streams = new Map<string, CardStream>();

  for (let importIdx = 0; importIdx < imports.length; importIdx++) {
    const imp = imports[importIdx]!;
    if (imp.statement.account_type !== 'credit_card' && imp.statement.account_type !== 'loan') {
      continue;
    }
    const last4 = imp.statement.account_last_4;
    if (last4 === null) continue;

    const key: CardKey = { bank_name: imp.bank_name, account_last_4: last4 };
    const keyStr = cardKeyString(key);
    let stream = streams.get(keyStr);
    if (!stream) {
      stream = { key, transactions: [] };
      streams.set(keyStr, stream);
    }

    for (let txnIdx = 0; txnIdx < imp.transactions.length; txnIdx++) {
      stream.transactions.push({
        import_index: importIdx,
        transaction_index: txnIdx,
        txn: imp.transactions[txnIdx]!
      });
    }
  }

  // Sort each stream by a DETERMINISTIC TOTAL ORDER so attribution never
  // depends on the order statements/rows were imported (IV&V D19, same
  // principle as the merchant-trends fix D13: a finance tool MUST be
  // import-order-independent).  Within a single posted_date, where there is no
  // true temporal order, we break ties on intrinsic fields only:
  //   1. posted_date ascending
  //   2. debits (purchase/fee/interest, balance-increasing) BEFORE credits
  //      (payment_to_card/refund, balance-decreasing) — so a same-day payment
  //      pays off that same day's charges (the intuitive answer), regardless
  //      of which order the PDF/parser emitted them.  Other types (transfer/
  //      deposit/withdrawal/other) are FIFO-ignored anyway and sort last.
  //   3. amount_minor ascending, then 4. description ascending — purely to
  //      make the order TOTAL on intrinsic data (no reliance on import index,
  //      so the result is permutation-invariant up to genuinely-identical rows).
  for (const stream of streams.values()) {
    stream.transactions.sort((a, b) => {
      if (a.txn.posted_date < b.txn.posted_date) return -1;
      if (a.txn.posted_date > b.txn.posted_date) return 1;
      const ra = sameDayRank(a.txn.transaction_type);
      const rb = sameDayRank(b.txn.transaction_type);
      if (ra !== rb) return ra - rb;
      if (a.txn.amount_minor < b.txn.amount_minor) return -1;
      if (a.txn.amount_minor > b.txn.amount_minor) return 1;
      if (a.txn.description < b.txn.description) return -1;
      if (a.txn.description > b.txn.description) return 1;
      return 0;
    });
  }

  return streams;
}

/**
 * Same-`posted_date` ordering rank: balance-INCREASING debits first (0),
 * then balance-DECREASING credits (1), then FIFO-ignored types (2).  Used
 * only to break ties between rows on the same calendar day so the attribution
 * is deterministic and independent of import order (IV&V D19).
 */
function sameDayRank(t: ParsedTransaction['transaction_type']): number {
  if (t === 'purchase' || t === 'fee' || t === 'interest') return 0;
  if (t === 'payment_to_card' || t === 'refund') return 1;
  return 2;
}

/**
 * Run FIFO attribution over a single card stream.
 *
 * Returns one PaymentAttribution per payment/refund in the stream
 * (chronological order).  Purchases without any payment yet are not in the
 * output — they're "still owed."  Use `unpaidBalanceAfter()` for that.
 *
 * Treatment of each transaction type:
 *   purchase, fee, interest      → enqueue (amount you owe goes up)
 *   payment_to_card, refund      → consume queue (amount you owe goes down)
 *   transfer, deposit, withdrawal → ignored (not part of a CC's balance)
 *   other                        → ignored (treat conservatively until
 *                                   evidence suggests otherwise)
 *
 * Refunds are treated identically to payments — they consume oldest unpaid
 * purchases first.  This is a simplification: ideally a refund cancels its
 * specific original purchase, but determining that requires matching by
 * merchant which is fragile.  Users can manually correct an attribution
 * if a refund consumed the wrong purchase (deferred manual-override UI).
 */
export function computeFifoAttributions(stream: CardStream): PaymentAttribution[] {
  // FIFO queue of unpaid purchases.  Each entry tracks the position in the
  // stream and how many cents remain unpaid.
  interface QueueEntry {
    position: number;
    remaining: bigint;
  }
  const queue: QueueEntry[] = [];
  const attributions: PaymentAttribution[] = [];

  for (let i = 0; i < stream.transactions.length; i++) {
    const st = stream.transactions[i]!;
    const t = st.txn;
    const amount = t.amount_minor;

    if (
      t.transaction_type === 'purchase' ||
      t.transaction_type === 'fee' ||
      t.transaction_type === 'interest'
    ) {
      // You owe more.  amount_minor < 0 by sign convention.
      if (amount < 0n) {
        queue.push({ position: i, remaining: -amount });
      }
      // If a "purchase" was somehow positive (data error or refund miscoded),
      // skip it rather than corrupting the queue.
    } else if (t.transaction_type === 'payment_to_card' || t.transaction_type === 'refund') {
      // You owe less.  amount_minor > 0 by sign convention.
      if (amount <= 0n) continue; // zero or wrong-sign — skip safely
      let remaining = amount;
      const paid_for: AttributedPurchase[] = [];
      while (remaining > 0n && queue.length > 0) {
        const head = queue[0]!;
        if (head.remaining <= remaining) {
          paid_for.push({
            purchase_position: head.position,
            covered_amount_minor: head.remaining
          });
          remaining -= head.remaining;
          queue.shift();
        } else {
          paid_for.push({
            purchase_position: head.position,
            covered_amount_minor: remaining
          });
          head.remaining -= remaining;
          remaining = 0n;
        }
      }
      attributions.push({
        payment_position: i,
        paid_for,
        uncovered_amount_minor: remaining
      });
    }
    // Other transaction types are ignored.
  }

  return attributions;
}

/**
 * Convenience: total unpaid balance at the end of the stream.  Equivalent to
 * sum of remaining FIFO queue entries.
 */
export function unpaidBalanceAfter(stream: CardStream): bigint {
  // Run the same FIFO simulation, but return the sum of queue remainders at
  // end of stream rather than the attribution list.
  interface QueueEntry {
    remaining: bigint;
  }
  const queue: QueueEntry[] = [];
  for (const st of stream.transactions) {
    const t = st.txn;
    if (
      t.transaction_type === 'purchase' ||
      t.transaction_type === 'fee' ||
      t.transaction_type === 'interest'
    ) {
      if (t.amount_minor < 0n) queue.push({ remaining: -t.amount_minor });
    } else if (t.transaction_type === 'payment_to_card' || t.transaction_type === 'refund') {
      if (t.amount_minor <= 0n) continue;
      let remaining = t.amount_minor;
      while (remaining > 0n && queue.length > 0) {
        const head = queue[0]!;
        if (head.remaining <= remaining) {
          remaining -= head.remaining;
          queue.shift();
        } else {
          head.remaining -= remaining;
          remaining = 0n;
        }
      }
    }
  }
  let total = 0n;
  for (const q of queue) total += q.remaining;
  return total;
}

/**
 * Find the attribution for a specific payment in a specific card stream.
 * Returns null if no payment is found at that stream position (e.g., the
 * caller passed a position pointing to a purchase, or out of range).
 */
export function findAttributionForPosition(
  attributions: PaymentAttribution[],
  position: number
): PaymentAttribution | null {
  return attributions.find((a) => a.payment_position === position) ?? null;
}
