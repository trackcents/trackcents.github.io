# Verification Contract — reconciliation (bank-payment ↔ credit-card-statement matcher)

> The only engineering artifact handed to the independent verifier. Implementation-free
> by construction: it states WHAT the module must do and the interface it exposes, never
> HOW. The verifier authors its environment from this contract + the cited spec, and never
> reads the source.
>
> Produced by: the Designer. Consumed by: the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/reconciliation.ts`
- **Public entry points**: `reconcileImports`, `findLinkForBankTxn` (+ the `ImportedStatement` / `ReconciliationLink` interfaces)
- **Risk tier**: **P0 — money truth.** This is the "which card did my $X payment land on?" half of US-P1-D (the FIFO "which purchases" half lives in `transaction-stream.ts`, separately verified). A wrong link points the drill-down at the wrong credit card.
- **Touches**: ☑ value/money math (amount matching to the cent) ☐ parsing ☑ in-memory state ☐ concurrency ☐ authn ☐ running UI
- **Collaborator (NOT under verification this run, but you MAY call its public API as a trusted deterministic oracle):** `src/lib/util/card-payment.ts` exports `detectCardPayment(description): { issuer, card_last_4 } | null` and `bankNameMatchesIssuer(bankName, issuer): boolean`. §3b gives you everything needed to construct inputs without reading its source.

## 2. Authoritative spec sources

If this contract and a spec doc disagree, the **spec wins** and that disagreement is a finding.

- `specs/001-money-tracker-mvp/spec.md` — **US-P1-D** ("when I see 'PAYMENT TO BOFA CC -$800' I can click it and drill down to the matching credit card statement … whose ending balance matches that $800 payment within a date window"); **SC-004** (1-click drill). The link is stored as a relationship bank-tx ↔ cc-statement.
- `specs/001-money-tracker-mvp/research.md` — §R12 (the matching algorithm). NOTE the documented generalization in §7 below (window is ±30 days of `period_end`, not ±10 of due-date).
- `specs/001-money-tracker-mvp/data-model.md` — `transaction_type` enum, `account_type` enum, signed-cents convention.
- Constitution **Principle II** (accuracy; integer cents) and the project's anti-false-positive posture (a WRONG auto-link is worse than NO link — see INV6).

## 3. Public interface (signatures only)

```ts
interface ImportedStatement {
  statement: ParsedStatement;        // see §3a — carries account_type, account_last_4, period_end
  transactions: ParsedTransaction[]; // see §3a — carries transaction_type, amount_minor, posted_date, description
  bank_name: string;
  adapter_name: string;
  pdf_source_hash: string;
}

interface ReconciliationLink {
  bank_import_index: number;          // index into the imports array (a NON-credit_card import)
  bank_transaction_index: number;     // index of the payment_to_card row within that import
  cc_import_index: number;            // index of the matched credit_card import
  cc_transaction_index: number | null;// index of the matched CC payment row, or null
  link_type: 'auto' | 'manual';       // reconcileImports only ever emits 'auto'
  confidence_score: number;           // 1.0 or 0.85 (see R8)
  matched_amount_minor: bigint;       // the matched amount, POSITIVE (absolute)
  matched_date: string;               // ISO 'YYYY-MM-DD' — the bank-tx posted_date
}

export function reconcileImports(imports: ImportedStatement[]): ReconciliationLink[];

