# Feature Specification: Money Tracker v1 Foundation

**Feature Branch**: `001-money-tracker-mvp`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: Build a private, offline-first personal finance tool. Solve the user's specific problem of losing track of money flowing through bank accounts and credit cards each month. Biweekly paychecks fund monthly bills. Credit card payments from the bank account hide what was actually bought. Tool must reveal that lineage end-to-end while keeping all data on the user's devices, encrypted at rest and in any cloud backup.

## User Scenarios & Testing *(mandatory)*

> Five P1 stories define the MVP. Each is independently testable. If only one is implemented, the user still receives meaningful value from that story alone (with the understanding that the MVP delivers all five). Later stories (P2/P3/P4) are listed for roadmap clarity but not in scope for v1 implementation.

### User Story 1 — First-time setup and zero-knowledge passphrase (Priority: P1)

As a new user, I want to open the app and complete a one-time setup that establishes my identity, gives me an encryption key only I control, and prepares the app to receive statements — without installing anything.

**Why this priority**: Without onboarding, no one can use the app. Without zero-knowledge encryption set up before any data exists, we cannot honor the privacy principle. This is foundational to every other story.

**Independent Test**: A fresh user opens the URL on a stock Android Chrome, a stock iOS Safari (after performing Add to Home Screen when prompted), and a desktop Chrome. In each case the user can sign in with their Google account, grant the app permission to a single dedicated folder in their Drive, choose a passphrase that passes the strength meter, and reach the "ready to import" state.

**Acceptance Scenarios**:

1. **Given** the user is on iOS Safari and not in standalone (home-screen) mode, **When** they open the app URL, **Then** the app shows an installation prompt with an animated guide for Tap-Share-then-Add-to-Home-Screen and refuses to advance past it until the user reopens from the home screen.
2. **Given** the user has installed the app to home screen on iOS (or is on Android/desktop), **When** they reach the welcome screen, **Then** they can tap "Sign in with Google" and complete OAuth, after which the app holds an access token scoped to one Drive folder only.
3. **Given** the user has signed in, **When** they set their encryption passphrase, **Then** a strength meter scores it in real time, the app refuses any passphrase below a documented minimum strength, and a clear warning is shown that without the passphrase no one — including the developer — can recover their data.
4. **Given** the user opted into the optional one-time recovery code, **When** they confirm the code is saved, **Then** the encrypted recovery payload is stored alongside the main blob in their Drive folder.
5. **Given** a returning user opens the app on a known device with cached salt, **When** they enter the passphrase, **Then** the key derivation succeeds and the local cache is decrypted.

---

### User Story 2 — Import a bank statement with verified accuracy (Priority: P1)

As a user, I want to drop a bank statement PDF onto the app and immediately see every transaction parsed into a clean, scrollable table — with absolute confidence that nothing was missed or misread.

**Why this priority**: PDF parsing is the riskiest unknown in this project. If parsing does not work reliably on the user's real statements, the entire tool is unusable. The checksum invariant makes parsing safe — refused imports are acceptable; silent errors are not.

**Independent Test**: Provided one of the user's anonymized real bank statements, the user drops the file on the app and sees a table of every transaction. The sum of all parsed amounts exactly matches the statement's printed totals. Any statement whose totals do not reconcile is refused at the gate, not silently imported.

**Acceptance Scenarios**:

1. **Given** the user has imported zero statements before, **When** they drop a supported bank's PDF onto the page, **Then** the app detects the bank, parses every transaction line, validates that the sum equals the statement's stated totals to the cent, and renders all transactions in a sortable table.
2. **Given** the dropped PDF is from a bank the app does not yet support, **When** the parser cannot identify it, **Then** the app shows an explicit message naming the bank (if identifiable) or marking it as unrecognized, and offers the user a way to request support — but does NOT attempt to import partial data.
3. **Given** the dropped PDF parses with a checksum mismatch (parsed sum ≠ printed total), **When** validation fails, **Then** the app refuses the import, shows the diff between parsed total and printed total, and flags the statement for manual review without inserting any transactions into the database.
4. **Given** the user drops the same statement file a second time, **When** the import runs, **Then** the idempotency index rejects duplicates and the user is informed no new transactions were added.
5. **Given** the user drops a statement whose period partially overlaps an already-imported statement, **When** the import runs, **Then** only transactions not already present (by idempotency hash) are inserted; the overlap is silently de-duplicated.

