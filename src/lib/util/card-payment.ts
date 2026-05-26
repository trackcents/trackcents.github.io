// Cross-bank credit-card payment descriptor recognizer.
//
// Bank statements describe outgoing CC payments differently per issuer.
// Patterns enumerated below are derived from:
//   1. The user's own anonymized 9535 Chase Checking statements
//      (Chase, Bk of Amer Visa, American Express ACH Pmt, Discover E-Payment,
//       Robinhood Card Payment, Bank of America Payment).
//   2. Domain research on common ACH descriptors used by major US card
//      issuers when cardholders pay via push from another bank.
//
// The function returns the detected issuer plus, when available, the card's
// last 4 digits.  Most descriptors don't carry the last 4 (Amex / BofA /
// Robinhood etc. omit it), so the reconciliation matcher falls back to
// matching by issuer + amount + date window.
//
// Used by:
//   - Bank-account adapters (chase-checking, future bofa-checking, etc.) to
//     tag a transaction with `transaction_type: 'payment_to_card'` and bubble
//     the issuer info up to the matcher.
//   - The reconciliation matcher (src/lib/app/reconciliation.ts) to find the
//     matching credit-card statement.

export type CardIssuer =
  | 'Chase'
  | 'BofA'
  | 'Amex'
  | 'Discover'
  | 'Robinhood'
  | 'CapitalOne'
  | 'Citi'
  | 'WellsFargo'
  | 'Apple'
  | 'Synchrony'
  | 'Barclays';

export interface CardPaymentInfo {
  issuer: CardIssuer;
  /** Card account_last_4 when the descriptor explicitly carries it; null
   *  otherwise.  Padded to 4 chars when present (e.g., "562" → "0562"). */
  card_last_4: string | null;
}

interface PatternRule {
  regex: RegExp;
  issuer: CardIssuer;
  /** 1-indexed capture group containing the last-4 digits, or null when
   *  the descriptor doesn't carry it. */
  last4_group: number | null;
}

// Order matters: more specific patterns first.  Each issuer can have multiple
// rules since their statement descriptor varies across the user's bank's
// online-bill-pay implementation vs the issuer's own "push" service.
const PATTERNS: PatternRule[] = [
  // Chase ("Payment To Chase Card Ending IN NNNN") — only Chase explicitly
  // tells you which of your own Chase cards was paid.
  {
    regex: /Payment\s+To\s+Chase\s+Card\s+Ending\s+IN\s+(\d{3,4})/i,
    issuer: 'Chase',
    last4_group: 1
  },

  // Discover ("Discover E-Payment NNNN ...") — the 4 digits ARE the card's
  // last 4 in the user's observed data.
  { regex: /Discover\s+E-?Payment\s+(\d{3,4})\b/i, issuer: 'Discover', last4_group: 1 },

  // Bank of America — two observed descriptor forms.
  { regex: /Bk\s+of\s+Amer\s+Visa\s+Online\s+Pmt/i, issuer: 'BofA', last4_group: null },
  {
    regex: /Bank\s+of\s+America\s+(?:Payment|CC\s+Pmt|Credit\s+Card\s+Pmt)/i,
    issuer: 'BofA',
    last4_group: null
  },
  { regex: /\bBOA\s+(?:CC|CARD|VISA)\s+PMT/i, issuer: 'BofA', last4_group: null },

  // American Express — "ACH Pmt MNNNN" / "EPAYMENT ACH PMT" / "Amex Epayment".
  // The M-prefix code is Amex's internal reference, NOT the card's last 4.
  {
    regex: /American\s+Express\s+(?:ACH\s+Pmt|Epayment|EPAYMENT)/i,
    issuer: 'Amex',
    last4_group: null
  },
  { regex: /\bAMEX\s+EPAYMENT\b/i, issuer: 'Amex', last4_group: null },
  { regex: /\bAMERICAN\s+EXPRESS\s+\w+\s+M\d{3,5}\b/i, issuer: 'Amex', last4_group: null },

  // Robinhood Money / Credit — no identifier in descriptor.
  {
    regex: /Robinhood\s+(?:Card\s+Payment|CRD\s+PMT|Credit\s+Pmt)/i,
    issuer: 'Robinhood',
    last4_group: null
  },

  // Capital One
  {
    regex: /CAPITAL\s+ONE\s+(?:MOBILE\s+PMT|CRD\s+PMT|ONLINE\s+PMT)/i,
    issuer: 'CapitalOne',
    last4_group: null
  },
  { regex: /\bCAPITAL\s+ONE\s+AUTOPAY\b/i, issuer: 'CapitalOne', last4_group: null },

  // Citi / Citibank
  {
    regex: /\bCITI(?:BANK|\s+CARD)?\s+(?:AUTOPAY|ONLINE|CRD\s+PMT)/i,
    issuer: 'Citi',
    last4_group: null
  },

  // Wells Fargo
  {
    regex: /\bWF\s+(?:CREDIT\s+CARD\s+PMT|CRD\s+CARD\s+PMT|CRD\s+PMT)/i,
    issuer: 'WellsFargo',
    last4_group: null
  },
  { regex: /\bWELLS\s+FARGO\s+CARD\s+(?:PMT|PAYMENT)/i, issuer: 'WellsFargo', last4_group: null },

  // Apple Card (issued by Goldman Sachs)
  { regex: /GS\s+BANK\s+USA\s+(?:PMT|PAYMENT)/i, issuer: 'Apple', last4_group: null },
  { regex: /\bAPPLE\s+CARD\s+(?:PMT|PAYMENT)/i, issuer: 'Apple', last4_group: null },

  // Synchrony (issuer of many store cards: Amazon, Lowe's, etc.)
  { regex: /\bSYNCHRONY\s+(?:BANK|PAYMENT|CRD\s+PMT)/i, issuer: 'Synchrony', last4_group: null },

  // Barclays (issuer of various co-brand cards)
  { regex: /\bBARCLAYS?\s+(?:CARD|BANK)\s+(?:PMT|PAYMENT)/i, issuer: 'Barclays', last4_group: null }
];