export function findLinkForBankTxn(
  links: ReconciliationLink[],
  bankImportIndex: number,
  bankTransactionIndex: number
): ReconciliationLink | undefined;
```

### 3a. Relevant input-type shapes
```ts
type AccountType = 'checking' | 'savings' | 'credit_card' | 'loan' | 'cash' | 'other';
type TransactionType = 'purchase'|'refund'|'transfer'|'fee'|'interest'|'payment_to_card'|'deposit'|'withdrawal'|'other';
interface ParsedTransaction { posted_date: string; description: string; raw_text: string; amount_minor: bigint; currency: string; transaction_type: TransactionType; status?: string; }
interface ParsedStatement { account_type: AccountType; account_last_4: string | null; period_start: string; period_end: string; currency: string; /* balance fields irrelevant here */ }
```
Sign convention: a `payment_to_card` row on a checking/bank account is an outflow (`amount_minor < 0`); on the CC side a `payment_to_card` reduces the balance (`amount_minor > 0`). The matcher compares **absolute** values.

### 3b. Collaborator behavior you can rely on (so you needn't read card-payment.ts)
`detectCardPayment(description)` returns `null` if the description is not a recognized CC-payment descriptor, else `{ issuer, card_last_4 }` where `card_last_4` is a 4-char string **only** for issuers whose descriptor carries it, else `null`. Recognized example descriptors (case-insensitive) you can use as stimulus:
- `"Payment To Chase Card Ending IN 1797"` → `{ issuer:'Chase', card_last_4:'1797' }` (carries last-4)
- `"Discover E-Payment 3562"` → `{ issuer:'Discover', card_last_4:'3562' }` (carries last-4; 3-digit capture is left-padded to 4)
- `"Bk of Amer Visa Online Pmt"` → `{ issuer:'BofA', card_last_4:null }`
- `"American Express ACH Pmt M0042"` → `{ issuer:'Amex', card_last_4:null }`
- `"Robinhood Card Payment"` → `{ issuer:'Robinhood', card_last_4:null }`
- `"some random grocery store"` → `null`

`bankNameMatchesIssuer(bankName, issuer)` is case-insensitive and matches by alias **substring**, e.g. issuer `'BofA'` matches bank_name `"Bank of America"`, `"BoA"`, `"BofA"`; `'Chase'` matches `"Chase"`, `"JPMorgan Chase"`; `'Discover'` matches `"Discover"`. (You may call the real function; treat it as a deterministic trusted oracle.)

## 4. Behavioral requirements (the WHAT)

- **R1 — Only bank-side `payment_to_card` rows can originate a link.** A row originates a candidate link iff its import's `statement.account_type` is **not** `credit_card` AND its `transaction_type` is `payment_to_card`. Rows on credit-card imports, and non-`payment_to_card` rows, never originate links.
- **R2 — Unrecognized descriptor ⇒ no link.** If `detectCardPayment(description)` returns `null`, that bank row produces no link.
- **R3 — Candidate CC imports are filtered by issuer alias.** A credit-card import is a candidate only if `bankNameMatchesIssuer(ccImport.bank_name, detectedIssuer)` is true.
- **R4 — Last-4 gate when present.** If the descriptor carried a `card_last_4`, a candidate CC import must have `statement.account_last_4` (left-padded to 4 chars) equal to it; otherwise that candidate is rejected. If the descriptor carried **no** last-4, this gate is skipped and matching relies on issuer + amount + date.
- **R5 — Date window.** A candidate is kept only if the bank row's `posted_date` is within **±30 days inclusive** of the candidate CC statement's `period_end`. 30 days exactly = kept; 31 days = rejected.
- **R6 — Amount match to the cent.** Within a surviving candidate, a match requires a CC-side `payment_to_card` row whose **absolute** `amount_minor` equals the bank row's absolute `amount_minor` exactly.
- **R7 — Exactly-one ⇒ auto-link; zero or many ⇒ no link.** Collect all `(cc_import, cc_payment_row)` matches across all candidates. If exactly one ⇒ emit one `ReconciliationLink`. If zero ⇒ no link. If two or more ⇒ **no link** (ambiguous; never guess — see INV6).
- **R8 — Confidence.** `confidence_score = 1.0` when the descriptor carried an explicit `card_last_4`; `0.85` when matched by issuer + amount + date only (no last-4 in the descriptor).
- **R9 — Link field population.** On an emitted link: `bank_import_index`/`bank_transaction_index` point to the originating bank row; `cc_import_index` to the matched CC import; `cc_transaction_index` to the matched CC payment row; `link_type='auto'`; `matched_amount_minor` is the POSITIVE absolute amount; `matched_date` is the bank row's `posted_date`.
- **R10 — `findLinkForBankTxn` is a lookup.** Returns the link whose `bank_import_index` and `bank_transaction_index` both equal the args, else `undefined`.
- **R11 — Purity.** `reconcileImports` is a pure function of its input (same imports ⇒ deeply-equal links).

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Index validity.** For every emitted link: `bank_import_index` and `cc_import_index` are valid indices into `imports`; `bank_transaction_index` is valid within the bank import; `cc_transaction_index` is either `null` or a valid index within the cc import.
- **INV2 — Amount agreement.** `matched_amount_minor === |bank row amount_minor|`, and (when `cc_transaction_index !== null`) `=== |cc row amount_minor|`. Always `> 0n`.
- **INV3 — Side typing.** The bank side of every link is a non-`credit_card` import; the cc side is always a `credit_card` import. (A CC-to-CC or bank-to-bank link is impossible.)
- **INV4 — At most one link per bank row.** No two emitted links share the same `(bank_import_index, bank_transaction_index)`.
- **INV5 — Anti-false-positive (the headline safety property).** The matcher NEVER emits a link when two or more distinct CC payment rows match a single bank payment — silence is required over a guess. (US-P1-D + the project's accuracy posture: a wrong drill-down target is worse than none.)
- **INV6 — Logical-match stability under import reordering (metamorphic).** Permuting the `imports` array MUST NOT change the SET of logical links (each identified by the tuple of provenance values `bank_name`+bank row identity ↔ cc `bank_name`+cc row identity), even though the numeric `*_index` fields are relabeled by the permutation. (i.e. reconciliation is a function of the data, not of array position.)
- **INV7 — Determinism.** Same input ⇒ deeply-equal output, including link ordering.

## 6. Domain edge cases that MUST be handled

- No CC imports at all ⇒ no links. No bank imports ⇒ no links. Empty `imports` ⇒ `[]`.
- A CC payment with NO matching bank payment ⇒ the CC still "exists", just no link (links only originate bank-side).
- Two CC statements, same issuer, same last-4, both within the window, both having a row of the matched amount ⇒ **ambiguous ⇒ no link** (INV5).
- Two CC statements same issuer, only ONE within the ±30-day window ⇒ unambiguous ⇒ link to that one.
- Descriptor with last-4 vs CC `account_last_4` stored with/without leading zeros (e.g. descriptor `"...0562"`, CC last-4 `"562"`): the padding rule (R4) must make `'0562'` match `'562'→'0562'`.
- CC `account_last_4 === null` while the descriptor carried a last-4 ⇒ cannot satisfy R4 ⇒ no match via that candidate.
- Boundary dates: exactly 30 days (match), 31 days (no match), bank date before vs after period_end (window is symmetric).
- Amount sign: bank payment `-80000`, CC payment `+80000` ⇒ absolute match. Also guard a bank `payment_to_card` that is positive or a CC row that is negative — match is on absolute value.
- Issuer alias substring matching: bank_name `"Bank of America"` vs issuer `'BofA'` ⇒ matches (R3 via collaborator).
- Multiple distinct bank payments in one statement, each to a different card ⇒ each evaluated independently (R1 loop).
- Same amount paid to TWO different issuers' cards in the window ⇒ each disambiguated by issuer, so two separate unambiguous links (not an ambiguity — different issuers).

## 7. Explicitly OUT of scope / deferred — do NOT report these as bugs

- **The ±30-days-of-`period_end` window itself.** research §R12 originally framed it as ±10 days of the due-date; the module deliberately generalizes to **±30 days of `period_end`** because `payment_due_date` isn't always extracted yet (documented design decision). Verify the ±30/`period_end` behavior as specified in R5; do not flag "spec said ±10/due-date".
- **The internal regex/patterns of `detectCardPayment` and the alias table** — that's `card-payment.ts`, a separate module (future IV&V run). Treat its public output as a trusted oracle per §3b.
- **`link_type: 'manual'` and the multi-match user-choice UI** — `reconcileImports` only emits `'auto'`; manual linking is deferred.
- **The FIFO "which purchases" attribution** — `transaction-stream.ts`, separately signed off. This module only identifies WHICH card/statement.
- **The exact 0.85 number** as a tunable — verify only that no-last-4 matches are scored lower than explicit-last-4 matches (1.0) per R8; the specific 0.85 is a Designer constant, not spec-pinned.

## 8. Error contract (no silent failures)

- `reconcileImports` is **total** on well-shaped input: it MUST NOT throw for any combination of valid `ImportedStatement[]` (including empty arrays, missing matches, malformed-but-typed amounts/dates). It returns `[]` when nothing matches.
- It must never emit a link that violates INV1–INV5. "No silent failure" here = it must never silently emit a WRONG/ambiguous link (INV5); when uncertain it returns fewer links, never a fabricated one.
- `findLinkForBankTxn` returns `undefined` (not throw) when no link matches.
- Dates are assumed well-formed ISO `YYYY-MM-DD` (adapters guarantee this upstream); you need not fuzz malformed date strings, but DO test the full valid range incl. month/year boundaries and leap days for the ±30-day window.

## 9. Security expectations
N/A — single-user, in-memory, no authz boundary.

## 10. Runtime/behavioral expectations
N/A — pure logic module.

## 11. Known oracle hazards (Knight & Leveson note)

- **Date-window arithmetic** is the trickiest oracle: compute the ±30-day boundary with an independent date method (e.g. epoch-day differencing) and test month/year/leap-day crossings — do NOT mirror a suspected implementation. Verify symmetry (bank date before AND after `period_end`).
- **Ambiguity (INV5)** is the highest-value safety probe: construct inputs with 2+ valid matches and assert ZERO links. A matcher that "helpfully" picks one would pass naive example tests but violate the spec's accuracy posture — hunt this hard.
- **Index-vs-logical identity (INV6):** because outputs are array indices, a correct matcher and a buggy one can both "look right" on a single fixed ordering. The permutation metamorphic relation (reorder imports, expect the same logical link set) is the oracle-independent check that catches position-dependent bugs — the same bug-class family as D13/D19 elsewhere in this codebase.
- **Last-4 padding (R4):** the `'562'` vs `'0562'` normalization is an easy off-by-one oracle; hand-derive both sides.
