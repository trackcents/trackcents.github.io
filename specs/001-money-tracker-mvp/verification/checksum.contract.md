# Verification Contract — checksum (the hard import gate)

> The only engineering artifact handed to the independent verifier. Implementation-free
> by construction: it states WHAT the module must do and the interface it exposes, never
> HOW. The verifier authors its environment from this contract + the cited spec, and never
> reads the source.
>
> Produced by: the Designer. Consumed by: the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/app/checksum.ts`
- **Public entry point**: `runChecksumGate(statement, transactions) → ChecksumGateResult`
- **Risk tier**: **P0 — money truth.** This is the constitution's enforcement point (Principle II): the HARD IMPORT GATE. Every imported statement's parsed transactions MUST reconcile to the printed totals to the cent; any mismatch must REFUSE the import. A false PASS here means wrong financial data enters the app silently — the single worst failure mode in the product.
- **Touches**: ☑ value/money math ☑ untrusted-ish input (parser output that may be wrong — that's the whole point) ☐ persistent state ☐ concurrency ☐ authn ☐ running UI
- **Collaborator (trusted, not under test):** `formatMoney` from `src/lib/util/money.ts` is used only to compose human-readable messages — its output appears in `message` strings, which are NOT semantically pinned (see §7).

## 2. Authoritative spec sources

If this contract and a spec doc disagree, the **spec wins** and that disagreement is a finding.

- `specs/001-money-tracker-mvp/spec.md` — **US-P1-B / US-P1-C** ("validates the checksum (sum of transactions == stated statement total); if the checksum fails, the app refuses to import and tells me why"); **SC-003** ("for every successfully imported statement, the parsed transaction sum equals the printed statement total to the cent"); edge case "Statement whose checksum doesn't match → refused, with diff shown".
- `specs/001-money-tracker-mvp/research.md` — **§R13** (the four checksum levels A/B/C/D and the "≥1 of A/B/C, D alone insufficient" rule).
- `specs/001-money-tracker-mvp/data-model.md` — the statement reconciliation fields + the signed-cents convention.
- Constitution **Principle II** (integer cents; checksum as a HARD GATE; "silent parsing errors are unacceptable").

## 3. Public interface (signatures only)

```ts
type ChecksumLevel = 'A' | 'B' | 'C' | 'D';

interface ChecksumLevelResult {
  level: ChecksumLevel;
  passed: boolean;
  expected_minor: bigint | null;  // null only when required fields were missing
  actual_minor: bigint | null;    // null only when required fields were missing
  diff_minor: bigint | null;      // expected_minor - actual_minor; null when missing
  message: string;                // human-readable; NOT semantically pinned (see §7)
}

type ChecksumGateResult =
  | { ok: true;  strategy_used: string;  level_results: ChecksumLevelResult[] }
  | { ok: false; reason: string;         level_results: ChecksumLevelResult[] };

export function runChecksumGate(
  statement: ParsedStatement,
  transactions: ParsedTransaction[]
): ChecksumGateResult;
```

### 3a. Relevant input shapes (transcribe locally; don't import internals you don't need)
```ts
interface ParsedTransaction { posted_date: string; description: string; raw_text: string;
  amount_minor: bigint; currency: string; transaction_type: string; status?: string; }
