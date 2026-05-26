// Layer 1 contract types per specs/001-money-tracker-mvp/contracts/bank-adapter.md.
// These types are the boundary between bank-specific parsers and the rest of the app.
//
// CRITICAL: Files in src/lib/adapters/ MUST NOT import from src/lib/db/ or src/lib/app/.
// This rule is enforced by an ESLint guard in eslint.config.js (constitution Principle VI).

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'loan' | 'cash' | 'other';

export type TransactionStatus = 'pending' | 'posted' | 'disputed' | 'reversed';

export type TransactionType =
  | 'purchase'
  | 'refund'
  | 'transfer'
  | 'fee'
  | 'interest'
  | 'payment_to_card'
  | 'deposit'
  | 'withdrawal'
  | 'other';

/**
 * The four checksum verification levels per research.md §R13.
 *
 * - A: balance reconciliation (opening + sum = closing).  Universally applicable.
 * - B: aggregate totals (printed total_debits and total_credits).  Most US/Canadian banks.
 * - C: credit-card balance equation (previous + charges - payments - credits = new).
 * - D: transaction count.  Supplementary only; NEVER sufficient alone.
 *
 * Every adapter MUST populate enough fields to satisfy at least one of A, B, or C.
 */
export type ChecksumLevel = 'A' | 'B' | 'C' | 'D';

/**
 * One transaction as produced by an adapter, before persistence.
 *
 * Money is signed integer cents (negative = outflow / spending; positive = inflow).
 * The adapter is responsible for normalizing the sign — credit card statements that
 * natively use positive=purchase MUST invert.
 */
export interface ParsedTransaction {
  posted_date: string; // ISO YYYY-MM-DD
  description: string; // cleaned for display
  raw_text: string; // original PDF line, byte-for-byte (audit trail)
  amount_minor: bigint; // signed integer cents
  currency: string; // ISO 4217 code (e.g. 'USD')
  transaction_type: TransactionType;
  status?: TransactionStatus;
}

/**
 * One labeled row from the Account Summary / Checking Summary box on a
 * statement.  Carries the bank's label as printed and the SIGNED amount as
 * the bank prints it (negative for credit balances, negative for
 * payments/credits that reduce the balance, positive otherwise).  This is
 * the long-tail data — fields the checksum gate doesn't directly need
 * (Credit Limit, Available Credit, Cash Access Line, etc.) but that we want
 * to preserve for the UI and for future features (alerts, history, etc.).
 *
 * The bank's exact label is preserved verbatim so different banks can use
 * their own terminology without the app having to translate.
 */
export interface SummaryLine {
  label: string;
  amount_minor: bigint;
}

/**
 * Statement-level metadata extracted by the adapter.
 *
 * Whichever reconciliation fields the adapter can extract are used by the
 * multi-level checksum gate.  The adapter MUST populate enough fields to
 * satisfy AT LEAST ONE of Level A, B, or C.  Level D alone is INSUFFICIENT —
 * the import will be refused if only Level D is available.
 */
export interface ParsedStatement {
  account_type: AccountType;
  account_last_4: string | null;
  period_start: string; // ISO YYYY-MM-DD
  period_end: string; // ISO YYYY-MM-DD
  currency: string;

  // Level A — balance reconciliation (the strongest, most universal check)
  opening_balance_minor: bigint | null;
  closing_balance_minor: bigint | null;

  // Level B — aggregate totals (printed by most US/Canadian bank statements)
  total_debits_minor: bigint | null; // ABSOLUTE value (positive) when present
  total_credits_minor: bigint | null;

  // Level C — credit-card balance equation
  statement_balance_minor: bigint | null;
  previous_balance_minor: bigint | null;

  // Level D — supplementary count check
  printed_transaction_count: number | null;

  /**
   * Every labeled line of the Account Summary box, preserved verbatim with
   * the bank's printed sign.  Empty array if the adapter doesn't surface one
   * (e.g., a future Layer 1 adapter for a non-tabular statement).
   */
  summary_lines: SummaryLine[];

  /**
   * Statement-level dates extracted from the document.  All optional; some
   * banks omit them or use different terminology.  Stored as ISO YYYY-MM-DD.
   */
  payment_due_date: string | null;
  statement_date: string | null;

  /**
   * Minimum payment the cardholder must pay by `payment_due_date` to avoid
   * late fees / APR penalty.  Null for non-credit accounts.
   */
  minimum_payment_due_minor: bigint | null;

  /**
   * Declaration of which checksum levels this adapter populated for THIS statement.
   * The orchestrator uses this to decide which checks to run.  The adapter MUST
   * set this honestly — it is the basis of the verification contract.
   */
  parser_provides: ChecksumLevel[];
}

/**
 * Result of running an adapter against one PDF.
 */
export interface ParseResult {
  statement: ParsedStatement;
  transactions: ParsedTransaction[];
  /** Optional suggested nickname (e.g. "Chase Sapphire Reserve") — UI may show as default. */
  suggested_account_nickname?: string;
}

/**
 * Output of PDF.js text extraction, used as adapter input.
 */
export interface PdfTextWithPositions {
  pages: PdfPage[];
  total_pages: number;
}

export interface PdfPage {
  page_number: number;
  items: PdfTextItem[];
}

export interface PdfTextItem {
  text: string;
  x: number; // horizontal position in PDF units (typically points: 1pt = 1/72 inch)
  y: number; // vertical position (PDF coordinates go bottom-up)
  width: number;
  height: number;
  font_size: number;
}

/**
 * The interface every bank adapter must implement.
 */
export interface BankAdapter {
  /** Stable identifier, e.g. "layout-chase" or "layout-bofa". */
  readonly name: string;

  /** Semver from this adapter's source.  Bumped when the parser changes. */
  readonly version: string;

  /** Display name of the bank.  Used for UI and provenance. */
  readonly bank_name: string;

  /**
   * Cheap probe: does this PDF look like one we can parse?
   * Receives a small text excerpt (e.g. first 4 KB of extracted text).
   * Must be deterministic and fast (<50ms).  No side effects.
   */
  detect(textSample: string): boolean;

  /**
   * Full parse.  Returns a ParseResult or throws ParseError.
   * MUST be deterministic: same PDF in, byte-identical result out.
   * MUST NOT make network calls or touch storage.
   */
  parse(pdfText: PdfTextWithPositions): Promise<ParseResult>;
}

/**
 * Thrown by adapters when a PDF is structurally unparseable
 * (image PDF instead of text, fundamentally wrong format, insufficient
 * reconciliation data per contract obligation 7, etc.).
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'ParseError';
  }
}