---

### User Story 3 — Import a credit card statement into the same unified store (Priority: P1)

As a user, I want to drop a credit card statement PDF and have its transactions appear alongside my bank transactions in the same unified data layer — clearly tagged as belonging to that credit card, not silently merged.

**Why this priority**: Without credit card statements, the bank → credit card reconciliation (US4) cannot work. Card imports must follow the same accuracy gates as bank imports.

**Independent Test**: User drops a credit card statement; transactions appear with `account_type = "credit card"` and the card's nickname / last 4 digits visible; checksum matches printed totals.

**Acceptance Scenarios**:

1. **Given** the user has previously imported a bank statement, **When** they drop a supported credit card statement PDF, **Then** the credit card's transactions are inserted with their full provenance fields populated and visible.
2. **Given** the credit card statement has no signed amounts (purchases positive, payments negative is bank convention; cards may invert), **When** the parser normalizes amounts, **Then** the normalized sign convention is documented and applied so that "spending" is consistently signed across all accounts.
3. **Given** the credit card statement's printed totals do not match the parsed sum, **When** validation runs, **Then** import is refused with the same gate as bank statements.

---

### User Story 4 — Drill from a bank credit-card payment to the card transactions it covered (Priority: P1) — SIGNATURE FEATURE

As a user, when my bank statement shows "PAYMENT TO BOFA CC — $800", I want to click that single row and see exactly which card transactions that $800 paid off — drawn from the matching credit card statement I also imported.

**Why this priority**: This is the user's central problem. Mint, YNAB, Actual, and Monarch all fail to make this drill-through obvious because they were designed around aggregator APIs rather than statements. Solving this is the unique value proposition of this tool.

**Independent Test**: With one bank statement (showing a CC payment) and the matching CC statement (whose ending balance or "new balance" equals that payment) imported, clicking the bank CC-payment row navigates to a view showing every line item on the CC statement that the payment covered, with the statement's source clearly attributed.

**Acceptance Scenarios**:

1. **Given** the user has imported a bank statement with a "PAYMENT TO [card name]" transaction of $X on date D, AND a credit card statement from that card whose new balance / statement balance equals $X within a date tolerance of ±10 days, **When** the user clicks the bank transaction row, **Then** the app navigates to a detail view showing the linked credit card statement and lists every transaction on it.
2. **Given** the bank's CC payment row exists but the matching credit card statement has not yet been imported, **When** the user clicks the row, **Then** the app displays a "matching credit card statement not yet imported" state with an "Import the [card name] statement covering this payment" call-to-action; the bank transaction remains valid.
3. **Given** the user has multiple credit cards, **When** the parser determines which card a "PAYMENT TO [card name]" refers to, **Then** matching uses both the card identifier in the description AND amount/date proximity to avoid linking to the wrong card.
4. **Given** a manual link is needed because automated matching failed, **When** the user explicitly assigns a CC statement to a bank CC-payment, **Then** the link is persisted and behaves identically to an automatic link.

---

### User Story 5 — Unified, searchable, filterable transaction view (Priority: P1)

As a user, I want one chronological view of every transaction across every account I have imported, with the ability to filter by account, by date range, by amount range, and search by description text.

**Why this priority**: Without this view, the user cannot orient themselves in their own financial data. Filters and search are how a non-trivial volume of transactions becomes usable.

**Independent Test**: With statements from at least two accounts imported, the user sees a sortable table containing all transactions; filtering by account narrows the view correctly; searching for a known merchant returns all matching rows; date-range and amount-range filters compose correctly.

**Acceptance Scenarios**:

1. **Given** the user has imported statements from two or more accounts, **When** they open the transaction view, **Then** they see one chronological list including transactions from every account, with each row clearly labeled with bank name + account nickname + account type.
2. **Given** the user filters by a specific account, **When** the filter is applied, **Then** only that account's transactions are shown, with the filter clearly indicated and easily removable.
3. **Given** the user enters text in the search bar, **When** they type, **Then** the list filters in real time to transactions whose description contains the text (case-insensitive, substring match).
4. **Given** multiple filters are active simultaneously (account + date range + search text), **When** the combined predicate is applied, **Then** only transactions satisfying ALL filters appear.
5. **Given** the user clicks a column header, **When** the sort is applied, **Then** the table sorts by that column ascending; clicking again sorts descending.

