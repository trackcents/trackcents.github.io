# Verification Plan (PLAN pass) — transaction-stream (per-card FIFO payment attribution)

> Produced by the independent **verification-engineer** in **PLAN mode** from the
> contract + cited spec ALONE. The implementation source
> (`src/lib/app/transaction-stream.ts`) and the Designer's tests were **NOT** read.
> This is the cheap plan-gate pass: verification plan + cover points +
> traceability + the spec-ambiguity list. No stimulus / scoreboard / mutation was
> built or run. Black-box probes below are **thought-experiments on the contract's
> worked examples**, not code runs.

---

## 0. Files I read (independence audit)

- `specs/001-money-tracker-mvp/verification/transaction-stream.contract.md` (primary)
- `specs/001-money-tracker-mvp/spec.md` (US-P1-D / SC-004, edge cases, FR-030..FR-035)
- `specs/001-money-tracker-mvp/data-model.md` (sign convention, `transaction_type` enum, schema)
- `specs/001-money-tracker-mvp/research.md` (§R12 reconciliation background)
- `.specify/memory/constitution.md` (Principle II — integer cents, accuracy)
- `tests/_framework/scoreboard.ts`, `tests/_framework/coverage-model.ts` (test infra utilities)

**NOT read** (independence preserved): `src/lib/app/transaction-stream.ts`, any other
`src/**`, any `tests/unit/**`. No implementation body appears above.

---

## 1. Verification plan — lenses for the EXECUTE pass

The DUT is pure, deterministic, money-truth logic over an in-memory import set. Five
public functions: `cardKeyString`, `buildCardStreams`, `computeFifoAttributions`,
`unpaidBalanceAfter`, `findAttributionForPosition`. The right lens mix:

### 1.1 Independent reference model + scoreboard (`tests/_framework/scoreboard.ts`)
I will write a **second, from-spec implementation** of all five functions — never
derived from the DUT — and wire `Scoreboard{dut, model}` for each. The model is the
golden for **structure** (stream membership, ordering, `paid_for` positions/ordering,
which payment maps to which attribution, `findAttributionForPosition` lookups). Per
the contract §11 oracle hazard, I will **NOT trust the model's money totals on their
own** — every money total is independently cross-checked against the conservation
identities (INV1/INV2), which are hand-derivable and do not require re-deriving FIFO.
So the scoreboard catches ordering/position bugs; conservation catches money bugs;
neither alone is sufficient.

bigint discipline: the scoreboard's `deepEqual` and `stringify` are already
bigint-aware. All money assertions are on `bigint`; I will never `Number()`-roundtrip.

### 1.2 Property-based (fast-check) — the invariants INV1–INV7
Constrained-random generators produce **legal** card streams. Each generated run
asserts every applicable invariant inline (self-checking at the property level), and
feeds the scoreboard. Generators (the "sequencer"):
- a `ParsedTransaction` arbitrary parameterized by `transaction_type`, sign, magnitude
  (including > 2^53 cents via `fc.bigInt`), `posted_date` drawn from a **small** date
  pool (to force ties) AND a wide pool (to exercise distinct-date ordering);
- an `ImportSuccess` arbitrary wrapping a `ParsedStatement` whose `account_type` and
  `account_last_4` are drawn to exercise R2/R3 (include credit_card/loan; include
  excluded types; include null last_4);
- an `imports[]` arbitrary that mixes multiple cards / multiple banks / same-last-4
  across banks (R4, multi-card disambiguation).

### 1.3 Metamorphic relations (oracle-free — highest value, INV7)
- **MR-permute-imports**: permuting `imports[]` must not change attributions or
  `unpaidBalanceAfter` — **scoped to streams whose rows all have DISTINCT dates**
  (the contract bounds INV7's validity domain to distinct dates; same-date ties are
  the open question in §4.A below, so the relation must NOT cross that boundary or it
  becomes unsound — a false positive).
