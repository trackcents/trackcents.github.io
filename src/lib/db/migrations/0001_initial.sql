-- Migration 0001 — initial schema bootstrap.
--
-- Creates every table defined in src/lib/db/schema.sql and seeds the
-- single-row user_settings.  The encryption_metadata row is seeded later by
-- the onboarding flow (it depends on a random salt and the user-chosen
-- KDF iteration count, both of which only exist after passphrase setup).
--
-- This migration runs once per local database, on first open.  The
-- schema_migrations bookkeeping row at the end is the marker that prevents
-- re-running on subsequent opens.

-- The schema body lives in schema.sql and is identical to what's below.
-- Migration files duplicate it so they remain a self-contained snapshot of
-- the schema state at their version (the canonical schema.sql evolves; a
-- migration file does not, ever, once shipped).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  bank_name        TEXT NOT NULL,
  account_type     TEXT NOT NULL CHECK (account_type IN (
                     'checking', 'savings', 'credit_card', 'loan', 'cash', 'other'
                   )),
  account_nickname TEXT NOT NULL,
  account_last_4   TEXT,
  currency         TEXT NOT NULL DEFAULT 'USD',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bank_name, account_type, account_last_4)
);
CREATE INDEX IF NOT EXISTS idx_accounts_bank ON accounts (bank_name);

CREATE TABLE IF NOT EXISTS statements (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start             TEXT NOT NULL,
  period_end               TEXT NOT NULL,
  opening_balance_minor    INTEGER,
  closing_balance_minor    INTEGER,
  statement_balance_minor  INTEGER,
  previous_balance_minor   INTEGER,
  total_debits_minor       INTEGER,
  total_credits_minor      INTEGER,
  printed_transaction_count INTEGER,
  checksum_strategy_used   TEXT,
  pdf_source_hash          TEXT NOT NULL,
  pdf_filename             TEXT,
  parser_name              TEXT NOT NULL,
  parser_version           TEXT NOT NULL,
  import_status            TEXT NOT NULL CHECK (import_status IN (
                             'imported', 'pending_review', 'refused'
                           )),
  refusal_reason           TEXT,
  imported_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, period_start, period_end, pdf_source_hash)
);
CREATE INDEX IF NOT EXISTS idx_statements_account ON statements (account_id);
CREATE INDEX IF NOT EXISTS idx_statements_period ON statements (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_statements_status ON statements (import_status);

CREATE TABLE IF NOT EXISTS transactions (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_id            TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  posted_date             TEXT NOT NULL,
  description             TEXT NOT NULL,
  raw_text                TEXT NOT NULL,
  amount_minor            INTEGER NOT NULL,
  currency                TEXT NOT NULL DEFAULT 'USD',
  fx_rate                 REAL,
  amount_home_minor       INTEGER,
  status                  TEXT NOT NULL DEFAULT 'posted'
                            CHECK (status IN ('pending', 'posted', 'disputed', 'reversed')),
  transaction_type        TEXT NOT NULL DEFAULT 'purchase'
                            CHECK (transaction_type IN (
                              'purchase', 'refund', 'transfer', 'fee', 'interest',
                              'payment_to_card', 'deposit', 'withdrawal', 'other'
                            )),
  linked_transaction_id   TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  category_id             TEXT,
  category_locked_by_user INTEGER NOT NULL DEFAULT 0,
  note                    TEXT,
  description_hash        TEXT NOT NULL,
  parser_name             TEXT NOT NULL,
  parser_version          TEXT NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  category_id_updated_at  TEXT,
  note_updated_at         TEXT,
  UNIQUE (account_id, posted_date, amount_minor, description_hash)
);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, posted_date);
CREATE INDEX IF NOT EXISTS idx_transactions_statement ON transactions (statement_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_linked ON transactions (linked_transaction_id) WHERE linked_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_date_global ON transactions (posted_date);

CREATE VIRTUAL TABLE IF NOT EXISTS transactions_fts USING fts5(
  description,
  raw_text,
  content='transactions',
  content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS reconciliation_links (
  id                  TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cc_statement_id     TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  link_type           TEXT NOT NULL CHECK (link_type IN ('auto', 'manual')),
  confidence_score    REAL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bank_transaction_id),
  UNIQUE (cc_statement_id, bank_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_bank_tx ON reconciliation_links (bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_cc_stmt ON reconciliation_links (cc_statement_id);

CREATE TABLE IF NOT EXISTS user_settings (
  id                              INTEGER PRIMARY KEY CHECK (id = 1),
  home_currency                   TEXT NOT NULL DEFAULT 'USD',
  theme                           TEXT NOT NULL DEFAULT 'system'
                                    CHECK (theme IN ('light', 'dark', 'system')),
  autosync_enabled                INTEGER NOT NULL DEFAULT 1,
  autosync_on_close               INTEGER NOT NULL DEFAULT 1,
  recovery_code_enabled           INTEGER NOT NULL DEFAULT 0,
  ios_install_dismissed           INTEGER NOT NULL DEFAULT 0,
  reconciliation_date_window_days INTEGER NOT NULL DEFAULT 30,
  created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS encryption_metadata (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  salt_b64       TEXT NOT NULL,
  kdf_algorithm  TEXT NOT NULL DEFAULT 'PBKDF2-SHA-256',
  kdf_iterations INTEGER NOT NULL DEFAULT 600000,
  blob_version   INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the single user_settings row.
INSERT OR IGNORE INTO user_settings (id) VALUES (1);

-- Record this migration as applied.
INSERT OR IGNORE INTO schema_migrations (version, name)
  VALUES (1, '0001_initial');
