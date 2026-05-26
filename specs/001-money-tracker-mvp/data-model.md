# Phase 1 Data Model — Money Tracker v1

**Branch**: `001-money-tracker-mvp` | **Date**: 2026-05-23 | **Plan**: [plan.md](./plan.md)

The authoritative SQL schema for the local SQLite database. This is the single source of truth for the data layer; TypeScript types are generated from this file.

All money values are stored as **INTEGER minor units** (cents). No floating-point. Where summing transaction amounts could exceed 2^53 (rare for personal finance, but possible if storing multi-year history with very large transfers), the application layer uses BigInt arithmetic.

---

## Entity overview

| Entity | Purpose | Approx. row count per user |
|---|---|---|
| `accounts` | One row per bank account or credit card | 2-10 |
| `statements` | One row per imported PDF | 50-300 (over years) |
| `transactions` | One row per line item from a statement | 5,000-30,000 |
| `reconciliation_links` | One row per linked (bank-tx ↔ CC statement) pair | 50-300 |
| `user_settings` | Single-row preferences table | 1 |
| `encryption_metadata` | Non-secret KDF parameters | 1 |
| `schema_migrations` | Migration version tracking | grows with releases |

---

## SQL schema (canonical)

```sql
-- =========================================================================
-- Migrations bookkeeping
-- =========================================================================
CREATE TABLE schema_migrations (
  version       INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- accounts
-- One row per distinct (bank_name, account_last_4, account_type) tuple.
-- =========================================================================
CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,                  -- ULID
  bank_name         TEXT NOT NULL,                     -- e.g. "Bank of America"
  account_type      TEXT NOT NULL CHECK (account_type IN (
                      'checking', 'savings', 'credit_card', 'loan', 'cash', 'other'
                    )),
  account_nickname  TEXT NOT NULL,                     -- user-chosen, e.g. "BoA Visa"
  account_last_4    TEXT,                              -- last 4 of card / account #, may be null for cash
  currency          TEXT NOT NULL DEFAULT 'USD',       -- ISO 4217 code
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bank_name, account_type, account_last_4)
);

CREATE INDEX idx_accounts_bank ON accounts (bank_name);

-- =========================================================================
-- statements
-- One row per imported PDF. Stores the printed totals for the checksum gate.
-- =========================================================================
CREATE TABLE statements (
  id                    TEXT PRIMARY KEY,              -- ULID
  account_id            TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start          TEXT NOT NULL,                 -- ISO date (YYYY-MM-DD)
  period_end            TEXT NOT NULL,                 -- ISO date
  opening_balance_minor  INTEGER,                       -- bank statements; integer cents, signed; required for Level A checksum
  closing_balance_minor  INTEGER,                       -- bank statements; integer cents, signed; required for Level A checksum
  statement_balance_minor INTEGER,                      -- credit cards: "new balance" line; required for Level C checksum
  previous_balance_minor  INTEGER,                       -- credit cards: "previous balance" line; required for Level C checksum
  total_debits_minor     INTEGER,                        -- NULLABLE; absolute sum (positive); cents; populated for Level B checksum when bank prints it
  total_credits_minor    INTEGER,                        -- NULLABLE; absolute sum (positive); cents; populated for Level B checksum when bank prints it
  printed_transaction_count INTEGER,                     -- NULLABLE; populated for Level D supplementary check when bank prints it
  checksum_strategy_used TEXT,                           -- which checksum level(s) passed: e.g. "A", "A+B", "C", "A+B+D"; NULL if import refused
  pdf_source_hash       TEXT NOT NULL,                 -- SHA-256 of original PDF bytes
  pdf_filename          TEXT,                          -- original filename, not used for matching
  parser_name           TEXT NOT NULL,                 -- e.g. "layout-chase" or "layout-bofa-checking"
  parser_version        TEXT NOT NULL,                 -- semver from the adapter
  import_status         TEXT NOT NULL CHECK (import_status IN (
                          'imported', 'pending_review', 'refused'
                        )),
  refusal_reason        TEXT,                          -- null unless import_status = 'refused' or 'pending_review'; includes failed-level details
  imported_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, period_start, period_end, pdf_source_hash)
);

CREATE INDEX idx_statements_account ON statements (account_id);
CREATE INDEX idx_statements_period ON statements (period_start, period_end);
CREATE INDEX idx_statements_status ON statements (import_status);

-- =========================================================================
-- transactions
-- One row per parsed transaction line. Carries full source provenance.
-- =========================================================================
CREATE TABLE transactions (
  id                  TEXT PRIMARY KEY,                -- ULID
  account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  statement_id        TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,

  -- Money + dates
  posted_date         TEXT NOT NULL,                   -- ISO date (YYYY-MM-DD)
  description         TEXT NOT NULL,                   -- cleaned for display
  raw_text            TEXT NOT NULL,                   -- original PDF line, byte-for-byte (audit)
  amount_minor        INTEGER NOT NULL,                -- signed integer cents (negative = outflow)
  currency            TEXT NOT NULL DEFAULT 'USD',
  fx_rate             REAL,                            -- null if same as home currency
  amount_home_minor   INTEGER,                         -- pre-computed in home currency, null if same

  -- Status & type
  status              TEXT NOT NULL DEFAULT 'posted'
                        CHECK (status IN ('pending', 'posted', 'disputed', 'reversed')),
  transaction_type    TEXT NOT NULL DEFAULT 'purchase'
                        CHECK (transaction_type IN (
                          'purchase', 'refund', 'transfer', 'fee', 'interest',
                          'payment_to_card', 'deposit', 'withdrawal', 'other'
                        )),

  -- Linked-transaction (for refunds / transfers / payment_to_card)
  linked_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,

  -- Categorization (P2 — reserved columns, NULL in v1)
  category_id         TEXT,                            -- references categories(id) when P2 lands
  category_locked_by_user INTEGER NOT NULL DEFAULT 0,  -- 0/1; manual override flag

  -- Notes / tags (P3 — reserved, NULL in v1)
  note                TEXT,

  -- Idempotency (FR-016)
  description_hash    TEXT NOT NULL,                   -- SHA-256 of normalized description for dedup

  -- Provenance (FR-017)
  parser_name         TEXT NOT NULL,
  parser_version      TEXT NOT NULL,

  -- Timestamps
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

  -- Per-field LWW timestamps for editable fields (sync conflict resolution; P2+)
  category_id_updated_at TEXT,
  note_updated_at        TEXT,

  -- Idempotency unique constraint (FR-016)
  UNIQUE (account_id, posted_date, amount_minor, description_hash)
);

CREATE INDEX idx_transactions_account_date ON transactions (account_id, posted_date);
CREATE INDEX idx_transactions_statement ON transactions (statement_id);
CREATE INDEX idx_transactions_type ON transactions (transaction_type);
CREATE INDEX idx_transactions_linked ON transactions (linked_transaction_id) WHERE linked_transaction_id IS NOT NULL;
CREATE INDEX idx_transactions_date_global ON transactions (posted_date);

-- Full-text search on description (Phase 2; SQLite FTS5)
CREATE VIRTUAL TABLE transactions_fts USING fts5(
  description,
  raw_text,
  content='transactions',
  content_rowid='rowid'
);

-- =========================================================================
-- reconciliation_links
-- Links a bank-statement "payment_to_card" transaction to the
-- credit card statement it paid down.
-- =========================================================================
CREATE TABLE reconciliation_links (
  id                  TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  cc_statement_id     TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  link_type           TEXT NOT NULL CHECK (link_type IN ('auto', 'manual')),
  confidence_score    REAL,                            -- 0.0 - 1.0; only meaningful when link_type = 'auto'
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bank_transaction_id),                       -- a bank tx links to at most one CC statement
  UNIQUE (cc_statement_id, bank_transaction_id)
);

CREATE INDEX idx_reconciliation_bank_tx ON reconciliation_links (bank_transaction_id);
CREATE INDEX idx_reconciliation_cc_stmt ON reconciliation_links (cc_statement_id);

-- =========================================================================
-- user_settings
-- Single-row preferences (id is constant). Convenient for upserts.
-- =========================================================================
CREATE TABLE user_settings (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  home_currency            TEXT NOT NULL DEFAULT 'USD',
  theme                    TEXT NOT NULL DEFAULT 'system'  -- light/dark/system
                             CHECK (theme IN ('light', 'dark', 'system')),
  autosync_enabled         INTEGER NOT NULL DEFAULT 1,     -- 0/1
  autosync_on_close        INTEGER NOT NULL DEFAULT 1,
  recovery_code_enabled    INTEGER NOT NULL DEFAULT 0,
  ios_install_dismissed    INTEGER NOT NULL DEFAULT 0,
  reconciliation_date_window_days INTEGER NOT NULL DEFAULT 10,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed a single row at migration time:
-- INSERT INTO user_settings (id) VALUES (1);

-- =========================================================================
-- encryption_metadata
-- Non-secret material needed to derive the key on each device.
-- The salt is included in the encrypted blob header and is NOT secret.
-- =========================================================================
CREATE TABLE encryption_metadata (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  salt_b64           TEXT NOT NULL,                    -- base64; >=16 bytes random
  kdf_algorithm      TEXT NOT NULL DEFAULT 'PBKDF2-SHA-256',
  kdf_iterations     INTEGER NOT NULL DEFAULT 600000,
  blob_version       INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- Schema migrations table is populated as we go; example for v1:
-- INSERT INTO schema_migrations (version, name) VALUES (1, '0001_initial');
-- =========================================================================
```