- **MR-permute-distinct-date-rows**: permuting transactions that have pairwise-distinct
  `posted_date`s must not change the result.
- **MR-split-payment** (conservation-flavored, needs care): replacing one payment of
  `P` by two consecutive same-date payments `P1+P2=P` should cover the same total debt
  and leave `unpaidBalanceAfter` unchanged — but the *attribution shape* (one vs two
  `PaymentAttribution`s) changes by design, so I assert the **conserved totals**
  (`Σ covered`, `unpaidBalanceAfter`) are invariant, NOT the per-attribution arrays.
  Validity domain: same date so ordering is untouched; only valid if the tie semantics
  in §4.A don't reorder a same-date payment relative to a same-date debit — I will gate
  this relation on "no same-date debit adjacent to the split" until §4.A is resolved.
- **MR-scale-invariant** (money): multiplying every amount by an integer `k>0` scales
  every `covered_amount_minor`, `uncovered_amount_minor`, and `unpaidBalanceAfter` by
  exactly `k`, and leaves all positions/ordering identical. **Soundness guard**: all
  values are exact `bigint` integers, so integer scaling is exact at any magnitude — no
  float ULP trap (the VeriKit 07-variance lesson applies to floats; bigint is immune).
  I will still sanity-check the relation passes on my own correct model before trusting
  it against the DUT.
- **MR-append-zero / append-ignored-type**: appending a zero-amount row, a wrong-signed
  row, or a `transfer`/`deposit`/`withdrawal`/`other` row anywhere must not change any
  attribution or balance (R11). Validity domain: appended row must not share a date with
  a processed row in a way the tie semantics could reorder — append at a strictly-later
  date to stay sound until §4.A resolves.

### 1.4 Hand-computed golden values (oracle-free)
- The canonical US-P1-D worked example from contract §7 (Feb -$341.27, Mar -$15.07,
  Mar +$351.27 ⇒ `paid_for=[{0,34127},{1,1007}]`, `uncovered=0`, `unpaidBalanceAfter=507`),
  with the arithmetic shown in a comment. This is an externally-stated truth in the
  contract, not an observed DUT output.
- A small set of additional by-hand cases: exact-match payment; payment spanning 3
  debits with leftover; refund interleaved; over-payment before any purchase; partial
  coverage then a second payment finishing the partial debit.

### 1.5 Conservation invariants (Beancount/GnuCash double-entry — Principle II)
This is a P0 money module, so conservation is the **first** thing asserted, on every
single generated run, as the strong hand-derivable oracle (contract §11):
- **INV1 per-payment**: `Σ paid_for[i].covered + uncovered === payment.amount_minor`.
- **INV2(a) global**: `totalCovered + totalUncovered === totalPaid`.
- **INV2(b)**: `unpaidBalanceAfter === totalOwed − totalCovered`.
- **INV3**: per-purchase Σcovered ≤ purchase magnitude.
- **INV4**: every covered ≥ 0, uncovered ≥ 0, balance ≥ 0.

### 1.6 Stateful / model-based (fast-check `fc.commands` / `modelRun`)
The module is pure (no persistent state of its own), so a full Knossos/Elle history
check is overkill (declined — see §6). BUT FIFO consumption is itself a little state
machine over the debit queue. I will use a **sequence generator** (an ordered list of
typed transactions as commands: enqueue-debit / apply-payment / apply-refund /
ignored-row) and run my reference FIFO model as the "model" and the DUT as the
"system", checking the debit-queue state (remaining magnitudes per position) after each
payment matches. This is the proportionate stateful lens for a pure FIFO walk.

### 1.7 Fuzz / adversarial (parser-style robustness, scoped)
This module does NOT parse external bytes (the contract marks parsing ☐), so a full
SQLite-style fuzz corpus is lighter here than for an adapter. But §8 says all five
functions are **total** on well-shaped input and must never throw. So I will fuzz with
**pathological-but-well-shaped** values: empty strings, separator-laden bank names &
last-4s (the §11 collision probe — see §4.B), huge bigints, every wrong-sign/zero
combination, dates in odd-but-valid ISO form, deeply nested permutations. Assert: never
throws, never returns a non-bigint money value, never breaks conservation. Any input
that ever triggers a failure is persisted as a seed under
`tests/ivv/corpus/transaction-stream/` and replayed forever.

