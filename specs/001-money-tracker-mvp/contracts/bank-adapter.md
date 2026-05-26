# Contract: BankAdapter (Layer 1)

A `BankAdapter` is the single point of contact between a specific bank's PDF format and the rest of the application. Every supported bank ships one adapter.

This contract is the only thing the rest of the app knows about banks. Adding a new bank means writing one adapter that satisfies this contract; nothing else in the codebase changes.

## TypeScript interface

```typescript
// src/lib/adapters/types.ts

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'loan' | 'cash' | 'other';
export type TransactionStatus = 'pending' | 'posted' | 'disputed' | 'reversed';
export type TransactionType =
  | 'purchase' | 'refund' | 'transfer' | 'fee' | 'interest'
  | 'payment_to_card' | 'deposit' | 'withdrawal' | 'other';

/**
 * A transaction as produced by an adapter, BEFORE persistence.
 * Money is signed integer cents (negative = outflow).
 */
export interface ParsedTransaction {
  posted_date: string;            // ISO YYYY-MM-DD
  description: string;            // cleaned for display
  raw_text: string;               // original PDF line, byte-for-byte
  amount_minor: number;           // signed integer cents
  currency: string;               // ISO 4217 (e.g. 'USD')
  transaction_type: TransactionType;
  // fx_rate + amount_home_minor are filled by the app layer, not the adapter.
}

/**
 * Statement-level metadata extracted by the adapter.
 * Whichever reconciliation fields the adapter can extract are used
 * by the multi-level checksum gate (see research.md §R13).
 *
 * The adapter MUST populate enough fields to satisfy AT LEAST ONE of
 * Level A (opening + closing balance), Level B (total_debits + total_credits),
 * or Level C (previous + statement balance for credit cards).
 * Level D (printed_transaction_count) alone is INSUFFICIENT — the import
 * will be refused if only Level D is available.
 */
export type ChecksumLevel = 'A' | 'B' | 'C' | 'D';

export interface ParsedStatement {
  account_type: AccountType;
  account_last_4: string | null;
  period_start: string;           // ISO YYYY-MM-DD
  period_end: string;             // ISO YYYY-MM-DD
  currency: string;

  // Level A — balance reconciliation (the strongest, most universally available check)
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;

  // Level B — aggregate totals (printed by most US/Canadian bank statements)
  total_debits_minor: number | null;     // ABSOLUTE value (positive) when present; null when not printed
  total_credits_minor: number | null;    // ABSOLUTE value (positive) when present; null when not printed

  // Level C — credit-card balance equation
  statement_balance_minor: number | null;     // "new balance" line; CC only
  previous_balance_minor: number | null;      // "previous balance" line; CC only

  // Level D — supplementary transaction count check (NEVER sufficient alone)
  printed_transaction_count: number | null;

  /**
   * Declaration of which checksum levels this adapter populated for THIS
   * specific statement. The orchestrator uses this to decide which checks
   * to run. The adapter MUST set this honestly.
   */
  parser_provides: ChecksumLevel[];
}

/**
 * Result of running an adapter against one PDF.
 */
export interface ParseResult {
  statement: ParsedStatement;
  transactions: ParsedTransaction[];
  /**
   * Optional adapter-supplied suggested nickname (e.g. "Chase Sapphire Reserve").
   * The app may show this as a default that the user can edit.
   */
  suggested_account_nickname?: string;
}

/**
 * The interface every bank adapter must implement.
 */
export interface BankAdapter {
  /** Stable identifier, e.g. "layout-chase" or "layout-bofa". */
  readonly name: string;

  /** Semver from this adapter's source. Bumped when the parser changes. */
  readonly version: string;

  /** Display name of the bank. Used for UI and provenance. */
  readonly bank_name: string;

  /**
   * Cheap probe: does this PDF look like one we can parse?
   * Receives a small text excerpt (e.g. first 4 KB of extracted text).
   * Must be deterministic and fast. No side effects.
   */
  detect(textSample: string): boolean;

  /**
   * Full parse. Receives the entire PDF text (with positions if available)
   * and returns either a successful ParseResult or throws a ParseError.
   * MUST NOT throw if the PDF format is structurally valid — it should
   * return all transactions it can find, and let the caller's checksum
   * gate decide whether to accept.
   */
  parse(pdfText: PdfTextWithPositions): Promise<ParseResult>;
}

/**
 * Output of PDF.js extraction, used as adapter input.
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
  x: number;        // horizontal position in PDF units
  y: number;        // vertical position
  width: number;
  height: number;
  font_size: number;
}

/**
 * Adapters throw ParseError when the PDF is structurally unparseable
 * (e.g., it's an image PDF, not a text PDF, or the format isn't what
 * detect() suggested). Caller catches this and refuses the import.
 */
export class ParseError extends Error {
  constructor(message: string, public readonly recoverable: boolean = false) {
    super(message);
  }
}
```