---

### Roadmap stories (P2 / P3 / P4) — not in scope for v1 implementation

These are captured here so the constitution and architecture stay consistent across versions. The /speckit-plan for v1 will explicitly skip these.

**P2 — Near-term (v1.1)**:

- **US-P2-A — Categorize transactions (manual + rule-based)**: User-defined categories; rules engine that auto-applies categories to descriptions matching patterns; bulk re-categorize; manual overrides preserved across re-runs.
- **US-P2-B — Spending dashboards**: Pie chart of spending by category, stacked bar of category trends over months, line chart of net cash flow per month. Charts are drillable into the transaction list.
- **US-P2-C — Multi-device sync via encrypted Google Drive blob**: Encrypted blob is source of truth; local SQLite is rebuildable cache; on-close sync + manual sync button; per-field last-write-wins for editable fields.
- **US-P2-D — Paycheck-to-bills budget view**: User explicitly defines a "budget pair" of two paychecks that fund a named period (e.g., "February bills"); the view shows the running balance for that pair.

**P3 — Later (v1.2+)**:

- US-P3-A — Recurring / subscription detection.
- US-P3-B — Manual cash transactions.
- US-P3-C — Refund tracking (link refund to original purchase).
- US-P3-D — Transfers between own accounts (detect and exclude from spending totals).
- US-P3-E — Notes and tags on transactions.
- US-P3-F — Multi-currency display (schema supports day 1; UI later).

**P4 — Future**:

- US-P4-A — Budgets per category with monthly limits + over-budget alerts.
- US-P4-B — Savings goals with progress tracking.
- US-P4-C — Bill due reminders / calendar.
- US-P4-D — Export to CSV.
- US-P4-E — Opt-in AI categorization (Transformers.js classifier).

### Edge Cases

- An unsupported bank PDF is dropped → app names the bank if identifiable, refuses to import, suggests opening an issue/feature request, and does NOT silently fall back to a generic parser that might mis-extract data.
- Parsed transactions do not sum to printed totals → import refused; user sees the diff; statement saved as "pending review" but no rows inserted into the transactions table.
- Same statement file dropped twice → idempotency unique index `(account_id, posted_date, amount_minor, description_hash)` silently de-duplicates; user is informed nothing new was added.
- Statement period partially overlaps an existing import → only the genuinely new transactions are added; the overlap is invisibly de-duplicated.
- iOS Safari user has not installed to home screen → onboarding refuses to allow passphrase setup until the user reopens from the home screen icon (because Safari ITP evicts storage after 7 days outside standalone mode).
- User forgets passphrase and did not opt into recovery code → no recovery is possible by design; the user must restart from scratch and re-import statements. Documented and visible at setup.
- Two devices edit the same transaction's category while both offline → per-field LWW with column-level timestamps resolves on next sync; the loser's prior value is preserved as a history entry where feasible.
- Credit card payment found on bank statement, but the matching credit card statement was never imported → the bank-side row is still valid and visible; the drill-through shows "no matching CC statement imported yet"; importing the matching CC statement later establishes the link automatically.
- A bank's PDF format changes mid-year → the checksum gate refuses imports of the new format; the regression test fixture for that bank fails on the next parser change; the user is informed and the parser must be updated before further imports of that bank work.
- A credit card statement comes from a card the user has not yet declared in the app → the import flow includes a "first time seeing this card — name it" step before the rows are committed, so the account_nickname and last 4 are captured.

## Requirements *(mandatory)*

### Functional Requirements

**Onboarding & Identity (US-P1-A)**

