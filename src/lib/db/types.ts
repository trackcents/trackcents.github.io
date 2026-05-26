// Layer 2 (storage) types per specs/001-money-tracker-mvp/data-model.md
// and specs/001-money-tracker-mvp/contracts/storage-repository.md.
//
// These are the in-memory shapes the repository returns and accepts.  Money
// values are bigint (integer cents) end-to-end — no floats anywhere.
//
// One-to-one with the SQL tables defined in data-model.md.

import type { TransactionStatus, TransactionType, ChecksumLevel } from '../adapters/types';

export type AccountId = string; // ULID
export type StatementId = string; // ULID
export type TransactionId = string; // ULID
export type LinkId = string; // ULID
export type CategoryId = string; // ULID (reserved for v1.1 categorization)

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'loan' | 'cash' | 'other';

export interface Account {
  id: AccountId;
  bank_name: string;
  account_type: AccountType;
  account_nickname: string;
  account_last_4: string | null;
  currency: string;
  created_at: string; // ISO timestamp
}

export type ImportStatus = 'imported' | 'pending_review' | 'refused';

export interface Statement {
  id: StatementId;
  account_id: AccountId;
  period_start: string; // ISO YYYY-MM-DD
  period_end: string;
  // Level A reconciliation fields
  opening_balance_minor: bigint | null;
  closing_balance_minor: bigint | null;
  // Level B reconciliation fields
  total_debits_minor: bigint | null;
  total_credits_minor: bigint | null;
  // Level C credit-card balance fields
  statement_balance_minor: bigint | null;
  previous_balance_minor: bigint | null;
  // Level D supplementary
  printed_transaction_count: number | null;
  // Audit
  checksum_strategy_used: string | null; // e.g. "A", "A+B", "C"; NULL when refused
  pdf_source_hash: string; // SHA-256 hex
  pdf_filename: string | null;
  parser_name: string;
  parser_version: string;
  import_status: ImportStatus;
  refusal_reason: string | null;
  imported_at: string;
}

export interface Transaction {
  id: TransactionId;
  account_id: AccountId;
  statement_id: StatementId;
  posted_date: string; // ISO YYYY-MM-DD
  description: string; // cleaned for display
  raw_text: string; // original PDF line, byte-for-byte
  amount_minor: bigint; // signed integer cents
  currency: string;
  fx_rate: number | null;
  amount_home_minor: bigint | null;
  status: TransactionStatus;
  transaction_type: TransactionType;
  linked_transaction_id: TransactionId | null;
  // Reserved for v1.1 categorization
  category_id: CategoryId | null;
  category_locked_by_user: boolean;
  // Reserved for v1.1 notes
  note: string | null;
  // Idempotency
  description_hash: string;
  // Provenance
  parser_name: string;
  parser_version: string;
  // Timestamps
  created_at: string;
  updated_at: string;
  // Per-field LWW timestamps for editable fields (used by sync conflict resolution)
  category_id_updated_at: string | null;
  note_updated_at: string | null;
}

export type ReconciliationLinkType = 'auto' | 'manual';

export interface ReconciliationLink {
  id: LinkId;
  bank_transaction_id: TransactionId;
  cc_statement_id: StatementId;
  link_type: ReconciliationLinkType;
  confidence_score: number | null; // 0.0-1.0 for auto; null for manual
  created_at: string;
}

export interface UserSettings {
  home_currency: string;
  theme: 'light' | 'dark' | 'system';
  autosync_enabled: boolean;
  autosync_on_close: boolean;
  recovery_code_enabled: boolean;
  ios_install_dismissed: boolean;
  reconciliation_date_window_days: number;
  created_at: string;
  updated_at: string;
}

export interface EncryptionMetadata {
  salt_b64: string;
  kdf_algorithm: 'PBKDF2-SHA-256';
  kdf_iterations: number;
  blob_version: number;
  created_at: string;
}

// ── Insert / update shapes (the repo accepts these; the timestamps are
//    server-generated, IDs are caller-generated) ───────────────────────────

export interface NewAccount {
  bank_name: string;
  account_type: AccountType;
  account_nickname: string;
  account_last_4: string | null;
  currency: string;
}

export interface NewStatement {
  account_id: AccountId;
  period_start: string;
  period_end: string;
  opening_balance_minor: bigint | null;
  closing_balance_minor: bigint | null;
  total_debits_minor: bigint | null;
  total_credits_minor: bigint | null;
  statement_balance_minor: bigint | null;
  previous_balance_minor: bigint | null;
  printed_transaction_count: number | null;
  checksum_strategy_used: string | null;
  pdf_source_hash: string;
  pdf_filename: string | null;
  parser_name: string;
  parser_version: string;
  import_status: ImportStatus;
  refusal_reason: string | null;
}

export interface NewTransaction {
  account_id: AccountId;
  posted_date: string;
  description: string;
  raw_text: string;
  amount_minor: bigint;
  currency: string;
  fx_rate: number | null;
  amount_home_minor: bigint | null;
  status: TransactionStatus;
  transaction_type: TransactionType;
  description_hash: string;
  parser_name: string;
  parser_version: string;
}

// ── Query types ─────────────────────────────────────────────────────────────

export interface TransactionFilter {
  account_ids?: AccountId[];
  date_start?: string;
  date_end?: string;
  amount_min_minor?: bigint;
  amount_max_minor?: bigint;
  description_contains?: string;
  transaction_types?: TransactionType[];
}

export interface TransactionListResult {
  rows: Transaction[];
  total_count: number;
  has_more: boolean;
}

export interface ChecksumLevelResult {
  level: ChecksumLevel;
  passed: boolean;
  expected_minor: bigint | null;
  actual_minor: bigint | null;
  diff_minor: bigint | null;
}