### 1.8 Fault injection (Phase E, EXECUTE only)
- Stryker mutation on the DUT (target ≥ 80, P0 floor). Surviving mutants → strengthen
  checks or justify individually.
- Reference-model self-mutation: deliberately off-by-one my own model's FIFO and
  confirm the scoreboard FAILS — proves the bench has teeth (not vacuously green).

---

## 2. Functional cover points (closure target for EXECUTE)

The §6 edge cases are the floor; I add domain cover points from credit-card balance
accounting. Closure = every bin hit ≥ 1 (`CoverageModel.assertClosed()`).

### buildCardStreams / cardKeyString
- `imports.empty` — empty array ⇒ empty map.
- `acct.credit_card.included`, `acct.loan.included`.
- `acct.checking.excluded`, `acct.savings.excluded`, `acct.cash.excluded`,
  `acct.other.excluded`.
- `last4.null.skipped` (even when credit_card).
- `merge.multi_import_same_card` — same (bank,last4) across ≥2 imports → 1 stream.
- `multicard.same_last4_diff_bank` — 2 streams.
- `multicard.same_bank_diff_last4` — 2 streams.
- `provenance.indices_correct` — import_index/transaction_index round-trip.
- `key.separator_collision_probe` — bank/last4 containing the separator sequence
  (see §4.B).
- `key.empty_strings`, `key.unicode_in_fields`.

### ordering (R6, INV7)
- `order.distinct_dates_sorted` — out-of-order distinct dates sorted ascending.
- `order.already_sorted`.
- `order.reverse_sorted`.
- `order.same_date_tie_present` — ≥2 rows share a date (the §4.A hazard bin).
- `order.same_day_purchase_then_payment` (import order P,then pay).
- `order.same_day_payment_then_purchase` (import order pay, then P).
- `order.multiple_purchases_same_day`.

### FIFO attribution (R7–R10, INV1–INV5)
- `fifo.empty_stream` — no attributions, balance 0.
- `fifo.single_debit_no_payment` — no attributions, balance = magnitude.
- `fifo.single_payment_no_debit` — one attribution, paid_for=[], uncovered=full.
- `fifo.payment_exactly_one_debit` — exact match, uncovered 0, balance 0.
- `fifo.payment_spans_many_debits` — consumes ≥3 debits.
- `fifo.payment_partial_last_debit` — partial coverage; remainder survives.
- `fifo.partial_then_finish_next_payment` — 2nd payment finishes the partial debit.
- `fifo.overpayment_uncovered` — payment > available debt ⇒ uncovered>0.
- `fifo.payment_before_any_purchase` — all uncovered, paid_for=[].
- `fifo.canonical_us_p1_d` — the §7 worked example exactly.
- `refund.interleaved_consumes_oldest` — refund behaves as a credit.
- `refund.before_any_debit` — refund with nothing to cover ⇒ uncovered.
- `mix.payment_and_refund_sequence` — both present in one stream.

### defensive sign handling (R11)
- `defensive.debit_positive_skipped` — purchase/fee/interest with amount ≥ 0 skipped.
- `defensive.credit_nonpositive_skipped` — payment_to_card/refund with amount ≤ 0 skipped.
- `defensive.zero_amount_debit`, `defensive.zero_amount_credit`.
- `defensive.ignored_type_present` — transfer/deposit/withdrawal/other present, ignored.
- `defensive.skipped_does_not_corrupt_state` — a skipped row between two valid rows
  leaves the FIFO walk identical to its absence.

