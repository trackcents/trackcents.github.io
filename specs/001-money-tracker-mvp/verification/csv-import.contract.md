# Verification Contract — csv-import (+ export-csv round-trip)

> Implementation-free. States WHAT the module must do + its interface, never HOW.

## 1. Module under verification

- **Source file(s)** (do NOT open): `src/lib/app/csv-import.ts`, `src/lib/app/export-csv.ts`
- **Public entry points**: `parseCsvRows`, `parseAmountToCents`, `importCsv`, `CsvImportError` (csv-import); `centsToDecimal`, `csvEscape`, `exportTransactionsCsv`, `CSV_COLUMNS` (export-csv).
- **Risk tier**: P1 (ingestion-truth: parses untrusted input into money).
- **Touches**: ☑ value/money math ☑ parsing/untrusted input ☐ persistent state ☐ concurrency ☐ authn ☐ running UI

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec-tracker-research-features.md` — US-IMP-CSV, US-P4-D, §4 (CSV import advisory checksum; CSV export precision)
- `reports/overnight-build/DECISIONS.md` — D9 (advisory checksum), D10 (export precision, no float)
- `.specify/memory/constitution.md` — Principle II (bigint cents, no float); memory `feedback_no_silent_failures` (parsers THROW with row context)
- RFC 4180 (CSV) — quoting/escaping reference.
- For the resulting `ImportRecord` shape, the store schema in `src/lib/db/schema.ts` (you MAY read this — it is the persistence contract, not the DUT) and types in `src/lib/adapters/types.ts`.

## 3. Public interface (signatures only)

```ts
class CsvImportError extends Error {}
function parseCsvRows(text: string): string[][];
function parseAmountToCents(raw: string, rowNum: number): bigint;
interface CsvImportOptions { account_name: string; account_type?: AccountType; default_currency?: string; source_id: string; imported_at: string; }
function importCsv(text: string, opts: CsvImportOptions): ImportRecord;

function centsToDecimal(amount_minor: bigint): string;
function csvEscape(field: string): string;
function exportTransactionsCsv(rows: readonly CsvExportRow[]): string; // CsvExportRow: {posted_date, description, amount_minor:bigint, currency, account, category?}
const CSV_COLUMNS: readonly string[]; // ['date','description','amount','currency','account','category']
```

## 4. Behavioral requirements (WHAT)

### export-csv
- **R1 — centsToDecimal.** bigint cents → signed fixed-2-decimal string, NO float. 0n→"0.00", 5n→"0.05", 1234n→"12.34", -1234n→"-12.34", 100000000n→"1000000.00". Always exactly 2 fractional digits.
- **R2 — csvEscape (RFC-4180).** A field containing `"`, `,`, CR, or LF is wrapped in double quotes with internal `"` doubled; otherwise returned unchanged.
- **R3 — exportTransactionsCsv.** First line is `CSV_COLUMNS.join(',')`. Each row emits date, description, `centsToDecimal(amount_minor)`, currency, account, category (or '' if absent), each `csvEscape`d, comma-joined. Lines end with CRLF; document ends with a trailing CRLF.

### csv-import
- **R4 — parseCsvRows (RFC-4180).** Parses quoted fields, escaped quotes (`""`→`"`), and embedded commas/newlines inside quotes. Accepts CRLF or LF line breaks. A blank line (a row that is a single empty cell) is skipped. A trailing field/row without a final newline is still emitted. Returns rows of string cells. An empty/whitespace-only document returns `[]`.
- **R5 — parseAmountToCents.** Parses a signed decimal money string to bigint cents with NO float. Accepts: optional sign, accounting parens `(x)` = negative, currency symbols `$£€¥₹`, thousands separators `,`, surrounding spaces. More than 2 fractional digits round to the nearest cent (half-up). Examples: "12.34"→1234, "-12.34"→-1234, "(12.34)"→-1234, "$1,234.50"→123450, "1.005"→101, "1.004"→100, "1000000"→100000000.
- **R6 — importCsv header.** Requires a header row that names a DATE column and a DESCRIPTION column (case-insensitive aliases), plus EITHER an `amount` column OR a `debit`/`credit` pair. Missing required columns ⇒ throw.
- **R7 — importCsv rows.** Each data row → one `ParsedTransaction`: `posted_date` must be a real ISO `YYYY-MM-DD` (else throw with the 1-based row number); `description` non-empty (else throw). Amount: from the signed `amount` column via R5; OR from debit/credit where exactly one of the pair is non-empty (debit ⇒ negative magnitude, credit ⇒ positive magnitude); both filled ⇒ throw; neither ⇒ throw. `transaction_type` = 'purchase' if amount<0 else 'deposit'; `status`='posted'; `currency` = the row's currency column if present (validated ISO-4217) else `default_currency` (default 'USD', validated).
- **R8 — importCsv record.** Produces a single `ImportRecord` with `adapter_name='csv-import'`, `pdf_source_hash='csv-'+source_id`, `bank_name=account_name` (trimmed, fallback 'Imported CSV'), `account_type=opts.account_type ?? 'other'`, `parser_provides=['D']`, `checksum_strategy_used` containing "no checksum". `period_start/period_end` are the min/max posted_date. The record MUST pass the store's Zod schema (`diagnosePersistedState` returns null when wrapped in a PersistedState).
- **R9 — Round-trip.** For rows with ≤2-decimal amounts and ISO dates, `importCsv(exportTransactionsCsv(rows), …)` reproduces the same `amount_minor` sequence and the same descriptions (including ones containing commas/quotes/newlines).