---

## Field-by-field notes (the non-obvious bits)

### `accounts`
- **`account_nickname`** is captured the first time a `(bank_name, account_last_4)` pair is seen during import. The user is prompted; the value is reused for subsequent imports.
- **`UNIQUE (bank_name, account_type, account_last_4)`** prevents the same account being created twice. Note: `account_last_4` can be NULL for cash; the unique constraint allows multiple NULL last_4 with different `account_type`.

### `statements`
- **`pdf_source_hash`** is SHA-256 of the raw PDF bytes (computed before parsing). Two PDFs with the same hash are the same file.
- **`UNIQUE (account_id, period_start, period_end, pdf_source_hash)`** lets a user re-upload the same PDF; the row is upserted, not duplicated. Different PDFs covering the same period (e.g., a corrected statement) get separate rows.
- **`import_status = 'refused'`** means checksum failed; the statement metadata is saved (for audit) but NO transactions are inserted. **`import_status = 'pending_review'`** is reserved for cases where parsing succeeded but the user needs to confirm something (e.g., new account nickname).
- **Checksum strategy fields** (per `research.md §R13`): `opening_balance_minor` + `closing_balance_minor` support **Level A** (balance reconciliation, the most universally applicable check). `total_debits_minor` + `total_credits_minor` are NULLABLE and support **Level B** (aggregate totals) when the bank prints them. `previous_balance_minor` + `statement_balance_minor` support **Level C** for credit cards. `printed_transaction_count` supports **Level D** (supplementary, never sufficient alone). `checksum_strategy_used` records which levels actually passed (e.g., `"A"`, `"A+B"`, `"C"`, `"A+B+D"`) and is `NULL` for refused imports. The application MUST refuse the import unless at least one of A/B/C passes; D alone is never sufficient.