- **FR-001**: System MUST detect iOS Safari in non-standalone mode and require the user to install the app to home screen before allowing any passphrase setup.
- **FR-002**: System MUST authenticate users via Google OAuth, requesting only the minimum scope needed to read and write a single dedicated folder in the user's Drive.
- **FR-003**: System MUST allow the user to choose an encryption passphrase, with a real-time strength meter and a documented minimum strength.
- **FR-004**: System MUST derive the encryption key from the passphrase using a strong key derivation function (per constitution Principle X) and a per-user salt issued at first setup.
- **FR-005**: System MUST display an explicit warning at passphrase setup that no party can recover the data without the passphrase.
- **FR-006**: System MUST offer the user an optional one-time recovery code at setup; if accepted, the recovery payload is stored encrypted alongside the main blob.
- **FR-007**: System MUST persist the per-user salt locally so that the same passphrase yields the same key across sessions on the same device.

**PDF import & parsing (US-P1-B, US-P1-C)**

- **FR-010**: System MUST accept PDF files via drag-and-drop and via a file picker. Files MUST be read into browser memory only; they MUST NOT be uploaded to any server.
- **FR-011**: System MUST attempt to identify which bank a PDF came from using a deterministic detector before invoking a parser.
- **FR-012**: System MUST run a bank-specific parser to extract every transaction line (date, description, amount, sign).
- **FR-013**: System MUST verify parsed transactions against the statement via a multi-level checksum (see research.md §R13). The adapter populates whichever reconciliation fields it can extract; the gate runs every applicable check:
  - **Level A — Balance reconciliation**: `opening_balance + sum(all_parsed_transactions) == closing_balance` (the most universally applicable check, requires only opening + closing balance fields, which appear on ~99% of statements).
  - **Level B — Aggregate totals**: `abs(sum(debit_transactions)) == printed_total_debits` AND `sum(credit_transactions) == printed_total_credits` (when the statement prints these aggregates; ~70-80% of US/Canadian bank statements).
  - **Level C — Credit card balance equation**: `previous_balance + sum(charges) - sum(payments) - sum(credits) == new_balance` (credit card statements).
  - **Level D — Transaction count**: parsed transaction count equals statement's printed "N transactions" (supplementary only, never sufficient alone).
- **FR-014**: System MUST refuse to import any statement that does not satisfy at least one of Levels A, B, or C, OR for which any populated level disagrees with parsed sums. Refused imports MUST NOT insert any transactions; the `statements` record may be saved with `import_status = 'refused'` and a `refusal_reason` describing which level(s) failed. Level D alone is INSUFFICIENT to authorize an import — a statement that only supports Level D is treated as "insufficient verification" and refused.
- **FR-015**: System MUST clearly distinguish refusal kinds in the UI: unsupported bank (no adapter detected), parse error (adapter threw `ParseError`), checksum mismatch (which specific level(s) failed and what diff), and insufficient verification (only Level D available). Each kind has a distinct, actionable message.
- **FR-016**: System MUST de-duplicate transactions on import using a unique index on `(account_id, posted_date, amount_minor, description_hash)`.
- **FR-017**: System MUST persist every imported transaction with full provenance fields populated: `bank_name`, `account_type`, `account_nickname`, `account_last_4`, `statement_id`, `raw_text`, `parser_name`, `parser_version`, `pdf_source_hash`.
- **FR-018**: System MUST store the original PDF file's SHA-256 hash alongside each import for audit traceability.
- **FR-019**: System MUST prompt the user to name a previously-unseen account (account_nickname) before committing its first import; subsequent imports for the same account reuse the nickname.

**Reconciliation drill-through (US-P1-D)**

- **FR-030**: System MUST recognize bank-statement transactions that represent payments to a credit card, by matching description patterns (e.g., "PAYMENT TO [issuer] CC", "AUTO PAY [issuer]") and signed amount.
- **FR-031**: System MUST attempt to automatically link each such bank transaction to a credit card statement whose new-balance / statement-balance equals the payment amount within a configured date tolerance (default ±10 days).
- **FR-032**: When automatic linking succeeds, System MUST persist the link as a relationship between the bank transaction and the credit card statement.
- **FR-033**: System MUST allow the user to manually establish or override a link between a bank credit-card-payment row and a specific credit card statement.
- **FR-034**: System MUST present, for any bank transaction representing a CC payment, an actionable drill-through to either (a) the linked credit card statement's transactions, or (b) a "no matching CC statement yet imported" state with a call-to-action to import it.
- **FR-035**: System MUST disambiguate when multiple credit cards could match (by including card identifier from description and by amount/date proximity).