## 5. Invariants & properties

- **INV1 — No float in money.** Parsing/printing never routes a cent value through a JS `number` such that precision is lost. `centsToDecimal` then `parseAmountToCents` is identity on any bigint (within ≤2 decimals). For arbitrary bigint c: `parseAmountToCents(centsToDecimal(c), 1) === c`.
- **INV2 — RFC-4180 round-trip.** For any array of string cells without forcing structure, `parseCsvRows` of a `csvEscape`-joined CRLF document recovers the original cells (fuzz: random strings incl. quotes/commas/newlines/unicode).
- **INV3 — Throw, never silently drop.** `importCsv` either returns a record covering EVERY data row, or throws. It never returns a record with fewer transactions than data rows by silently skipping a malformed one.
- **INV4 — Determinism & purity.** Same input ⇒ identical output; inputs not mutated.
- **INV5 — Sign/magnitude.** debit→negative, credit→positive; a signed `amount` column preserves its own sign.

## 6. Domain edge cases that MUST be handled

Empty file; header-only (no data rows ⇒ throw); CRLF vs LF; quoted field with embedded comma; quoted field with embedded newline; escaped `""`; unterminated quote (⇒ throw); leading/trailing whitespace in cells; amount as `(12.34)`, `$1,234.56`, `+5`, `-0.01`, `0.00`; >2 decimals rounding at .005 boundary; non-ISO date `01/02/2026` (⇒ throw, row number); empty description (⇒ throw); both debit+credit filled (⇒ throw); currency `usd` lowercased (accept, uppercased) vs `US`/`dollars` (⇒ throw); huge amount (1e12); unicode in description; a row with extra/missing trailing columns.

## 7. Explicitly OUT of scope — do NOT report as bugs

- No checksum/balance reconciliation is performed (D9: advisory by design — `parser_provides:['D']`).
- Auto-detecting column meaning beyond the documented alias list.
- Multi-account inference from one CSV (one CSV ⇒ one account).
- Date formats other than ISO `YYYY-MM-DD` (the contract REQUIRES the user pre-convert; non-ISO MUST throw, not be parsed heuristically).
- Currency conversion / fx.

## 8. Error contract (no silent failures)

All failures throw `CsvImportError` (a named `Error` subclass) with a human message. Row-level errors MUST include the 1-based row number (header = row 1, first data row = row 2). Specifically throw on: unterminated quote; empty file; missing date/description column; missing amount & debit/credit; non-ISO date; empty description; both debit+credit set; neither set; unparseable amount; bad currency. "Valid" = a header naming the required columns + every data row parseable per R7.

## 11. Known oracle hazards

- Rounding at exactly x.xx5 (half-up) — hand-compute golden values; do not derive expected via float.
- INV1 identity holds for ≤2-decimal decimals; for the export→import direction the source is always bigint so it is exact. For arbitrary decimal STRINGS with >2 decimals, the oracle is the documented half-up rule, not float arithmetic.
- RFC-4180 has dialects; the authoritative behavior is THIS contract (R2/R4), tie-broken by RFC 4180 where silent.