### `transactions`
- **`amount_minor`** is signed. By convention: outflow (spending, debit) is negative, inflow (deposit, payment received) is positive. Credit card statements are normalized to this convention by the adapter (cards natively use positive=purchase, which the adapter inverts).
- **`description_hash`** is SHA-256 of a normalized version of the description (uppercase, whitespace collapsed, common date/reference suffixes stripped). Used only for idempotency.
- **`UNIQUE (account_id, posted_date, amount_minor, description_hash)`** is the idempotency gate (FR-016). Re-importing the same statement does NOT create duplicates.
- **`raw_text`** preserves the original PDF line exactly, even if it had weird whitespace or punctuation. Used for audit and for displaying the source in the drill-down.
- **`linked_transaction_id`** has three uses:
  - For `transaction_type = 'refund'`: points to the original purchase being refunded.
  - For `transaction_type = 'transfer'`: points to the matching transfer on the other account (e.g., the deposit side of a checking → savings transfer).
  - For `transaction_type = 'payment_to_card'`: NOT used here — reconciliation_links table is used instead because we link to a STATEMENT, not a single transaction.
- **`category_id`**, **`note`**, **`category_id_updated_at`**, **`note_updated_at`** are reserved columns. Always NULL in v1. Used in v1.1+ for categorization and sync conflict resolution.

### `reconciliation_links`
- One row per (bank_tx, cc_statement) link. **`UNIQUE (bank_transaction_id)`** enforces that a single bank-side payment maps to at most one CC statement (which is the realistic case).
- **`link_type = 'auto'`** means the matching algorithm (per `research.md` §R12) inferred the link. **`link_type = 'manual'`** means the user established it explicitly. Manual overrides take precedence — if a user manually changes a link, future auto-matching does not overwrite it.

