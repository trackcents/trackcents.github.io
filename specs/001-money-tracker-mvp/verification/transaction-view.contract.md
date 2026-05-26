# Verification Contract — transaction-view (US-P1-E unified view: flatten / filter / sort)

> Implementation-free contract for the independent verifier. WHAT + interface, never HOW.
> Produced by the Designer; consumed by the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/transaction-view.ts`
- **Public entry points**: `toUnifiedRows`, `accountKeyString`, `listAccounts`, `applyFilter`, `sortRows` (+ the `UnifiedRow`/`AccountKey`/`TransactionFilter`/`SortSpec` types).
- **Risk tier**: **Core / P2 UX-truth.** The US-P1-E unified transactions view: flatten every import into one chronological list, filter by date/account/amount/search/type, sort. Pure functions the route composes. Not money-truth (display + filtering), but `applyFilter`'s amount bound touches a money-adjacent conversion (see §11 hazard).
- **Touches**: ☑ filtering/search of in-memory data ☑ money-adjacent (amount-bound conversion) ☐ parsing ☐ persistent state ☐ authz ☐ (UI route composes these but the functions are pure)
- **Right-sizing note:** **LEAN — Stage 1 only** unless a bug is found. The high-yield checks
  are: pairwise filter combinations (CLAUDE.md mandates a pairwise filter test for this tier),
  boundary inclusivity, the float amount-bound probe, the `accountKeyString` collision probe,
  and sort stability. No mutation marathon.

## 2. Authoritative spec sources

- `specs/001-money-tracker-mvp/spec.md` — **US-P1-E** ("a single chronological list of every
  transaction from every account; filter by date range, account, amount range, and free-text
  search the description; each row shows bank + account nickname + account_type").
- Constitution **Principle II** (money as integer cents; floats forbidden on money paths — relevant to the §11 amount-bound hazard).
- `specs/001-money-tracker-mvp/data-model.md` — signed-cents convention, account_type enum.

## 3. Public interface (signatures only)

```ts
interface UnifiedRow {
  bank_name: string; account_type: AccountType; account_last_4: string | null;
  pdf_source_hash: string; adapter_name: string; adapter_version: string;
  posted_date: string; description: string; amount_minor: bigint; currency: string;
  transaction_type: TransactionType; raw_text: string;
  import_index: number; transaction_index: number;
}
export function toUnifiedRows(imports: ImportSuccess[]): UnifiedRow[];

interface AccountKey { bank_name: string; account_type: AccountType; account_last_4: string | null; }
export function accountKeyString(k: AccountKey): string;
export function listAccounts(rows: UnifiedRow[]): AccountKey[];

interface TransactionFilter {
  account_keys?: string[] | undefined;  // membership over accountKeyString(...)
  date_from?: string | undefined;       // ISO inclusive lower bound
  date_to?: string | undefined;         // ISO inclusive upper bound
  amount_min?: number | undefined;      // DOLLARS; matches abs(amount) >= min
  amount_max?: number | undefined;      // DOLLARS; matches abs(amount) <= max
  search?: string | undefined;          // case-insensitive; whitespace tokens AND'd, substring
  types?: TransactionType[] | undefined;// membership
}
export function applyFilter(rows: UnifiedRow[], filter: TransactionFilter): UnifiedRow[];