### magnitude / precision (Principle II)
- `bigint.exceeds_2_53` — amounts > 9_007_199_254_740_993 cents; no precision loss.
- `bigint.sum_exceeds_2_53` — many debits summing past 2^53.
- `bigint.large_partial_split` — partial coverage of a huge debit yields exact remainder.

### findAttributionForPosition (R13)
- `lookup.hit_payment_position`.
- `lookup.miss_purchase_position` — position indexes a purchase ⇒ null.
- `lookup.miss_out_of_range_high`, `lookup.miss_negative`, `lookup.miss_empty_list`.

### conservation crosses (high value)
- `conserv.inv1_holds_every_payment`.
- `conserv.inv2a_global`, `conserv.inv2b_balance`.
- `conserv.inv3_no_overcover`.

### robustness
- `robust.never_throws_on_pathological` — total-function guarantee (§8).
- `robust.purity_same_input_same_output` (INV6) — call twice, deep-equal.

---

## 3. Requirements → cover-point / lens traceability (100% target)

| Req | Cover point(s) | Lens / check |
|---|---|---|
| **R1** cardKeyString identity | key.* , multicard.same_last4_diff_bank, multicard.same_bank_diff_last4, key.separator_collision_probe | property (injectivity), directed collision probe, **§4.B ambiguity** |
| **R2** only card-like accounts | acct.credit_card.included, acct.loan.included, acct.{checking,savings,cash,other}.excluded | property + directed |
| **R3** skip null last_4 | last4.null.skipped | directed + property |
| **R4** merge by identity | merge.multi_import_same_card | property + scoreboard |
| **R5** provenance indices | provenance.indices_correct | property (round-trip into imports[i].transactions[j]) |
| **R6** order by date asc | order.distinct_dates_sorted, order.already_sorted, order.reverse_sorted | property + scoreboard + worked example |
| **R7** FIFO oldest-first | fifo.* , refund.interleaved_consumes_oldest, fifo.canonical_us_p1_d | scoreboard + golden + INV5 |
| **R8** partial coverage | fifo.payment_partial_last_debit, fifo.partial_then_finish_next_payment | golden + property + INV3 |
| **R9** overpayment uncovered | fifo.overpayment_uncovered, fifo.payment_before_any_purchase | golden + INV1 |
| **R10** one attribution/payment, chrono | fifo.* counts, mix.payment_and_refund_sequence | property (length == #processed credits) |
| **R11** defensive sign handling | defensive.* | property + MR-append-ignored + INV2 |
| **R12** unpaidBalanceAfter correct, ≥0 | conserv.inv2b_balance, fifo.* , bigint.* | INV2(b) + INV4 |
| **R13** lookup | lookup.* | directed + property |
| **INV1** per-payment conservation | conserv.inv1_holds_every_payment | property (every run) |
| **INV2** global conservation | conserv.inv2a_global, conserv.inv2b_balance | property (every run) — strong oracle |
| **INV3** no over-cover | conserv.inv3_no_overcover | property |
| **INV4** non-negativity | INV4 bins across fifo.* | property (every run) |
| **INV5** FIFO discipline | fifo.payment_spans_many_debits, fifo.partial_then_finish_next_payment | property (non-decreasing position consumption) |
| **INV6** purity/determinism | robust.purity_same_input_same_output | property (double-call deep-equal) |
| **INV7** import-order independence (distinct dates) | order.distinct_dates_sorted, MR-permute-imports, MR-permute-distinct-date-rows | metamorphic — **scoped to distinct dates per §4.A** |
| **§8** total / never throws | robust.never_throws_on_pathological | fuzz |

No requirement is unmapped. The only place traceability is *conditional* is INV7,
whose validity domain depends on resolving §4.A.

---

## 4. SPEC-AMBIGUITY LIST (the key output of this PLAN pass)

Each item: exact quote + location, the defensible readings, user-facing impact, and the
current black-box behavior **as derivable from the contract's own worked examples**
(no code was run). Items flagged **[ESCALATE]** need the architect to pin the spec
before EXECUTE; items flagged **[VE-RESOLVED]** I can proceed on without a round-trip.

### 4.A — Same-`posted_date` tie ordering [ESCALATE — primary]

**Quote (contract §11):** "`buildCardStreams` sorts by `posted_date` only; rows sharing
a date retain their pre-sort (import) order. Whether 'purchase-before-payment on the
same day' is guaranteed, or is an accident of input order, is **not pinned by the
spec**." Also §6: "Same-`posted_date` rows: a purchase and a payment on the same day;
... the order they were imported in." And INV7 (§5) explicitly scopes itself to
**distinct** dates, leaving ties open.

**The readings:**
- **Reading A (input-order-defined, currently accepted):** same-date rows keep import
  order; a sort that is not stable, or a stream where a same-day payment is imported
  *before* the same-day purchase it intuitively pays, will attribute differently — and
  that is acceptable because the spec doesn't constrain it.
- **Reading B (deterministic tie-break expected):** on the same day a purchase should be
  considered *before* a payment (you must buy before you pay it off), so the tie-break
  should be `(posted_date asc, then debits-before-credits, then stable import order)`.
  Under B the result is **independent of import order even on tie days**.

**User-facing impact (concrete, this is a real money-truth question):** Consider one
card, both rows dated `2026-03-15`:
- purchase `-$50.00`
- payment_to_card `+$50.00`

Under **Reading B** (purchase first): the payment covers the $50 purchase →
`paid_for=[{purchase,5000}]`, `uncovered=0`, `unpaidBalanceAfter=0`. The user sees
"your $50 payment paid off the $50 coffee-shop charge." Correct, intuitive.

Under **Reading A** with import order `[payment, purchase]`: the payment is processed
with **no debit yet enqueued** → `paid_for=[]`, `uncovered=$50`, and the purchase is
left unpaid → `unpaidBalanceAfter=$50`. The user sees "your $50 payment covered nothing,
and you still owe $50" — **a wrong-looking answer to the app's core question**, flipping
purely on the order two rows happened to be parsed out of the PDF.

So the tie semantics can change *which purchases a payment is said to cover* and even
whether a payment looks fully uncovered. This is exactly the bug-class IV&V caught in
`merchant-trends` (D13), and it is squarely on US-P1-D's critical path (SC-004:
"the credit card transactions that $X covered").