### `user_settings`
- Single-row enforcement via `CHECK (id = 1)` plus an INSERT-once-on-migration.

### `encryption_metadata`
- The salt is generated once per user at first setup. Once stored, it MUST NOT change — changing the salt would orphan the existing encrypted blob.

---

## v1 vs. future-version usage

| Column | v1 status |
|---|---|
| `transactions.category_id` | Reserved, always NULL. Populated when v1.1 categorization lands. |
| `transactions.note` | Reserved, always NULL. Populated when P3 notes lands. |
| `transactions.category_id_updated_at` / `note_updated_at` | Reserved. Populated by per-field LWW logic when sync (Phase 3) + edits land. |
| `transactions.fx_rate` / `amount_home_minor` | Reserved if home currency = transaction currency. Populated when P3 multi-currency UI lands. |
| `user_settings.recovery_code_enabled` | Toggleable in v1 (US-P1-A acceptance scenario 4). |
| `transactions_fts` (virtual FTS5 table) | Created in v1 but search uses simple LIKE for first cut; FTS5 wired in Phase 2 once unified view (US-P1-E) needs it. |

---

## Example data flow — import a Chase checking statement

1. User drops `chase_2026_03.pdf`.
2. Adapter computes `pdf_source_hash = SHA-256(file bytes)`.
3. Adapter detects bank = Chase, account_type = checking, account_last_4 from PDF header.
4. App checks if an `accounts` row exists for `(Chase, checking, 1234)`. If not, prompt user for nickname → INSERT into `accounts`.
5. Adapter parses transactions into a JS array of `{posted_date, description, raw_text, amount_minor, transaction_type, ...}`.
6. Adapter populates whatever `ParsedStatement` reconciliation fields it can extract from the statement (Level A: opening/closing balance; Level B: aggregate debits/credits totals if printed; Level C: previous/statement balance for cards; Level D: printed transaction count if available).
7. App runs every applicable checksum level. If none of A/B/C are populated, OR if any populated level disagrees with parsed sums, INSERT into `statements` with `import_status = 'refused'`, `refusal_reason` describing which level(s) failed, `checksum_strategy_used = NULL`, and return; do NOT insert any transactions.
8. If at least one of A/B/C passes AND every populated level passes:
   - INSERT into `statements` with full metadata, `import_status = 'imported'`, `checksum_strategy_used` recording the levels that passed (e.g. `"A+B"`).
   - INSERT each transaction with `description_hash` computed. The unique idempotency index silently rejects any row already present.
9. For each new `transaction_type = 'payment_to_card'` row, run the reconciliation matcher (research.md §R12). If a match exists, INSERT into `reconciliation_links`.

All operations wrapped in a single SQLite transaction so a failure at any step rolls back cleanly.

---

## Validation rules

| Rule | Enforced by |
|---|---|
| Money is integer cents (no floats) | TypeScript type system + SQLite INTEGER column type + ESLint guard |
| Multi-level checksum passes (at least one of Level A/B/C; all available levels) | Application logic (FR-013, FR-014; per research.md §R13) before INSERT to `transactions` |
| Refused-import statement records carry `checksum_strategy_used = NULL` and a populated `refusal_reason` | Application logic at gate-decision time |
| No duplicate transactions on re-import | UNIQUE index on `(account_id, posted_date, amount_minor, description_hash)` |
| Status / type / link_type values valid | SQLite CHECK constraints |
| account_nickname is non-empty | Application logic at import time |
| Two CC statements cannot link to the same bank payment | UNIQUE index on `reconciliation_links.bank_transaction_id` |
| Foreign-currency rows must have fx_rate + amount_home_minor populated | Application logic (deferred to P3 UI; schema allows nullable for v1) |

---

## State transitions (statements)

```
                              checksum passes
                       ┌─────────────────────────┐
   user drops PDF      │                         ▼
   ───────────────►  parsing ────► imported  (transactions inserted)
                       │
                       │ checksum fails
                       └─────► refused   (no transactions inserted; refusal_reason set)
                       │
                       │ parser needs user input (new account nickname, etc.)
                       └─────► pending_review
                                    │
                                    │ user confirms
                                    ▼
                                imported
```

Once `imported`, statements are immutable in v1 (no edits to the statement metadata or its transactions). v1.1+ may introduce manual edits on transactions for category/note, but the statement record itself stays immutable.
