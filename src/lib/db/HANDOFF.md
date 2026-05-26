# SQLite-WASM persistence — work in progress

**Status (end of session 2026-05-23):** scaffolding only. Schema and
migrations are authored; `wa-sqlite` dep is installed; no runtime code yet
opens or queries the DB. The app still runs entirely in memory.

This handoff doc lays out what's done and exactly what the next session
should do. Goal: finish task #43, then iterate on #38 (more banks) and #48
(user-editable categorization).

## Done in this session

- ✅ `src/lib/db/schema.sql` — canonical schema (7 tables, 9 indexes, 1 FTS5 vtable, 2 singleton CHECK rows). Mirrors `specs/001-money-tracker-mvp/data-model.md`.
- ✅ `src/lib/db/migrations/0001_initial.sql` — full schema-state migration. Self-contained snapshot; runs once via the migration loader.
- ✅ `src/lib/db/schema-sql.ts` — same SQL exported as a TS string + `MIGRATIONS` array. Used by the runtime to apply migrations on first open.
- ✅ `src/lib/db/types.ts` — already had the TS shapes (`Account`, `Statement`, `Transaction`, `NewAccount`, `NewStatement`, `NewTransaction`, `ReconciliationLink`, `UserSettings`, etc.). They match the schema.
- ✅ `wa-sqlite` installed as a `dependencies` entry in `package.json`.

## What's left for #43

### Step 1 — Client bootstrap (`src/lib/db/client.ts`)

Implement `openDatabase(): Promise<Database>` that:

1. Loads `wa-sqlite-async.mjs` via Vite asset URL (e.g. `?url` import on the worker file).
2. Tries the **OPFS VFS** first (`OPFSCoopSyncVFS` from `wa-sqlite/src/examples/`). If unavailable (Safari < 17, Firefox < 111), falls back to the **IDB VFS** (`IDBBatchAtomicVFS`).
3. Opens database file `money-tracker.sqlite`.
4. Reads `schema_migrations` table. For every entry in `MIGRATIONS` where the version isn't yet applied, runs the migration's SQL inside a transaction.
5. Returns a thin `Database` wrapper exposing `exec`, `prepare`, `transaction(fn)`, and `close`.

The hardest piece is the **Vite + WASM asset config**. The wa-sqlite WASM file needs to be served at a known URL. Approaches:

- Use `?url` import on `wa-sqlite-async.wasm` (see Vite asset handling docs).
- Alternative: copy the WASM to `static/` and reference it absolutely. Less elegant but more predictable.

Add a vitest test in `tests/unit/db/client.test.ts` that opens the DB in jsdom (using `fake-indexeddb` since OPFS isn't available in tests) and asserts the migration ran (`SELECT version FROM schema_migrations`).

### Step 2 — Repository (`src/lib/db/repository.ts`)

Implement against the contract `specs/001-money-tracker-mvp/contracts/storage-repository.md`. Minimum methods to unblock import.ts refactor:

```ts
upsertAccount(input: NewAccount): Promise<Account>
findAccount(bankName: string, type: AccountType, last4: string | null): Promise<Account | null>
insertStatement(input: NewStatement): Promise<Statement>
findStatementByHash(pdfSourceHash: string): Promise<Statement | null>
bulkInsertTransactions(statementId: StatementId, txs: NewTransaction[]): Promise<{ inserted: number; skipped: number }>
listImports(): Promise<{ statement: Statement; transactions: Transaction[]; bank_name: string }[]>
deleteStatement(id: StatementId): Promise<void>
clearAll(): Promise<void>
insertReconciliationLink(input: NewReconciliationLink): Promise<ReconciliationLink>
listReconciliationLinks(): Promise<ReconciliationLink[]>
```

Each method is a thin wrapper over `db.prepare(...).bind(...).all/run()`. Money values are stored as INTEGER (cast bigint to number for SQLite, but range-check first since SQLite INTEGER is 64-bit).

### Step 3 — Refactor `src/lib/app/import.ts`

Change `importStatement()` to write through the repository in a single transaction:

1. `upsertAccount` (first-seen account → prompt user for nickname via callback)
2. `insertStatement` with `import_status='imported'` and `checksum_strategy_used` set if checksum passed; `'refused'` + `refusal_reason` if not (no transactions inserted in that case)
3. `bulkInsertTransactions` — idempotent via the UNIQUE index; returns counts of inserted vs skipped
4. Run `reconcileImports()` over the current persisted state and `insertReconciliationLink()` for new auto-matches

### Step 4 — Refactor `src/routes/+page.svelte`

Replace the in-memory `imports = $state<ImportSuccess[]>([])` with a derived state that comes from `repository.listImports()`. On mount: load all. On each drop: import via repository, then re-load.

Add a "Clear all data" button in the header that calls `repository.clearAll()` (with a confirm dialog — destructive operation).

### Step 5 — Tests

- `tests/unit/db/client.test.ts` — migrations run, second open is a no-op
- `tests/unit/db/repository.test.ts` — every method tested. Idempotency on `bulkInsertTransactions` (drop same statement twice → second is fully skipped). Foreign-key cascade on `deleteStatement`.
- Existing reconciliation tests should still pass — the matcher is pure (no DB dependency).

## Open questions when this lands

1. **Encryption-at-rest**: the constitution says local DB should be encrypted (Principle X). For Phase 1, we can persist plaintext to OPFS as a first cut, then add the AES-256-GCM wrap in Phase 2 (US-P1-A onboarding). Note this trade-off in `import_status` or a separate flag.
2. **OPFS vs IDB fallback detection**: which signal triggers the IDB path? Currently undefined — depends on whether `navigator.storage.getDirectory()` resolves successfully.
3. **Account nickname UX**: where in the import flow does the prompt fire? Best UX is: parse PDF first (so we have the account_last_4 to show), then prompt synchronously, then continue with insertStatement.
4. **bigint → SQLite integer conversion**: SQLite stores 64-bit signed ints natively. wa-sqlite's bind API accepts JS bigint via the `bind_int64` variant. Need to verify exact binding signature and add bigint-to-number conversion only at the JS-side boundary (for display).

## Files in this session

```
src/lib/db/
  schema.sql                          (NEW — canonical schema)
  schema-sql.ts                       (NEW — TS-importable copy)
  migrations/0001_initial.sql         (NEW — self-contained snapshot)
  types.ts                            (already existed; unchanged this session)
  HANDOFF.md                          (this file)
```

`package.json`: `wa-sqlite ^1.0.0` added to `dependencies`.
