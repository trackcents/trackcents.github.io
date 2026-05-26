# Contract: Storage Repository (Layer 2)

The repository is the only module allowed to talk to SQLite directly. Every other module reads and writes through these functions. This isolates persistence so that swapping wa-sqlite for an alternate backend in the future requires changes to only one file.

## TypeScript interface

```typescript
// src/lib/db/repository.ts

import type {
  ParsedStatement,
  ParsedTransaction,
} from '../adapters/types';

// ── Domain entity types (one-to-one with SQL tables) ───────────────────────

export type AccountId = string;       // ULID
export type StatementId = string;     // ULID
export type TransactionId = string;   // ULID
export type LinkId = string;          // ULID

export interface Account {
  id: AccountId;
  bank_name: string;
  account_type: 'checking' | 'savings' | 'credit_card' | 'loan' | 'cash' | 'other';
  account_nickname: string;
  account_last_4: string | null;
  currency: string;
  created_at: string;
}

export interface Statement {
  id: StatementId;
  account_id: AccountId;
  period_start: string;
  period_end: string;
  opening_balance_minor: number | null;
  closing_balance_minor: number | null;
  statement_balance_minor: number | null;
  previous_balance_minor: number | null;
  total_debits_minor: number;
  total_credits_minor: number;
  pdf_source_hash: string;
  pdf_filename: string | null;
  parser_name: string;
  parser_version: string;
  import_status: 'imported' | 'pending_review' | 'refused';
  refusal_reason: string | null;
  imported_at: string;
}

export interface Transaction {
  id: TransactionId;
  account_id: AccountId;
  statement_id: StatementId;
  posted_date: string;
  description: string;
  raw_text: string;
  amount_minor: number;
  currency: string;
  fx_rate: number | null;
  amount_home_minor: number | null;
  status: 'pending' | 'posted' | 'disputed' | 'reversed';
  transaction_type: TransactionType;
  linked_transaction_id: TransactionId | null;
  category_id: string | null;
  note: string | null;
  description_hash: string;
  parser_name: string;
  parser_version: string;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationLink {
  id: LinkId;
  bank_transaction_id: TransactionId;
  cc_statement_id: StatementId;
  link_type: 'auto' | 'manual';
  confidence_score: number | null;
  created_at: string;
}

// ── Account operations ─────────────────────────────────────────────────────

/** Find an account by its identifying tuple. Returns null if absent. */
export function findAccount(
  bank_name: string,
  account_type: Account['account_type'],
  account_last_4: string | null
): Promise<Account | null>;

/** Create a new account. Throws if a duplicate already exists. */
export function createAccount(input: Omit<Account, 'id' | 'created_at'>): Promise<Account>;

/** List every account, sorted by nickname. */
export function listAccounts(): Promise<Account[]>;

// ── Statement operations ───────────────────────────────────────────────────

/**
 * Insert a statement record. If the same (account_id, period_start, period_end,
 * pdf_source_hash) tuple already exists, returns the existing statement
 * (idempotent re-import). Does NOT insert transactions; that's a separate call.
 */
export function insertStatement(
  input: Omit<Statement, 'id' | 'imported_at'>
): Promise<{ statement: Statement; was_new: boolean }>;

/**
 * Mark a statement as refused with a reason. Used when checksum fails.
 * Does NOT insert any transactions; the statement metadata is the only artifact.
 */
export function markStatementRefused(
  statement_id: StatementId,
  refusal_reason: string
): Promise<void>;

export function findStatementById(id: StatementId): Promise<Statement | null>;

export function listStatementsByAccount(account_id: AccountId): Promise<Statement[]>;

// ── Transaction operations ─────────────────────────────────────────────────

/**
 * Bulk-insert transactions for a statement.
 *
 * The unique idempotency index on (account_id, posted_date, amount_minor,
 * description_hash) silently rejects duplicates. Returns the count of rows
 * actually inserted (which may be less than transactions.length if some
 * collided with prior imports).
 *
 * Wrapped in a SQLite transaction. If any single row fails for a non-idempotency
 * reason, the entire batch rolls back.
 */
export function bulkInsertTransactions(
  statement_id: StatementId,
  transactions: Array<Omit<Transaction,
    'id' | 'statement_id' | 'created_at' | 'updated_at' |
    'category_id' | 'note' | 'linked_transaction_id'
  >>
): Promise<{ inserted: number; skipped_duplicates: number }>;

/** Find a single transaction. */
export function findTransactionById(id: TransactionId): Promise<Transaction | null>;

// ── Unified search (US-P1-E) ───────────────────────────────────────────────

export interface TransactionFilter {
  account_ids?: AccountId[];
  date_start?: string;     // ISO YYYY-MM-DD
  date_end?: string;
  amount_min_minor?: number;
  amount_max_minor?: number;
  description_contains?: string;   // case-insensitive substring
  transaction_types?: Transaction['transaction_type'][];
}

export interface TransactionListResult {
  rows: Transaction[];
  total_count: number;     // before pagination
  has_more: boolean;
}

/**
 * Paginated, filtered list. Default ordering: posted_date DESC, then id DESC.
 * Caller-specified order overrides via order_by.
 */
export function listTransactions(
  filter: TransactionFilter,
  page: { limit: number; offset: number; order_by?: string }
): Promise<TransactionListResult>;

// ── Reconciliation links (US-P1-D) ─────────────────────────────────────────

/**
 * Persist a (bank-tx ↔ cc-statement) link. Bank tx must have
 * transaction_type = 'payment_to_card'. CC statement must belong to
 * an account whose type = 'credit_card'.
 */
export function createReconciliationLink(input: Omit<ReconciliationLink, 'id' | 'created_at'>): Promise<ReconciliationLink>;

/** Remove a link. */
export function deleteReconciliationLink(id: LinkId): Promise<void>;

/** Find any existing link for a given bank tx. (At most one per bank tx.) */
export function findLinkByBankTransaction(bank_transaction_id: TransactionId): Promise<ReconciliationLink | null>;

/** Find candidates for auto-matching: bank tx of type payment_to_card with no existing link. */
export function findUnlinkedPaymentsToCard(): Promise<Transaction[]>;

/**
 * For drill-through: given a bank payment_to_card transaction, return the
 * linked CC statement (if any) and ALL its transactions.
 */
export function getReconciliationDrilldown(
  bank_transaction_id: TransactionId
): Promise<{ cc_statement: Statement; cc_transactions: Transaction[] } | null>;

// ── Settings + encryption metadata ─────────────────────────────────────────

export function getUserSettings(): Promise<UserSettings>;
export function updateUserSettings(patch: Partial<UserSettings>): Promise<UserSettings>;

export function getEncryptionMetadata(): Promise<EncryptionMetadata | null>;
export function initializeEncryptionMetadata(salt_b64: string): Promise<EncryptionMetadata>;
```