/**
 * Inspect a bank-statement transaction description.  Return the recognized
 * issuer + extracted last-4 (when present), or null if this isn't a
 * recognized credit-card payment.
 *
 * Deterministic and side-effect-free.  Order of patterns is fixed.
 */
export function detectCardPayment(description: string): CardPaymentInfo | null {
  for (const pat of PATTERNS) {
    const m = pat.regex.exec(description);
    if (!m) continue;
    let card_last_4: string | null = null;
    if (pat.last4_group !== null) {
      const captured = m[pat.last4_group];
      if (captured) card_last_4 = captured.padStart(4, '0');
    }
    return { issuer: pat.issuer, card_last_4 };
  }
  return null;
}

/**
 * Map a detected issuer to the `bank_name` strings that CC adapters are
 * expected to set on `BankAdapter.bank_name` and the upstream
 * `ImportedStatement.bank_name`.  Multiple aliases supported because we
 * haven't fully standardized adapter names yet.
 */
export const ISSUER_BANK_NAMES: Record<CardIssuer, readonly string[]> = {
  Chase: ['Chase', 'JPMorgan Chase'],
  BofA: ['Bank of America', 'BoA', 'BofA'],
  Amex: ['American Express', 'Amex'],
  Discover: ['Discover'],
  Robinhood: ['Robinhood', 'Robinhood Credit', 'Robinhood Money'],
  CapitalOne: ['Capital One'],
  Citi: ['Citi', 'Citibank'],
  WellsFargo: ['Wells Fargo'],
  Apple: ['Apple', 'Apple Card', 'Goldman Sachs'],
  Synchrony: ['Synchrony'],
  Barclays: ['Barclays', 'Barclays Bank']
};

/**
 * Returns true if the given bank_name (as set by a CC adapter) belongs to the
 * given issuer.  Case-insensitive EXACT match against the issuer's alias list.
 *
 * IV&V D25: the original raw-substring match was unsafe — short aliases
 * ('Citi', 'BoA', 'Apple', 'Capital One') matched unrelated banks that merely
 * CONTAIN the alias ("Citizens Bank" ⊃ "citi", "pineapple" ⊃ "apple", "BoA
 * Fitness Club" ⊃ "boa", "Capital One Realty Brokers" ⊃ "capital one"), which
 * could mis-route a reconciliation link to the WRONG card — the exact
 * false-positive hazard US-P1-D must avoid.
 *
 * `bank_name` is ADAPTER-CONTROLLED (each CC adapter sets it to a canonical
 * issuer name), not free user text, so an exact match against the alias list is
 * both correct and the safest choice: it admits every real adapter output and
 * produces ZERO false positives. It fails CLOSED — if an adapter ever emits a
 * suffixed form (e.g. "Bank of America Visa Signature") it simply won't match
 * until that exact string is added to ISSUER_BANK_NAMES, yielding a missing link
 * (safe, visible, fixable) rather than a wrong link (a silent money-truth error).
 */
export function bankNameMatchesIssuer(bankName: string, issuer: CardIssuer): boolean {
  const target = bankName.trim().toLowerCase();
  return ISSUER_BANK_NAMES[issuer].some((c) => c.toLowerCase() === target);
}