## Contract obligations

Every adapter MUST:

1. **Be deterministic.** Same PDF input → byte-identical ParseResult output. No randomness, no clock dependencies, no network calls.
2. **Be pure.** No global state, no module-level mutation. The adapter's behavior depends only on its inputs.
3. **Be fast.** `detect()` must return in <50ms for a 4KB text sample. `parse()` must complete in <2s for a typical 5-page statement.
4. **Populate every required field** of `ParsedTransaction`. `raw_text` is mandatory and must be the exact PDF line (not the cleaned description).
5. **Normalize amount sign.** Outflows are negative, inflows are positive. For credit card statements where purchases are typically positive in the PDF, the adapter INVERTS them.
6. **Report totals exactly as printed.** Whichever reconciliation fields are populated come from the statement's printed lines, NOT from summing parsed transactions. (The app layer's multi-level checksum gate uses these to independently verify the parsed sums.)
7. **Populate at least one strong checksum level (A, B, or C) per statement.** The `parser_provides` array MUST list the levels for which the adapter has populated the required fields. If the adapter cannot extract enough information for ANY of A/B/C from a given statement, it MUST throw `ParseError('insufficient verification available — only Level D possible')` rather than return a result the app can't validate.
8. **Not perform persistence.** Adapters return data structures only. They never touch SQLite, IndexedDB, or any storage.
9. **Have a regression fixture.** Each adapter ships with at least one anonymized real statement in `tests/fixtures/<adapter-name>/` plus an `expected.json` capturing the expected `ParseResult`. Snapshot tests in CI enforce no drift.

Every adapter MUST NOT:

- Make network calls.
- Read environment variables or browser globals (except for what's passed in via PdfTextWithPositions).
- Import from `src/lib/db/` or `src/lib/app/`. Adapters are leaves in the dependency graph; nothing in Layer 2 or 3 may be imported.
- Use floating-point arithmetic for money. All cent values are constructed via integer parsing (e.g. `"$1,234.56"` → `123456`).
- Use AI / LLMs / cloud services. Deterministic code only (per constitution Principle VII).

## Contract for the detector

`src/lib/adapters/detector.ts` exposes:

```typescript
export interface BankDetectionResult {
  adapter: BankAdapter;
  confidence: number;   // 0.0 - 1.0
}

/**
 * Given the full text content of a PDF (first page is usually enough),
 * returns the adapter with the highest confidence that the PDF belongs
 * to its bank, or null if no adapter recognizes it.
 *
 * Implementation: calls detect() on every registered adapter, picks
 * the one with the strongest signal.
 */
export function detectAdapter(textSample: string): BankDetectionResult | null;

/**
 * Registry. Adapters self-register at module import time.
 */
export function registerAdapter(adapter: BankAdapter): void;
export function listAdapters(): BankAdapter[];
```

## Acceptance criteria for a new adapter

Before a new bank is merged:

1. At least one anonymized real statement exists under `tests/fixtures/<adapter-name>/`.
2. The adapter's snapshot test passes (parsed output matches the committed `expected.json` byte-for-byte).
3. The checksum invariant test passes (sum of `amount_minor` for outflows equals `total_debits_minor`; sum for inflows equals `total_credits_minor`).
4. The adapter's `name` is unique across all registered adapters.
5. The detector reliably picks this adapter for the fixture PDF (no false-positive against other adapters' fixtures).
6. No floats appear in the adapter's source code (ESLint rule enforces).
7. No imports from `src/lib/db/` or `src/lib/app/` (ESLint rule enforces).
