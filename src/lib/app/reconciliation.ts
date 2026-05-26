// Reconciliation matcher — links bank-statement "PAYMENT TO [card]" rows to
// the corresponding credit-card statement (US-P1-D, the signature feature).
//
// Matching algorithm per research.md §R12:
//   1. Card identifier in the bank-tx description matches a CC statement's
//      account_last_4 (extracted from "Ending IN NNNN" in the description).
//   2. The absolute amount of the bank-tx equals one of the CC statement's
//      payment_to_card transactions to the cent.
//   3. The bank-tx date falls within ±10 days of the CC's period_end.
//
// If exactly one CC statement matches → auto-link with confidence 1.0.
// If zero match → no link (UI shows "Import the matching CC statement" hint).
// If multiple match → no auto-link (UI prompts user to choose).

import type { ParsedStatement, ParsedTransaction } from '../adapters/types';
import { bankNameMatchesIssuer, detectCardPayment } from '../util/card-payment';

/**
 * One parsed-and-validated statement currently held in app memory.  Once the
 * persistence layer (task #43) lands, this struct is replaced by a DB-backed
 * row from the `statements` table.
 */
export interface ImportedStatement {
  statement: ParsedStatement;
  transactions: ParsedTransaction[];
  bank_name: string;
  adapter_name: string;
  pdf_source_hash: string;
}

export interface ReconciliationLink {
  /** Index of the bank-side import in the caller's imports array. */
  bank_import_index: number;
  /** Index of the bank-side transaction inside that import's transactions array. */
  bank_transaction_index: number;
  /** Index of the matched CC-side import in the caller's imports array. */
  cc_import_index: number;
  /** Index of the matched CC-side payment row inside that CC import, or null
   *  if no individual row matched (rare — only when the CC statement's
   *  printed "Payment, Credits" aggregate matches but no single row equals it). */
  cc_transaction_index: number | null;
  /** 'auto' = matcher chose this; 'manual' = user assigned it. */
  link_type: 'auto' | 'manual';
  /** 1.0 for an unambiguous single match; reserved for fuzzier future heuristics. */
  confidence_score: number;
  matched_amount_minor: bigint;
  matched_date: string;
}

// Window centered on the CC statement's period_end.  Bank payments can land
// anywhere from a few days before the cycle closes through a few weeks after
// (cardholders often pay around the due-date, which Chase sets ~25 days
// after period_end).  ±30 days covers the realistic range.  Research §R12
// originally specified ±10 from due_date OR period_end; we generalize to ±30
// from period_end since payment_due_date isn't always extracted yet.
const DATE_WINDOW_DAYS = 30;

function absMinor(v: bigint): bigint {
  return v < 0n ? -v : v;
}

function daysBetween(isoA: string, isoB: string): number {
  // ISO YYYY-MM-DD; both must be valid.
  const a = Date.UTC(
    parseInt(isoA.slice(0, 4), 10),
    parseInt(isoA.slice(5, 7), 10) - 1,
    parseInt(isoA.slice(8, 10), 10)
  );
  const b = Date.UTC(
    parseInt(isoB.slice(0, 4), 10),
    parseInt(isoB.slice(5, 7), 10) - 1,
    parseInt(isoB.slice(8, 10), 10)
  );
  return Math.abs(a - b) / 86_400_000;
}

/**
 * Run the matcher over the current set of imports.  Returns one link per
 * confidently-matched bank-side payment_to_card transaction.
 *
 * The matcher handles CROSS-BANK payments — the user paying their BofA /
 * Amex / Discover / Robinhood / etc. credit card from a Chase checking
 * account.  Per-issuer descriptor patterns live in
 * `src/lib/util/card-payment.ts`.
 *
 * Matching strategy (per research.md §R12, generalized):
 *   1. From the bank-tx description, detect the card issuer (Chase / BofA /
 *      Amex / Discover / Robinhood / etc.) and the card's last_4 if the
 *      descriptor explicitly carries it (Chase / Discover do; the others
 *      don't).
 *   2. Candidate CC imports = imports whose bank_name matches the issuer
 *      (via the alias table) AND, if a last_4 was extracted, whose
 *      account_last_4 matches.
 *   3. Filter candidates to those within ±DATE_WINDOW_DAYS of the bank-tx
 *      date relative to the CC statement's period_end.
 *   4. Within each candidate, find a payment_to_card transaction whose
 *      absolute amount matches the bank-tx absolute amount.
 *   5. If exactly one (cc_import, cc_transaction) pair matches → auto-link
 *      with confidence 1.0.  Zero → no link.  Multiple → no auto-link
 *      (UI shows "ambiguous, please choose" — deferred until manual-link UI).
 *
 * Pure function: same inputs → same outputs.  Safe to call on every state
 * change in the UI without persistence side-effects.
 */