**Current black-box behavior (from the contract, not from code):** The contract states
the sort key is `posted_date` only and ties retain pre-sort import order — i.e. the
implementation as described follows **Reading A**. I have NOT run code to confirm
whether the sort is *stable* (a non-stable sort would make even the import-order
guarantee non-deterministic, which would additionally break INV6/purity for tie days —
a separate, stronger concern I will probe in EXECUTE if A stands).

**Why escalate, not decide:** Both readings are internally defensible and the spec
(US-P1-D/SC-004) constrains only the *outcome* for the matched case, not tie ordering.
Per Knight & Leveson the spec is the shared single point of failure — only the human
architect can pin it. **Recommended question for the architect:** *"On a single card,
when a purchase and a payment_to_card share the same posted_date, must the purchase be
attributed before the payment (deterministic debit-before-credit tie-break), or is
import order an acceptable accident? The choice changes which charges a payment is shown
to have covered on tie days."* My recommendation, for the record, is **Reading B**
(deterministic debit-before-credit tie-break) because it makes the answer independent of
PDF parse order and matches the human mental model the contract cites for choosing FIFO;
but I will verify whatever the architect pins.

**Effect on EXECUTE if unresolved:** I will keep INV7 / all permutation MRs **scoped to
strictly-distinct dates** (sound regardless of the resolution), and add a directed,
*reported-not-asserted* probe of the tie case so the dialogue has concrete numbers.

### 4.B — `cardKeyString` separator collision [ESCALATE if probe shows collision possible]

