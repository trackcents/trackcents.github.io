// Public API for "what did this bank-side payment actually pay for?"
//
// This is the load-bearing piece of the US-P1-D signature feature.  The bank
// statement shows "PAYMENT - DISCOVER 3562 -$351.27" and the user wants to
// know: which specific Discover charges did that $351.27 pay off?
//
// Pipeline:
//   1. The reconciliation matcher (reconciliation.ts) already identifies
//      WHICH card account this bank-side payment landed on.  We reuse it.
//   2. The transaction-stream module (transaction-stream.ts) merges every
//      imported statement for that card into one chronological stream and
//      runs FIFO attribution.
//   3. We combine the two: find the payment in the card stream, look up its
//      FIFO attribution, resolve each attributed purchase back to its
//      original (import_index, transaction_index) so the UI can render it
//      with full provenance.

import type { ImportSuccess } from './import';
import type { ParsedTransaction } from '../adapters/types';
import {
  reconcileImports,
  findLinkForBankTxn,
  type ImportedStatement,
  type ReconciliationLink
} from './reconciliation';
import {
  buildCardStreams,
  cardKeyString,
  computeFifoAttributions,
  findAttributionForPosition,
  type CardStream
} from './transaction-stream';

export interface AttributedPurchaseRef {
  /** Which import the purchase came from (index into the imports array). */
  import_index: number;
  /** Which transaction within that import. */
  transaction_index: number;
  /** How many cents of this purchase were covered by THIS payment. */
  covered_amount_minor: bigint;
  /** Convenience copy of the underlying purchase transaction. */
  txn: ParsedTransaction;
}

export interface PaymentDrillResult {
  /** Bank that holds the card (e.g. "Discover").  Same as ImportSuccess.bank_name. */
  card_bank_name: string;
  /** Last 4 of the card. */
  card_last_4: string;
  /** Payment amount (always positive — abs of bank-side amount_minor). */
  payment_amount_minor: bigint;
  /** ISO date the payment was made (the bank-side transaction's posted_date). */
  payment_date: string;
  /** The original reconciliation link (carries link_type, confidence_score, etc.). */
  link: ReconciliationLink;
  /**
   * Oldest-first list of purchases this payment paid for, with how much of
   * each was covered.  Empty array if the payment was entirely "pre-epoch"
   * — i.e., it paid down balance carried in from before the earliest
   * statement we have.
   */
  paid_for: AttributedPurchaseRef[];
  /**
   * If > 0, this many cents of the payment had no purchase to cover within
   * the data we have.  The UI explains this as "paid pre-tracking balance."
   */
  uncovered_amount_minor: bigint;
  /**
   * The card stream we walked.  Useful for the UI if it wants to render the
   * running balance or surrounding context.
   */
  stream: CardStream;
}

function toImportedStatement(imp: ImportSuccess): ImportedStatement {
  return {
    statement: imp.statement,
    transactions: imp.transactions,
    bank_name: imp.bank_name,
    adapter_name: imp.adapter_name,
    pdf_source_hash: imp.pdf_source_hash
  };
}

/**
 * Compute the drill-through result for a specific bank-side payment row.
 * Returns null if the matcher can't identify which card the payment went
 * to, or if the inputs are out of range.
 *
 * Pure function — safe to call repeatedly, including on every Svelte
 * render.  No persistence side effects.
 */
export function getPaymentDrill(
  imports: ImportSuccess[],
  bankImportIndex: number,
  bankTransactionIndex: number
): PaymentDrillResult | null {
  // 1. Find the existing reconciliation link.  This step alone tells us
  //    which CARD the payment landed on (it doesn't tell us which
  //    purchases — that's what FIFO is for).
  const importedStatements = imports.map(toImportedStatement);
  const links = reconcileImports(importedStatements);
  const link = findLinkForBankTxn(links, bankImportIndex, bankTransactionIndex);
  if (!link) return null;

  const ccImp = imports[link.cc_import_index];
  if (!ccImp) return null;
  const last4 = ccImp.statement.account_last_4;
  if (last4 === null) return null;

  // 2. Build (or reuse) the card stream for that card.
  const streams = buildCardStreams(imports);
  const stream = streams.get(cardKeyString({ bank_name: ccImp.bank_name, account_last_4: last4 }));
  if (!stream) return null;

  // 3. Locate the payment within the card stream.  Each StreamTransaction
  //    knows its (import_index, transaction_index) — we use that to find
  //    the exact CC-side row the matcher pointed at.
  if (link.cc_transaction_index === null) return null;
  const paymentPos = stream.transactions.findIndex(
    (st) =>
      st.import_index === link.cc_import_index && st.transaction_index === link.cc_transaction_index
  );
  if (paymentPos < 0) return null;

  // 4. Compute FIFO attribution for the whole stream and find the entry
  //    corresponding to our payment.
  const attributions = computeFifoAttributions(stream);
  const attribution = findAttributionForPosition(attributions, paymentPos);
  if (!attribution) return null;

  // 5. Resolve each attributed purchase back to its source coordinates.
  const paid_for: AttributedPurchaseRef[] = attribution.paid_for.map((pf) => {
    const purchaseSt = stream.transactions[pf.purchase_position]!;
    return {
      import_index: purchaseSt.import_index,
      transaction_index: purchaseSt.transaction_index,
      covered_amount_minor: pf.covered_amount_minor,
      txn: purchaseSt.txn
    };
  });

  return {
    card_bank_name: ccImp.bank_name,
    card_last_4: last4,
    payment_amount_minor: link.matched_amount_minor,
    payment_date: link.matched_date,
    link,
    paid_for,
    uncovered_amount_minor: attribution.uncovered_amount_minor,
    stream
  };
}