**Unified transaction view (US-P1-E)**

- **FR-040**: System MUST display all imported transactions, across all accounts, in a single chronologically-sortable view.
- **FR-041**: Each transaction row MUST visibly display the source account: bank name, account nickname, and account type.
- **FR-042**: System MUST support filtering by account, date range, and amount range. Filters MUST compose (apply simultaneously).
- **FR-043**: System MUST support case-insensitive substring search of transaction descriptions, applied in real time as the user types.
- **FR-044**: System MUST allow column-header click-to-sort with ascending/descending toggle.
- **FR-045**: System MUST surface, for any transaction, the originating statement (via `statement_id`) and the parser metadata (`parser_name`, `parser_version`).

**Privacy, data, and gates (cross-cutting)**

- **FR-050**: System MUST encrypt all user data at rest using AES-256-GCM (per constitution Principle X) before any persistence beyond ephemeral browser memory.
- **FR-051**: System MUST NOT transmit any unencrypted user data over the network. No bank PDF, no parsed transaction, no statement metadata, no derived analytic value may leave the device without encryption.
- **FR-052**: System MUST NOT include or load any analytics, telemetry, crash reporting, advertising, or third-party tracking code.
- **FR-053**: System MUST load all runtime assets (fonts, icons, libraries) from the same origin or bundled into the app; no runtime third-party CDN fetches.
- **FR-054**: System MUST operate fully offline for parsing, viewing, and filtering existing data. Internet is required only for app load, Google OAuth, and sync.
- **FR-055**: System MUST surface a "View source PDF hash" or equivalent affordance so a curious user can verify any transaction's origin against the original PDF.

### Key Entities

- **Account**: An account or credit card the user has imported statements for. Attributes: id, bank_name, account_type (checking / savings / credit_card / loan / other), account_nickname (user-chosen), account_last_4, created_at. Relationships: one Account has many Statements and many Transactions.
- **Statement**: One imported PDF. Attributes: id, account_id, period_start, period_end, statement_balance_cents (for cards) or opening/closing balance (for bank), total_debits_cents, total_credits_cents, pdf_source_hash, parser_name, parser_version, imported_at. Relationships: one Statement has many Transactions; a Statement may be linked-to from many bank Transactions (when it is a credit card statement paid by bank).
- **Transaction**: One line item from a statement. Attributes: id, account_id, statement_id, posted_date, description (cleaned), raw_text (original PDF line), amount_minor (integer cents, signed), currency, amount_home_minor, fx_rate, status (pending / posted / disputed / reversed), transaction_type (purchase / refund / transfer / fee / interest / payment-to-card / other), description_hash (for idempotency), parser_name, parser_version, created_at. Relationships: belongs to one Account and one Statement; a transaction whose type is payment-to-card may link to one CC Statement (target of reconciliation).
- **ReconciliationLink**: The relationship between a bank Transaction representing a CC payment and the credit card Statement that payment paid down. Attributes: id, bank_transaction_id, cc_statement_id, link_type (auto / manual), confidence_score, created_at.
- **UserSettings**: Single-row entity holding the user's preferences. Attributes: home_currency, theme, autosync_enabled, recovery_code_enabled, ios_install_dismissed.
- **EncryptionMetadata**: The non-secret encryption material needed to derive the key on each device. Attributes: salt, kdf_algorithm, kdf_iterations, blob_version.