export function reconcileImports(imports: ImportedStatement[]): ReconciliationLink[] {
  const links: ReconciliationLink[] = [];

  // Pre-collect CC import indices (we filter by issuer per bank-tx below).
  const ccIndices: number[] = [];
  imports.forEach((imp, idx) => {
    if (imp.statement.account_type === 'credit_card') ccIndices.push(idx);
  });

  imports.forEach((bankImp, bankIdx) => {
    if (bankImp.statement.account_type === 'credit_card') return;

    bankImp.transactions.forEach((tx, txIdx) => {
      if (tx.transaction_type !== 'payment_to_card') return;

      const paymentInfo = detectCardPayment(tx.description);
      if (paymentInfo === null) return; // Bank's payment_to_card but no issuer recognized

      const bankAbs = absMinor(tx.amount_minor);

      type Match = { cc_import_index: number; cc_transaction_index: number | null };
      const matches: Match[] = [];

      for (const ccIdx of ccIndices) {
        const ccImp = imports[ccIdx]!;

        // Filter by issuer alias.
        if (!bankNameMatchesIssuer(ccImp.bank_name, paymentInfo.issuer)) continue;

        // If the descriptor carried a last_4, the CC's account_last_4 must
        // match.  If it didn't, we fall through and rely on amount+date.
        if (paymentInfo.card_last_4 !== null) {
          const ccLast4 = ccImp.statement.account_last_4?.padStart(4, '0');
          if (ccLast4 !== paymentInfo.card_last_4) continue;
        }

        // Date window: bank-tx date within ±DATE_WINDOW_DAYS of CC period_end.
        if (daysBetween(tx.posted_date, ccImp.statement.period_end) > DATE_WINDOW_DAYS) {
          continue;
        }

        // Collect EVERY CC-side payment_to_card row whose absolute amount
        // matches — each matching row is a DISTINCT candidate.  Using findIndex
        // (first match only) here was an IV&V-found P0 bug (D22): two equal
        // payments in ONE statement collapsed to a single match, so the matcher
        // emitted a link to row 0 instead of recognizing the ambiguity.  The
        // ambiguity count must be at the ROW level, not the statement level, so
        // that 2+ equal payment rows (in one statement OR across statements)
        // correctly yield NO auto-link (R7 / INV5 — never guess).
        ccImp.transactions.forEach((ccTx, ccTxIdx) => {
          if (
            ccTx.transaction_type === 'payment_to_card' &&
            absMinor(ccTx.amount_minor) === bankAbs
          ) {
            matches.push({ cc_import_index: ccIdx, cc_transaction_index: ccTxIdx });
          }
        });
      }

      if (matches.length === 1) {
        const match = matches[0]!;
        // Confidence: 1.0 if last_4 was explicit (full match); 0.85 if
        // matched by issuer + amount + date only (no last_4 in descriptor).
        const confidence = paymentInfo.card_last_4 !== null ? 1.0 : 0.85;
        links.push({
          bank_import_index: bankIdx,
          bank_transaction_index: txIdx,
          cc_import_index: match.cc_import_index,
          cc_transaction_index: match.cc_transaction_index,
          link_type: 'auto',
          confidence_score: confidence,
          matched_amount_minor: bankAbs,
          matched_date: tx.posted_date
        });
      }
      // matches.length === 0 → no auto-link; UI shows "import the matching CC"
      // matches.length > 1   → ambiguous; UI prompts the user to pick (deferred)
    });
  });

  return links;
}

/**
 * Helper: given the links array and a (bank_import_index, bank_transaction_index)
 * pair, find the matching link if any.  O(N) — N is typically small (≤ 50).
 */
export function findLinkForBankTxn(
  links: ReconciliationLink[],
  bankImportIndex: number,
  bankTransactionIndex: number
): ReconciliationLink | undefined {
  return links.find(
    (l) =>
      l.bank_import_index === bankImportIndex && l.bank_transaction_index === bankTransactionIndex
  );
}