**Quote (contract §11 / R1):** "Probe whether two genuinely different
`(bank_name, account_last_4)` pairs can map to the same string (e.g. values containing
the separator sequence). If they can, R1 is violated and two cards' streams would
merge — a real money-truth bug." R1: "any pair of card identities that should be treated
as *different cards* MUST produce different strings."

**The hazard:** If `cardKeyString` is something like `` `${bank_name}|${last_4}` `` then
`{bank:"A|B", last4:"1"}` and `{bank:"A", last4:"B|1"}` both → `"A|B|1"` — two distinct
cards collapse into one stream and their debits/payments cross-attribute. This is an
**injectivity** requirement on `cardKeyString`.

**The readings:**
- **Reading A (real-world inputs can't collide):** `bank_name` comes from a fixed
  adapter registry and `account_last_4` is always 4 digits, so no separator can appear;
  collision is unreachable in production and not a bug.
- **Reading B (R1 demands injectivity for ALL string inputs):** the contract's type is
  `bank_name: string` / `account_last_4: string` (unconstrained), §8 says the functions
  are total on well-shaped input, and R1 says "any pair ... MUST produce different
  strings." So a separator collision violates R1 regardless of whether production data
  reaches it.

**User-facing impact:** if it can collide, two different cards' streams merge → a
payment to card X is shown as covering card Y's purchases — catastrophic for a
money-truth module. Low *probability* in production (last_4 is digits), high *severity*.

**Current black-box behavior:** Cannot determine the actual separator from the contract
(it states signatures only, not the format string). This is a **directed EXECUTE probe**,
not a PLAN decision: I will feed adversarial `(bank, last4)` pairs designed to collide
under common separators (`|`, `:`, `\x1f`, `-`, `_`, empty) and an injectivity property
(`cardKeyString(a) === cardKeyString(b)` ⇒ `a.bank===b.bank && a.last4===b.last4` over
random string pairs). **No escalation needed yet** — this is decidable by test. I escalate
ONLY if the probe shows a reachable collision AND the Designer argues Reading A; then the
architect decides whether R1's injectivity is required for unconstrained strings or only
for the constrained production domain. I record it here so the plan gate sees it coming.

### 4.C — Is FIFO itself in scope? [VE-RESOLVED — I agree it is out of scope as an algorithm choice]

**Quote (contract §7):** "**The choice of FIFO itself.** The spec (US-P1-D/SC-004)
specifies the *outcome* ... but not the attribution algorithm. **FIFO ... is the
Designer's decided convention** ... Do not flag 'the spec doesn't say FIFO' as a
correctness bug — flag it only if you find FIFO produces a result that *contradicts* the
spec's stated outcome."

**My position:** I agree FIFO-vs-alternative is out of scope and will NOT report "spec
doesn't mandate FIFO" as a bug. I confirm the worked example (§7) is consistent with
SC-004's stated outcome ("show the line items the $X covered") — FIFO produces *a*
correct set of covered line items, and §7's canonical case is exactly the US-P1-D $800
scenario shape. **One residual I WILL still check (not a scope violation):** that FIFO
never produces a result that *contradicts* the outcome — specifically that conservation
holds (the $X is fully accounted: covered + uncovered = X) and no purchase is
over-covered. Those are the cases where a FIFO bug would yield a wrong answer to the
core question even though FIFO is the right algorithm. No escalation.

### 4.D — "MUST" requirements whose expected output I cannot derive from inputs alone

I checked every R#/INV# against "can I compute the expected output from the inputs +
spec without seeing code?" All are derivable EXCEPT where noted:

- **R6 / §6 tie ordering** — derivable only after §4.A is resolved (the expected order of
  same-date rows is undefined). [covered by 4.A]
- **R1 collision** — derivable as an injectivity *property* but the exact output string
  is not specified (only that it must be stable + collision-free). I will assert the
  *property*, not a specific string format. Not an ambiguity, just a note: I cannot and
  will not assert `cardKeyString(k) === "<some literal>"`.
- **R9 "pre-tracking balance"** — §R9 says an over-payment "paid down pre-tracking
  balance the stream has no record of." This is fully derivable: `uncovered` = payment −
  Σ(available unpaid debt at that point). No ambiguity; just confirming the oracle is the
  conservation identity, not a guess about historical balance. [VE-RESOLVED]
- **R10 "processed" vs skipped count** — §R10 says output length = number of
  payment/refund rows *processed* (R11 skip rule excludes wrong-signed/zero credits).
  Derivable. I note one sub-question below (4.E). [mostly resolved]

### 4.E — Does a zero-amount or wrong-signed *credit* still produce an attribution? [VE-RESOLVED, but confirm in dialogue]

**Quote (contract R11):** "a credit row (`payment_to_card`/`refund`) whose
`amount_minor ≤ 0`, is **skipped** — it does not enqueue, consume, or **produce an
attribution**." And R10: output length = payments/refunds *processed*.

**Reading:** Unambiguous on its face — a `≤ 0` credit is skipped and yields **no**
`PaymentAttribution`. So a `payment_to_card` with `amount_minor === 0` produces zero
attributions (not an attribution with `uncovered=0`). I will assert this. I flag it here
only because it interacts with INV1 (a skipped payment must not appear in the per-payment
conservation sum) and because a plausible alternative implementation might emit a
`{paid_for:[], uncovered:0}` row for a zero payment. **Current black-box behavior (from
contract):** R11 + R10 together mandate "skipped ⇒ no attribution," so the contract is
clear; I'll hold the DUT to it. No escalation, but I'll confirm in the Designer⇄VE
dialogue if the DUT emits a row for a zero credit.

### 4.F — Refund sign convention vs `transaction_type` [VE-RESOLVED]

**Quote (contract §3a sign convention):** "`amount_minor > 0` ⇒ you owe less
(`payment_to_card`, `refund`)." And R7 treats refund identically to payment. data-model
Principle XII models refunds as linked transactions, but the contract §7 explicitly
defers refund-to-original matching and says "refund is ... a generic oldest-first
credit." **Reading:** within this module a refund is a positive-amount credit consumed
FIFO exactly like a payment. No conflict. My reference model will treat `refund` and
`payment_to_card` identically (contract §11 warns against raising a false discrepancy
here). No escalation.

### Summary of escalations
- **[ESCALATE now] 4.A** — same-date tie ordering (purchase-before-payment guaranteed or
  import-order accident). Primary, on the SC-004 critical path. Needs architect ruling
  before EXECUTE so INV7/MRs and the directed tie case are asserted (not just reported).
- **[ESCALATE conditionally] 4.B** — `cardKeyString` separator collision: decidable by a
  directed EXECUTE probe; escalate only if the probe finds a reachable collision and the
  Designer disputes that R1's injectivity must hold for unconstrained strings.
- **All others [VE-RESOLVED]** — I can proceed without a round-trip.

---

## 5. Light black-box probes performed (thought-experiments only, no code run)

- **Canonical §7 example** re-derived by hand: debits queue [34127, 1507]; payment 35127
  consumes 34127 (purchase#0 full) then 1000 of 1507 (purchase#1 partial) ⇒
  `paid_for=[{0,34127},{1,1007}]`... **wait**: §7 says `{1,1007}` (=$10.07) and
  `uncovered=0`, leaving `unpaidBalanceAfter=507`. Check: 34127+1007 = 35134 ≠ 35127.
  Re-read: payment is `+$351.27` = 35127; covers 34127 then 35127−34127 = **1000** of
  purchase#1, so `{1,1000}`, remainder 1507−1000 = 507 = `unpaidBalanceAfter`. **The
  contract's worked example prints `{1, 1007}` but the arithmetic gives `{1, 1000}`.**
  See §5.1 below — this is a CONTRACT-EXAMPLE DISCREPANCY worth surfacing.
- **Tie example** (§4.A) hand-derived under both readings — numbers shown in 4.A.
- **Empty / single-row** cases trivially derived (§6).
- **Over-payment-before-purchase**: payment 5000 with empty queue ⇒ `paid_for=[]`,
  `uncovered=5000`, balance 0 (no debt). Consistent with R9.

### 5.1 — Arithmetic discrepancy in the contract's own worked example [ESCALATE — quick fix]

**Quote (contract §7 / R7 worked example):** "`paid_for = [ {0, 34127}, {1, 1007} ]`
(covers all of Feb's $341.27, then $10.00 of Mar's $15.07) ... `unpaidBalanceAfter = 507`."

**The arithmetic:** payment = $351.27 = `35127` cents. Covers purchase#0 fully = `34127`.
Remaining payment = `35127 − 34127 = 1000` cents = **$10.00** — and the parenthetical even
says "then **$10.00**". So purchase#1 is covered by `1000`, not `1007`. Then
`unpaidBalanceAfter = 1507 − 1000 = 507` ✓ (the stated balance is consistent with `1000`,
NOT with `1007`: `1507 − 1007 = 500 ≠ 507`).

**Conclusion:** the `{1, 1007}` literal in the contract is a **typo**; the self-consistent
value is `{1, 1000}` (and the prose "$10.00" and `unpaidBalanceAfter=507` both confirm
`1000`). This is a contract-text error, not necessarily a DUT bug — but per §2 "If this
contract and a spec doc disagree, the spec wins and that disagreement is a finding," and
here the contract disagrees *with itself*. **Recommended action:** the Designer corrects
the worked example to `{1, 1000}` before EXECUTE, so my hand-computed golden uses the
correct, self-consistent figure. I will encode the golden as `{1, 1000}` (the
arithmetically/prose-consistent value) and flag if the DUT returns `1007`. Low risk, but
exactly the kind of oracle-poisoning a verifier must not silently absorb.

---

## 6. Deliberately OUT of scope for this module (declined, with reason)

- Full Jepsen/Knossos multi-device history check — the module is pure with no persistent
  state of its own (contract §1 "no I/O of its own", INV6 purity). The future sync layer
  is where that lens belongs; prescribed there, not here.
- Multi-currency mixed streams — contract §7 says this module doesn't read `currency`;
  constructing a mixed-currency stream and calling a wrong sum a bug is out of scope. I
  will note it in the honest residual.
- Reconciliation matcher (`reconciliation.ts`) and drill orchestrator
  (`payment-drill.ts`) — separate modules, separately verified.
- SQLite-scale fuzz corpus / sanitizers — JS/TS, no manual memory; the scoped
  pathological-value fuzz (§1.7) covers the real risk.

---

## 7. Honest residual (what independence cannot cover here)

- **Shared-spec blind spot (Knight & Leveson):** my reference model and the DUT both read
  this contract; if the contract itself misstates FIFO semantics, we could agree on a
  wrong answer. Mitigation: conservation (INV1/INV2) and metamorphic relations are
  oracle-free and do not depend on re-deriving FIFO, so they catch money errors the
  shared model would miss. The §5.1 contract typo is a concrete instance — caught only
  because I re-did the arithmetic by hand rather than trusting the printed literal.
- **Tie semantics (4.A) until escalated** — I cannot assert the tie-day attribution as
  correct/incorrect; I can only report the DUT's behavior and the two readings.
- **`cardKeyString` exact format** — unspecified by design; I verify the injectivity
  *property*, not a literal string, so a format change that preserves injectivity is
  invisible to me (correctly so).
- **Mixed-currency streams** — explicitly out of scope; a real mixed-currency card would
  not be caught here.

---

## STOP — end of PLAN pass.

No stimulus, scoreboard, coverage model, or mutation was built or run. The plan gate now
needs the architect to resolve **4.A** (and the quick contract-text fix **5.1**); **4.B**
is a conditional escalation decidable by an EXECUTE probe. Everything else is VE-resolved
and ready for the single EXECUTE pass once 4.A/5.1 are pinned.