type SortKey = 'date' | 'description' | 'amount' | 'account' | 'type';
type SortDir = 'asc' | 'desc';
interface SortSpec { key: SortKey; dir: SortDir; }
export function sortRows(rows: UnifiedRow[], spec: SortSpec): UnifiedRow[];
```

`ImportSuccess` = `{ adapter_name, adapter_version, bank_name, pdf_source_hash, statement: ParsedStatement, transactions: ParsedTransaction[], ... }` (construct fixtures as in the sibling contracts).

## 4. Behavioral requirements (the WHAT)

- **R1 — `toUnifiedRows` flattens every transaction** of every import into one row carrying
  the import's provenance (bank_name/account_type/account_last_4/pdf_source_hash/adapter\*) +
  the transaction's fields + correct `(import_index, transaction_index)` source coordinates.
  No row dropped or duplicated; count = Σ transactions.
- **R2 — `toUnifiedRows` order:** ascending by `posted_date`, then `import_index`, then
  `transaction_index` (a deterministic total order over a fixed `imports[]`).
- **R3 — `accountKeyString`** maps an `AccountKey` to a string; equal keys → equal strings,
  and accounts that should be DISTINCT (differing bank, account_type, OR last_4) → distinct
  strings (see §11 collision hazard; null last_4 has a defined rendering).
- **R4 — `listAccounts`** returns each DISTINCT account present in the rows exactly once,
  sorted by (bank_name, account_type, last_4).
- **R5 — `applyFilter` is conjunctive (AND) across dimensions;** an absent/undefined/empty
  field is "no constraint." With an empty filter `{}`, every row passes.
  - **R5a account_keys:** if non-empty, keep only rows whose `accountKeyString` is in the set.
  - **R5b date_from / date_to:** INCLUSIVE bounds — a row dated exactly `date_from` or exactly
    `date_to` is KEPT; outside the range is dropped. (ISO `YYYY-MM-DD` lexicographic order.)
  - **R5c amount_min / amount_max:** match on the ABSOLUTE amount, INCLUSIVE — keep rows where
    `|amount| ≥ min` and `|amount| ≤ max` (bounds given in dollars). So `amount_min:10` keeps
    both a `+$10.00` and a `-$10.00` row.
  - **R5d search:** case-insensitive; split on whitespace into tokens; a row matches iff its
    `description` contains EVERY token as a substring (token-AND). Empty/whitespace-only → no
    constraint.
  - **R5e types:** if non-empty, keep only rows whose `transaction_type` is in the set.
- **R6 — `sortRows`** returns a new array sorted by `spec.key` (`date` lexicographic;
  `description` case-insensitive; `amount` by SIGNED amount; `account` by a bank+last_4 key;
  `type` lexicographic), `asc` or `desc`. STABLE — equal-keyed rows keep their input relative
  order. Does not mutate the input.
- **R7 — Purity:** `toUnifiedRows`, `applyFilter`, `sortRows` never mutate their arguments.

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Filter is a subset & idempotent:** `applyFilter(rows, f) ⊆ rows` (preserves order &
  membership); `applyFilter(applyFilter(rows,f),f)` equals `applyFilter(rows,f)`.
- **INV2 — Empty filter is identity:** `applyFilter(rows, {})` returns all rows (same order).
- **INV3 — AND-decomposition (metamorphic):** applying two single-dimension filters in
  sequence equals applying the combined filter — `applyFilter(applyFilter(rows,{a}),{b}) ===
  applyFilter(rows,{a,b})` (order of dimensions doesn't matter).
- **INV4 — Boundary inclusivity:** a row exactly at `date_from`/`date_to` or whose `|amount|`
  exactly equals `amount_min`/`amount_max` (to the cent) is KEPT.
- **INV5 — `toUnifiedRows` conservation:** output length = Σ transactions; every row's
  `(import_index, transaction_index)` resolves back to the exact source transaction.
- **INV6 — `listAccounts` ⇔ `accountKeyString`:** the accounts listed are exactly the distinct
  `accountKeyString` values among the rows; count matches the number of distinct keys.
- **INV7 — `sortRows` is a permutation** of its input (same multiset of rows; only order
  changes) and is stable; `asc` and `desc` are reverses for distinct keys.
- **INV8 — Determinism/purity:** same inputs ⇒ deeply-equal outputs; no argument mutation.

## 6. Domain edge cases that MUST be handled

- Empty imports → `[]`; empty rows → `applyFilter`/`sortRows` return `[]`/`[]`.
- Filter with every dimension set at once (full conjunction) + pairwise combinations of all
  dimensions (CLAUDE.md pairwise requirement).
- Date bound exactly on a row's date (inclusive); amount bound exactly equal (inclusive);
  `amount_min > amount_max` (empty result, no crash); negative amounts vs abs-based amount filter.
- Search: multiple tokens, mixed case, a token that is a substring within a word, empty/spaces.
- `account_last_4 === null` (its key rendering + grouping); two accounts same bank+last_4 but
  different `account_type` (must be DISTINCT accounts).
- Same-day rows from different imports (R2 order); `sortRows` ties (stability).
- Large bigint amounts; `amount_min`/`amount_max` as fractional dollars (e.g. `10.05`).

## 7. Explicitly OUT of scope / deferred — do NOT report as bugs

- The Svelte route/UI that composes these (covered by E2E elsewhere).
- The future SQL/FTS5 port (#49) — verify the in-memory behavior as specified.
- `toUnifiedRows` same-day DISPLAY order being `import_index`-based: this is a deterministic
  DISPLAY ordering (not a money-truth attribution like the FIFO engine), and is acceptable —
  do not flag it as the D19 determinism bug-class (different severity: display vs money).
- The exact `accountKeyString` separator format (verify the injectivity PROPERTY, §11, not a
  literal string).

## 8. Error contract (no silent failures)

All functions are TOTAL on well-shaped input and MUST NOT throw (empty arrays, null last_4,
`amount_min > amount_max`, bizarre-but-typed filters → a (possibly empty) result, never an
exception). "No silent failure" here = the filter must never silently KEEP a row that fails a
constraint or DROP a row that satisfies all of them (INV1–INV4 catch this).

## 9–10. Security / runtime
N/A — pure functions; the route is covered by E2E.

## 11. Known oracle hazards

- **Amount-bound conversion (Principle II watch):** `amount_min`/`amount_max` arrive in
  DOLLARS (a JS `number`) and must be compared to integer-cent `amount_minor`. Probe the
  dollars→cents conversion at fractional values (`10.05`, `2.675`, `0.29`) and EXACTLY on the
  boundary — a float-based conversion (`x*100` then round) can mis-classify a row whose
  `|amount|` is exactly the bound by a cent. Report whether a boundary row is correctly
  kept/dropped; if a float artifact mis-bounds it, that's a finding (a filter showing/hiding
  the wrong cent-boundary transaction). Severity is UX (a filter bound), but it's a real
  Principle-II-adjacent edge.
- **`accountKeyString` injectivity (the D20 sibling):** the key joins `bank_name`,
  `account_type`, `account_last_4` with a separator. account_type is a fixed enum and last_4 is
  digits in production, so collisions are unlikely — but PROBE injectivity over adversarial
  field values (a bank_name containing the separator) and report whether two DISTINCT accounts
  can collide to one key (which would conflate them in the account filter / `listAccounts`).
  Note the production-reachability honestly.
- **Date string comparison** assumes well-formed ISO `YYYY-MM-DD` (lexicographic = chronological);
  fine within that domain — don't fuzz malformed date strings (adapters guarantee ISO).
- **Sort stability** relies on a stable sort + the `toUnifiedRows` base order; verify ties keep
  input order, and that `sortRows` is a true permutation (no rows lost/added).