(Categories, CategoryRules, BudgetPeriods, Subscriptions, RefundLinks, TransferLinks, Tags, Notes — all defined in P2/P3/P4 stories; schema columns reserved but not surfaced in v1 UI.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from "open the URL for the first time" to "see their first parsed statement on screen" in under 5 minutes, including the iOS install-to-home-screen step where applicable.
- **SC-002**: For every bank declared "supported" in v1, parser accuracy MUST be 100% on the corresponding regression fixture (anonymized real statement). Enforced by CI on every PR.
- **SC-003**: For every successfully imported statement, the parsed transaction sum equals the printed statement total to the cent. There MUST be zero cases of statements imported with a silent mismatch.
- **SC-004**: A user can drill from a "$X paid to [card]" bank transaction to the matching credit card statement's transactions in a single click, when the matching CC statement has been imported.
- **SC-005**: Adding support for a previously-unsupported bank requires no more than one anonymized sample statement and produces a working parser in under one day of focused work.
- **SC-006**: The app loads and lets the user view all previously-imported transactions offline, with no network connectivity. Demonstrable by disabling Wi-Fi and reopening the app from the home screen.
- **SC-007**: Initial bundled-asset download (excluding the PDF parsing library which lazy-loads on first import) is under 5 MB.
- **SC-008**: A user inspecting the browser's network tab during normal use MUST observe zero requests to analytics, telemetry, or third-party tracking domains.
- **SC-009**: A user inspecting the encrypted blob in their Google Drive cannot identify a single transaction, account number, or merchant by reading the file. (Verifiable by running `strings` on the blob and finding only random-looking bytes.)
- **SC-010**: When a checksum-failed statement is dropped, the user sees a clear diff between parsed total and printed total, and the database state is unchanged (no partial inserts).

## Assumptions

- The user and their friends collectively use 4–8 distinct banks/issuers. Statements are mostly text-based PDFs (not scanned images). Scanned-image PDFs are out of scope for v1; if encountered, the parser refuses with an "OCR needed" message.
- The user's home currency is assumed to be USD for v1 (configurable; multi-currency display is a P3 story). Foreign-currency transactions still parse correctly and store the foreign amount; the home-currency conversion column is filled with a placeholder until P3.
- Each user has a Google account. OneDrive / Dropbox alternatives are out of scope for v1 but the sync layer is abstracted to allow them later.
- iOS users will install the app to home screen on first visit. The app actively guides them.
- Users will choose strong passphrases when prompted with the strength meter. The minimum threshold is calibrated to require at least an estimated 60-bit entropy.
- Internet is required only for initial app load and for sync. Once loaded, parsing, viewing, and filtering work offline.
- Bank statements provided for parser development are anonymized by the user before being shared with the developer; the production app reads unanonymized real PDFs locally on each user's own device.
- Bank PDF formats are stable for at least 12 months between issuer redesigns. When they change, the checksum gate catches it; parser updates are then a maintenance task.

## Constitutional Posture *(mandatory for this project)*

### Privacy Posture (Principle I)
- The feature reads PDF bank/CC statements supplied by the user. Statements stay in browser memory; parsed transactions are persisted only to the local OPFS-backed SQLite cache and to an encrypted blob in the user's own Google Drive folder.
- No plaintext bank statement content or parsed transactions leave the device. Google sees only ciphertext blob bytes plus blob size and timestamps.
- Confirmed: no plaintext bank statement content or parsed transactions leaves the device.

### Accuracy Posture (Principle II)
- This feature touches monetary values throughout: import, sum-and-validate, display, drill-through, search-by-amount.
- All money values are stored as INTEGER `amount_minor` (cents). No floating-point arithmetic anywhere in money math.
- Checksum invariant is applied on every statement import (FR-013, FR-014) as a hard refusal gate. Statements not satisfying the invariant are not inserted.
- Loud failure modes: unsupported bank → explicit refusal with bank name; checksum mismatch → explicit refusal with diff; duplicate statement → silent de-dupe with user notification; missing matching CC statement on reconciliation → explicit "not yet imported" state.

### Data Provenance (Principle VI)
- Every Transaction row written by this feature populates `bank_name`, `account_type`, `account_nickname`, `account_last_4`, `statement_id`, `raw_text` (original PDF line byte-for-byte), `parser_name`, `parser_version`, `pdf_source_hash`. (FR-017, FR-018.)
- Filtering, displaying, and aggregating logic operates on the normalized schema and does NOT branch on specific bank names; bank-specific behavior is confined to Layer 1 adapters.

### AI Use (Principle IX)
- This feature uses NO AI. No model is invoked at any point in onboarding, parsing, validation, or reconciliation.
- The opt-in client-side categorization classifier is reserved for the P4 story; it is not part of v1.

### Cost & Hosting (Principle III)
- This feature introduces no recurring infrastructure cost. App is hosted as static files (free). Sync writes to the user's own Google Drive (free, user's storage quota). No server we operate touches user data.