interface ParsedStatement {
  account_type: string; account_last_4: string | null; period_start: string; period_end: string; currency: string;
  opening_balance_minor: bigint | null;       // Level A
  closing_balance_minor: bigint | null;        // Level A
  total_debits_minor: bigint | null;           // Level B — ABSOLUTE value (positive) when present
  total_credits_minor: bigint | null;          // Level B
  statement_balance_minor: bigint | null;      // Level C — the NEW balance
  previous_balance_minor: bigint | null;       // Level C
  printed_transaction_count: number | null;    // Level D
  parser_provides: ChecksumLevel[];            // which levels the adapter declares it populated
  // ...other fields (summary lines, etc.) irrelevant to the gate
}
```
**Sign convention** (Principle II): outflows (purchases/fees/charges/debits) are NEGATIVE `amount_minor`; inflows (payments/credits/deposits) are POSITIVE. `total_debits_minor` is the ABSOLUTE (positive) printed total of the debit side.

## 4. Behavioral requirements (the WHAT)

- **R1 — Empty `parser_provides` ⇒ refuse.** If the adapter declared no level, the result is `{ ok:false }` with `level_results: []` (nothing to verify against ⇒ unverifiable ⇒ refused, Principle II).
- **R2 — Only Level D provided ⇒ refuse.** If `parser_provides` contains no level other than `'D'` (e.g. `['D']`, `['D','D']`), refuse with `level_results: []`. Level D (count) alone cannot catch wrong amounts (research §R13).
- **R3 — Otherwise run every declared level and require ALL to pass.** When `parser_provides` contains ≥1 of A/B/C, run a check for each entry in `parser_provides`; the gate is `{ ok:true }` iff **every** produced `ChecksumLevelResult.passed` is true, else `{ ok:false }`.
- **R4 — Level A (balance reconciliation):** passes iff `opening_balance_minor + Σ(all transactions' amount_minor) === closing_balance_minor`, exactly. Worked example: opening 10000, txns [−3000, +500], closing 7500 ⇒ expected 7500 ⇒ PASS; closing 7499 ⇒ FAIL with `diff_minor = 1`.
- **R5 — Level B (aggregate section totals):** passes iff `|Σ(amount_minor of rows where amount_minor < 0)| === total_debits_minor` AND `Σ(amount_minor of rows where amount_minor > 0) === total_credits_minor`. Both sides must match. Worked example: txns [−3000, +500], total_debits 3000, total_credits 500 ⇒ PASS.
- **R6 — Level C (credit-card balance equation):** passes iff `previous_balance_minor + |Σ(charges, amount_minor<0)| − Σ(payments, amount_minor>0) === statement_balance_minor`, exactly. Worked example: previous 100000, charges [−5000,−2000], payments [+8000] ⇒ expected 100000+7000−8000 = 99000 ⇒ PASS iff statement_balance_minor === 99000.
  - **Equivalence note (resolves the spec's 4-term form — IV&V plan-gate Q1):** spec FR-013 / research §R13 write this in *native* statement terms as `previous + charges − payments − credits = new` (four terms, payments and credits as separate printed lines). Under the data-model's normalized sign convention, **both** `payment_to_card` **and** `refund`/statement-credit rows are POSITIVE `amount_minor` (inflows that reduce what you owe). So `Σ(positives) = payments + credits`, and `previous + |charges| − Σ(positives)` is algebraically identical to `previous + charges − payments − credits` (subtracting the combined positive sum = subtracting payments and credits separately). The two forms NEVER diverge on any input — including refund-containing statements (verify with the INV6 add-a-credit metamorphic relation: a refund `+k` plus a `+k` reduction of `statement_balance_minor` keeps Level C passing). Level C reconciles to two scalar inputs (`previous_balance_minor`, `statement_balance_minor`); it does NOT consume separate printed payment/credit totals (that sign-partitioned split is Level B's job).
- **R7 — Level D (count):** passes iff `printed_transaction_count === transactions.length`.
- **R8 — Declared-but-unpopulated level ⇒ that level FAILS (no silent skip).** If a level is in `parser_provides` but its required field(s) are `null` (A needs opening+closing; B needs total_debits+total_credits; C needs previous+statement_balance; D needs printed_count), that level's result has `passed:false` (and `expected/actual/diff = null`), which forces the gate to refuse. A declared level can never be silently treated as satisfied.
- **R9 — `strategy_used` on success = `parser_provides.join('+')`** preserving the declared order (e.g. `['A','B'] ⇒ "A+B"`).
- **R10 — `level_results` completeness.** On the R3 path (≥1 strong level), `level_results` has exactly one entry per `parser_provides` element — on BOTH pass and fail — in declared order. (Only the R1/R2 early refusals return `[]`.)
- **R11 — `diff_minor` semantics.** For a runnable level, `diff_minor = expected_minor − actual_minor` and `passed === (diff_minor === 0n)`. (Level D encodes count as bigint: `expected_minor = BigInt(printed)`, `actual_minor = BigInt(actual)`.)

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Exactness (no tolerance).** The gate passes a level ONLY on an exact-to-the-cent match. A ±1-minor-unit discrepancy on any populated A/B/C level ⇒ that level fails ⇒ gate refuses. (SC-003; Principle II — no epsilon, no rounding.)
- **INV2 — No false PASS.** `ok === true` ⟹ `parser_provides` contained ≥1 of A/B/C AND every level in `parser_provides` passed its exact check. (The headline safety property: a passing gate guarantees reconciliation.)
- **INV3 — No false REFUSE on a truly-reconciling statement.** If `parser_provides` has ≥1 strong level, all required fields are populated, and every declared equation holds exactly, the gate MUST return `ok:true`.
- **INV4 — Order independence.** Permuting `transactions` does not change any level result or the gate decision (all checks are order-independent sums/counts).
- **INV5 — Determinism / purity.** Same input ⇒ deeply-equal output; the function mutates neither argument.
- **INV6 — Metamorphic (balance-preserving).** For a PASSING Level-A statement, adding a transaction of amount `+k` and increasing `closing_balance_minor` by `k` keeps Level A passing (any integer k, bigint-exact); symmetric for Level C (add a charge `−k`, increase `statement_balance_minor` by `k`). Scaling every amount + every balance field by an integer factor preserves the pass/fail decision.
- **INV7 — `level_results` count = `parser_provides` length on the run path** (R10), and each result's `.level` equals the corresponding `parser_provides` entry in order.

## 6. Domain edge cases that MUST be handled

- `parser_provides = []` ⇒ refuse, `[]` results (R1).
- `['D']` and `['D','D']` ⇒ refuse, `[]` results (R2).
- `['A']` with `opening_balance_minor = null` ⇒ Level A fails (missing) ⇒ refuse (R8).
- Multi-level all-pass: `['A','B']`, `['A','B','C','D']` ⇒ ok, strategy `"A+B"` / `"A+B+C+D"`.
- Multi-level with one failure: `['A','B']` where A passes, B fails ⇒ refuse; `level_results` has both (R10).
- Empty `transactions` with `opening === closing` and `parser_provides=['A']` ⇒ PASS (Σ = 0). With `total_debits=0, total_credits=0` and `['B']` ⇒ PASS.
- A transaction with `amount_minor === 0n`: contributes 0 to Level A's signed sum, and is in NEITHER the `<0` debit partition nor the `>0` credit partition for B/C. (Confirm this is handled consistently — a zero row must not break any equation.)
- Exact boundary: `diff_minor` of `1n` and `-1n` ⇒ fail; `0n` ⇒ pass.
- Very large magnitudes (Σ exceeding 2^53 minor units) ⇒ bigint exact, no precision loss.
- All-debit statement (no credits): Level B `total_credits_minor = 0`, credit_sum = 0 ⇒ that side passes.
- Negative balances (overdraft / credit balance): opening/closing/previous/statement balances may be negative; the equations still hold by signed arithmetic.
- Duplicate level in `parser_provides` (`['A','A']`): each runs; if A passes, both pass; strategy `"A+A"` (defensible — adapters shouldn't declare dups, but the gate must not crash).

## 7. Explicitly OUT of scope / deferred — do NOT report these as bugs

- **Exact `message` / `reason` string wording.** These are human-readable diagnostics composed via `formatMoney`. Assert the DECISION (`ok`, `passed`) and the NUMERIC fields (`expected_minor`, `actual_minor`, `diff_minor`) — do NOT assert exact prose, and do not flag wording choices (e.g. "off by X low/high") as bugs. (You MAY assert that a refusal's `reason` is non-empty.)
- **`formatMoney` formatting** — a separate util, separately tested.
- **WHICH levels an adapter chooses to populate** — that's each adapter's responsibility (verified per-adapter elsewhere). Here, `parser_provides` is an INPUT; verify the gate's behavior given it.
- **Persistence / import_status side effects** — the gate is pure; the caller persists. Out of scope.
- **Level-D-as-supplement when combined with a strong level** — `['A','D']` runs both and requires both; that's R3, not a special case to challenge.

## 8. Error contract (no silent failures)

- `runChecksumGate` is **total** on well-shaped input: it MUST NOT throw for any `ParsedStatement` + `ParsedTransaction[]` (including empty transactions, null balance fields, large bigints, negative balances). It expresses every problem through `{ ok:false }` + `passed:false` + a `reason`/`message`, never an exception.
- "No silent failure" is the module's reason to exist: a declared level whose fields are missing must FAIL (R8), never be skipped; a non-reconciling statement must REFUSE (INV2), never pass. Your conservation/exactness assertions (INV1/INV2/INV3) are what guarantee this.
- `parser_provides` is assumed to contain only valid `ChecksumLevel` values (TS-enforced upstream); you need not fuzz invalid level strings.

## 9. Security expectations
N/A — single-user, in-memory, no authz boundary.

## 10. Runtime/behavioral expectations
N/A — pure logic gate.

## 11. Known oracle hazards (Knight & Leveson note)

- **Level B sign handling** is the easiest oracle to get wrong: `total_debits_minor` is a POSITIVE absolute number, but debit transactions are NEGATIVE — compare `|Σ negatives|` to the positive printed total. Hand-derive; don't mirror a suspected implementation.
- **Level C equation direction**: `previous + |charges| − payments = new`. Charges are negative (take absolute), payments positive (subtract). A correct-looking but sign-flipped oracle would agree with a sign-flipped DUT (correlated error) — defend with hand-computed goldens AND the INV6 metamorphic relation (which doesn't depend on re-deriving the equation).
- **Level A includes ALL transactions** (signed sum, including zero rows), whereas B/C **partition by sign** — a zero-amount row is in A's sum (no effect) but in neither B/C partition. Verify this boundary explicitly.
- **`expected` vs `actual` direction** (`diff = expected − actual`): the pass condition is `diff === 0`, so direction doesn't affect pass/fail, but if you assert `diff_minor` values, get the direction right per R11.
- **The "≥1 of A/B/C" gate vs the per-level pass gate are two SEPARATE refusal reasons** (R1/R2 return `[]` results; R3 failures return populated results) — don't conflate them; an all-`D` input refuses with empty results even though Level D *would* pass.