## Contract obligations

The repository implementation MUST:

1. **Wrap every multi-row write in a SQLite transaction.** A partial import is unacceptable. If any row of a bulk insert fails for a non-idempotency reason, the entire batch rolls back and the caller sees an error.
2. **Use parameterized queries everywhere.** No string concatenation of user input into SQL. (No SQL injection risk anyway since SQLite is local, but it's still hygiene.)
3. **Generate ULIDs in JavaScript** before insert. SQLite does not auto-generate them. ULIDs are sortable by time and globally unique.
4. **Return entity objects with all columns populated.** Callers should never need to do a second query to "fill in" a row.
5. **Convert dates to ISO strings.** SQLite stores dates as TEXT in our schema; the repository serializes/deserializes consistently.
6. **Throw on integrity violations.** Foreign key violations, CHECK constraint failures, and unexpected unique-index conflicts surface as exceptions, NOT silent no-ops. Exception: the idempotency unique index in `bulkInsertTransactions` is the ONE place where the repository swallows the conflict and counts it as "skipped duplicate."
7. **NOT cache.** Each call hits SQLite. Caching is the application layer's concern.
8. **NOT mutate inputs.** All inputs are treated as read-only.

The repository MUST NOT:

- Implement business logic (reconciliation matching, checksum validation, etc.). Those live in `src/lib/app/`.
- Read or write any file outside SQLite. PDF reading, fixture loading, etc. are not the repository's job.
- Call out to encryption. Encryption wraps the entire SQLite file at sync time; the repository sees plaintext rows.

## Concurrency model

SQLite-WASM is single-threaded per database connection. The repository owns one connection. All calls are serialized through the connection's command queue. Callers receive Promises; the repository does not expose synchronous APIs.

## Migration responsibility

The repository module bootstraps the schema on first open:

1. Opens or creates the OPFS-backed SQLite file.
2. Reads `schema_migrations` table; if absent, creates it.
3. Applies any migrations whose version is greater than the highest applied.
4. Migrations are pure SQL files in `src/lib/db/migrations/NNNN_name.sql`, executed in order.

Migrations MUST be additive in v1 (no destructive changes to existing tables). Schema-altering migrations require explicit user-data backup before they run.
