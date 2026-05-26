# Contract: PDF Intake UI flow

This contract documents the user-facing intake flow for dropping a PDF and seeing the result. It is the orchestration of detect → parse → checksum → persist, and it owns all the UI states a user can be in during import.

## States

```
idle
  └─► dropping            (user is dragging a file over the drop zone)
        └─► reading       (FileReader is loading bytes into memory)
              └─► hashing (computing SHA-256 of PDF bytes)
                    └─► extracting    (PDF.js pulling text + positions)
                          └─► detecting (bank detector running)
                                ├─► detected
                                │     └─► first_account_seen?
                                │           ├─► yes → naming_prompt → parsing
                                │           └─► no → parsing
                                ├─► parsing
                                │     └─► checksum
                                │           ├─► passed → persisting → success
                                │           └─► failed → refused_checksum
                                ├─► refused_unsupported (no adapter recognized)
                                └─► refused_parse_error (adapter threw ParseError)
```

## Transitions and UI obligations

| State | What user sees | Allowed next states |
|---|---|---|
| `idle` | Empty drop zone with "Drop a PDF statement here" prompt and a file picker button. | `dropping` |
| `dropping` | Drop zone highlighted; "Release to import". | `reading` (on drop) or `idle` (on drag-leave) |
| `reading` | Spinner with "Reading file…" | `hashing` |
| `hashing` | Spinner with "Verifying file integrity…" | `extracting` |
| `extracting` | Spinner with "Reading PDF contents…" | `detecting` |
| `detecting` | Spinner with "Identifying bank…" | `detected` / `refused_unsupported` |
| `detected` | (transient) | `naming_prompt` (if first time seeing the account) or `parsing` |
| `naming_prompt` | Modal: "First time seeing this [Chase / BoA / ...] account ending in 1234. What do you want to call it?" with a free-text input and a "Use suggested name" button (if the adapter suggested one). | `parsing` (on user submit) |
| `parsing` | Spinner with "Parsing transactions…" + parsed-so-far count | `checksum` |
| `checksum` | (transient) | `persisting` / `refused_checksum` |
| `persisting` | Spinner with "Saving…" | `success` |
| `success` | Result table showing every transaction. Banner: "Imported N new transactions from M-page statement." Drill-through ready if any payment_to_card rows present. | `idle` (user can drop another file) |
| `refused_unsupported` | Card: "We could not identify this bank's statement format. [Optional: 'It looks like {bank} but we don't have a parser yet.'] Please contact the developer to request support." with a button to dismiss. | `idle` |
| `refused_parse_error` | Card: "The PDF appears to be in a recognizable format but parsing failed. Details: {error_message}. Please report this so we can improve the parser." | `idle` |
| `refused_checksum` | Card: "We extracted N transactions but they do not sum to the printed totals. The import has been refused to avoid silent errors. Difference: ${diff}. Please review the original PDF and report this so we can investigate." with a "Show diff" expander showing parsed totals vs. printed totals. | `idle` |

## Side-effect ordering (the orchestration)

The import flow is implemented in `src/lib/app/import.ts` as a single async function:

```typescript
// src/lib/app/import.ts (sketch — the contract for the orchestration)

import { detectAdapter, type BankAdapter } from '../adapters/detector';
import { extractPdfWithPositions } from '../pdf/extract';
import * as repo from '../db/repository';
import { sha256 } from '../crypto/hash';
import { reconcileNewPayments } from './reconciliation';

export type ImportProgress =
  | { state: 'reading' }
  | { state: 'hashing' }
  | { state: 'extracting' }
  | { state: 'detecting' }
  | { state: 'first_account'; suggested_nickname?: string; bank_name: string; account_last_4: string }
  | { state: 'parsing' }
  | { state: 'persisting' }
  | { state: 'success'; statement_id: string; inserted: number; skipped: number; reconciliation_count: number }
  | { state: 'refused'; reason: string; diff?: { expected: number; got: number } };

export interface ImportInput {
  pdf_bytes: Uint8Array;
  pdf_filename: string;
  /** Called by UI to provide the nickname when in 'first_account' state. */
  on_nickname_request?: (suggested: string | undefined, last4: string, bank: string) => Promise<string>;
}

export async function importStatement(
  input: ImportInput,
  on_progress: (p: ImportProgress) => void
): Promise<void>;
```

Side-effect ordering MUST be:

1. `on_progress({ state: 'hashing' })` → compute `pdf_source_hash = sha256(pdf_bytes)`.
2. `on_progress({ state: 'extracting' })` → call PDF.js to get text + positions.
3. `on_progress({ state: 'detecting' })` → run `detectAdapter()`.
4. If detection fails → `on_progress({ state: 'refused', reason: 'unsupported' })` and return. NO database writes.
5. `on_progress({ state: 'parsing' })` → call `adapter.parse(...)`. If it throws `ParseError`, propagate via `refused` state. NO database writes.
6. Resolve account: call `repo.findAccount(bank_name, account_type, last_4)`. If absent, transition to `first_account` state, await user nickname, then `repo.createAccount(...)`.
7. **Checksum gate** (this happens BEFORE any transaction inserts):
   - Compute parsed totals from `result.transactions`.
   - Compare against `result.statement.total_debits_minor` and `total_credits_minor`.
   - If mismatch: `on_progress({ state: 'refused', reason: 'checksum', diff: ... })` AND `repo.insertStatement(... import_status='refused', refusal_reason=...)`. NO `repo.bulkInsertTransactions` call. Return.
8. `on_progress({ state: 'persisting' })` →
   - `repo.insertStatement(... import_status='imported')`.
   - `repo.bulkInsertTransactions(statement.id, result.transactions)`.
   - For any new `payment_to_card` rows in the result, call `reconcileNewPayments(...)`.
9. `on_progress({ state: 'success', ... })`.

All steps wrapped in try/catch. Any unexpected exception → `refused` state with the error message; no partial inserts because step 8 is a single repository transaction.

## Drop zone and file picker

The drop zone component (`PdfDropZone.svelte`) emits one event per file dropped:

```typescript
on:file_dropped={(event: CustomEvent<{ bytes: Uint8Array; filename: string }>) => { ... }}
```

Multiple files dropped at once are handled SEQUENTIALLY (one full import flow per file). The component MUST prevent the user from dragging a 12th file while file 11 is mid-import.

## Accessibility

The drop zone MUST be keyboard-accessible: pressing the button opens the OS file picker. Screen readers must announce the current import state via `aria-live` regions. Progress messages must be human-readable.

## Edge case: large statements

Statements with >1000 transactions are rare but possible (e.g., a year-end aggregate). The flow MUST NOT block the UI thread:

- Hashing uses streaming via `crypto.subtle.digest`.
- PDF.js extraction yields per-page (Promise.all-able).
- `bulkInsertTransactions` is one repository call; it handles internal batching.
- A progress meter (% pages done) is acceptable for the `parsing` state.

## Edge case: drop a non-PDF

The intake checks the magic bytes (`%PDF-`) at start of file BEFORE anything else. If absent, immediately transition to `refused` with reason "not a PDF". No fancy file extension check; the bytes are the source of truth.
