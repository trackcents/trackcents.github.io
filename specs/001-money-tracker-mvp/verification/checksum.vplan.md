# Verification Plan — checksum (the hard import gate)

> MODE: PLAN (cheap plan-gate pass). Independent verification engineer.
> DUT: `runChecksumGate(statement, transactions) → ChecksumGateResult` in `src/lib/app/checksum.ts` (NOT read).
> Derived from the contract + spec ONLY. No stimulus / scoreboard / mutation built yet.
> Risk tier: **P0 — money truth** (the constitution's Principle II enforcement point). Mutation floor 80, coverage 95/90.

---

## 0. Files I read (independence audit)

- `specs/001-money-tracker-mvp/verification/checksum.contract.md` (the contract — primary)
- `specs/001-money-tracker-mvp/spec.md` (US-P1-B/C, SC-003, FR-013/014/015, edge cases)
- `specs/001-money-tracker-mvp/research.md` (§R13 — the four checksum levels)
- `specs/001-money-tracker-mvp/data-model.md` (statements reconciliation fields, sign convention)
- `.specify/memory/constitution.md` (Principle II)
- `tests/_framework/coverage-model.ts`, `tests/_framework/scoreboard.ts` (reusable bench)

**Did NOT open:** `src/lib/app/checksum.ts`, `src/lib/util/money.ts` body, any other `src/**` body, any `tests/unit/**`. No implementation body or Designer test was read. The interface and input shapes used below are transcribed from contract §3/§3a, not from source.

---

## 1. Verification plan — lenses to build in EXECUTE

The DUT is a **pure decision gate**: `(ParsedStatement, ParsedTransaction[]) → {ok, ...}`. It is deterministic, total, side-effect-free, money-exact (bigint). That shape makes it an ideal scoreboard + property + metamorphic target. Planned lenses:

### L1 — Independent from-spec reference gate + scoreboard
Write a second `runChecksumGate` from the spec **without mirroring any suspected implementation**, then run DUT vs model through `Scoreboard{dut, model}` on every directed + random case and `assertClean()`. The reference model derives each level from first principles:

- **Level A** (R4): `expected = opening + Σ(all amount_minor, signed, including zero rows)`; `actual = closing`; pass ⇔ `expected === actual`. Reference computes `Σ` with a plain bigint fold over EVERY transaction (no sign filtering).
- **Level B** (R5): two independent equalities. `debit_actual = |Σ amount_minor where amount<0|` compared to `total_debits_minor` (POSITIVE absolute printed total); `credit_actual = Σ amount_minor where amount>0` compared to `total_credits_minor`. I derive the absolute on the debit side from the sign convention (§3a: outflows negative, `total_debits_minor` positive) — NOT by copying a suspected `Math.abs` call. Model represents B as "passes iff BOTH equalities hold." To express B in the single `expected/actual/diff` triple, I treat `diff_minor` per the contract's R11 (`expected − actual`, pass ⇔ diff 0) and assert the DECISION (`passed`) rather than pinning which of the two sub-diffs the DUT surfaces (see Ambiguity Q7).
- **Level C** (R6 per contract): `expected = previous_balance + |Σ charges (amount<0)| − Σ payments (amount>0)`; pass ⇔ `expected === statement_balance_minor`. Derived from first principles: a charge increases what you owe (add its absolute), a payment reduces it (subtract). **NOTE: contract R6 and spec/research differ — see Ambiguity Q1, the headline finding.** The reference model will implement BOTH candidate equations behind a flag so EXECUTE can run whichever the architect blesses; the DEFAULT before resolution follows the contract (R6) since the contract is the verifier's handed artifact, but the discrepancy is escalated.
- **Level D** (R7): `expected_minor = BigInt(printed_transaction_count)`; `actual_minor = BigInt(transactions.length)`; pass ⇔ equal.
- **Gate composition** (R1/R2/R3/R9/R10): empty `parser_provides` ⇒ refuse `[]`; only-D ⇒ refuse `[]`; else one result per declared entry in order, `ok ⇔ every passed`, `strategy_used = parser_provides.join('+')`.

Scoreboard equality is bigint-aware deep-equal over `{ok, strategy_used|reason-nonemptiness, level_results[].{level,passed,expected_minor,actual_minor,diff_minor}}`. Per contract §7, `message`/`reason` PROSE is NOT pinned; the scoreboard's `eq` will compare the decision + numeric fields and only assert `reason` is non-empty on refusals.

### L2 — Property-based (INV1–INV7), fast-check
- **INV1 Exactness:** for any populated A/B/C level, a ±1-minor-unit perturbation of the balancing field flips `passed` from true→false. Directed + random.
- **INV2 No false PASS** (headline safety): `ok === true` ⟹ `parser_provides` had ≥1 of A/B/C AND every produced `level_results[].passed === true`. Asserted on EVERY generated case — this is the core conservation/safety property.
- **INV3 No false REFUSE:** construct statements that reconcile by construction (build transactions first, then derive the matching balance/total fields), assert `ok === true`. This is the metamorphic "build-it-balanced" generator.
- **INV4 Order independence:** permute `transactions`; gate decision + every `level_results` entry unchanged. (Oracle-free.)
- **INV5 Determinism/purity:** same input twice ⇒ deep-equal output; neither argument mutated (freeze a deep clone, compare after call). (Oracle-free.)
- **INV6 Metamorphic balance-preserving** — see L3.
- **INV7 Shape:** on the run path (≥1 strong level), `level_results.length === parser_provides.length` and `level_results[i].level === parser_provides[i]`.

### L3 — Metamorphic relations (oracle-free; soundness-bounded)
- **MR1 (INV6 A add-k):** for a PASSING Level-A statement, append a transaction `+k` and increase `closing_balance_minor` by `k` ⇒ Level A still passes (any integer k, bigint-exact). Symmetric: append `−k`, decrease closing by `k`.
- **MR2 (INV6 C add-charge):** for a PASSING Level-C statement, append a charge `−k` and increase `statement_balance_minor` by `k` ⇒ Level C still passes. (Validity depends on the resolved Level-C equation, Q1.)
- **MR3 (INV6 scale):** multiply every transaction amount AND every balance/total field by integer factor `m` ⇒ pass/fail decision unchanged for A/B/C. **SOUNDNESS GUARD:** all values are bigint (exact integers), so integer scaling is exact — no float ULP hazard. I will still keep `m` within a bounded range (e.g. |m| ≤ 10^6) purely to keep magnitudes readable; bigint has no representability limit, so this MR is sound by construction. Include `m=0` only as a directed edge (degenerate: everything→0, all-zero still reconciles) and `m<0` to check sign-symmetry of the equations.
- **MR4 (INV4 permutation):** already under L2; restated as the order-invariance metamorphic relation.
- **MR5 (idempotence of decision under duplicate level):** `['A']` vs `['A','A']` ⇒ same `ok` (Q5 — confirm both-pass / strategy `"A+A"`).

**MR soundness discipline (VeriKit case-07 lesson):** every MR will first be sanity-checked against my OWN reference model — if my correct model fails the relation, the relation is out-of-domain, not the DUT. Because this domain is exact bigint integer arithmetic, the classic float translation/scale-invariance false-positive does NOT arise; but I will still run the self-check so the discipline is explicit and any future float creep is caught.

### L4 — Hand-computed golden vectors (defends against shared-spec sign-flip blind spots)
One PASS + one FAIL hand-derived vector per level, arithmetic shown in comments, NOT taken from any DUT output:
- **A pass:** open 10000, txns [−3000, +500] ⇒ Σ=−2500 ⇒ closing 7500 PASS; **A fail:** closing 7499 ⇒ diff_minor `1`.
- **B pass:** txns [−3000, +500] ⇒ |Σneg|=3000, Σpos=500 ⇒ total_debits 3000, total_credits 500 PASS; **B fail:** total_debits 2999 ⇒ debit side fails.
- **C pass:** prev 100000, charges [−5000,−2000], payments [+8000] ⇒ 100000+7000−8000=99000 ⇒ statement_balance 99000 PASS (per contract R6); **C fail:** statement_balance 99001 ⇒ fail. **Also compute the spec/research formula's expected** for the SAME vector to expose Q1 numerically.
- **D pass:** printed 2, txns length 2 PASS; **D fail:** printed 3 ⇒ fail.

### L5 — Directed "no false PASS / no false REFUSE" battery
Targeted adversarial inputs: sign-flipped debits (B should fail), one-transaction-dropped (A should fail), an amount off by 1 cent (every level should fail), a statement that reconciles on A but a deliberately-broken B (multi-level one-fail ⇒ refuse), all-D refusal, empty-provides refusal.

### L6 — Exactness probe (±1 minor unit), directed
For each of A/B/C: take a balanced statement, perturb the comparison field by exactly `+1n`, `−1n`, `0n` and assert FAIL/FAIL/PASS and `diff_minor ∈ {−1n? , +1n? , 0n}` per R11 direction. (INV1.)

### Lenses deliberately NOT applied (proportionality)
- **Fuzzing / malformed-input corpus:** the DUT consumes already-typed `ParsedStatement`/`ParsedTransaction[]` (TS-enforced, levels validated upstream per §8) — it is NOT a parser of external bytes. The contract says I need not fuzz invalid level strings. I WILL include adversarial *value* shapes (null fields, huge bigints, negative balances, zero rows) as directed cover points, but a persisted byte-corpus is overkill here. Stated and declined.
- **Stateful / model-based history (`fc.commands`):** DUT is pure and stateless. N/A.
- **Security lens:** contract §9 N/A (single-user, no authz). Declined.
- **Runtime/Playwright:** contract §10 N/A (pure logic). Declined.
- **MC/DC aspiration:** P0 money kernel — I WILL drive to 100% branch coverage and design INV1/INV2 + the per-level pass/fail goldens so each condition (each level's pass predicate; each missing-field predicate; the ≥1-strong-level predicate; the only-D predicate) independently affects the result. No padding of unreachable defensive branches.

### Mutation (Phase E, EXECUTE only)
Stryker on `src/lib/app/checksum.ts` (it's under `src/lib/app/**`, in-scope). Target ≥80 (P0 floor). Plus reference-model self-mutation: corrupt my model's Level-B `Math.abs`/sign filter and confirm the scoreboard FAILS — proves the bench has teeth.

---

## 2. Functional cover points (the §6 edges are the floor; I added more)

Coverage model bins for EXECUTE (`assertClosed()` gates sign-off):

**Gate-composition bins**
- `provides=[]` → refuse, `[]`
- `provides=['D']` → refuse, `[]`
- `provides=['D','D']` → refuse, `[]`
- `provides=['A']` single strong level → run
- multi-level all-pass `['A','B']`
- multi-level all-pass `['A','B','C','D']`
- multi-level one-fail `['A','B']` A-pass B-fail → refuse, both results present
- multi-level one-fail where the FAILING level is D-with-strong (`['A','D']`, A pass, D fail) → refuse (R3, not R2)
- `['A','D']` both pass → ok, strategy `"A+D"`
- duplicate level `['A','A']` both pass → ok, strategy `"A+A"`
- duplicate level `['A','A']` where A fails → refuse, two results
- declared order preserved in strategy: `['B','A']` → `"B+A"` (order ≠ sorted)

**Per-level PASS bins:** A-pass, B-pass, C-pass, D-pass
**Per-level FAIL bins:** A-fail, B-fail (debit side), B-fail (credit side), C-fail, D-fail
**Missing-field-per-level bins (R8):** A declared, opening null → fail; A declared, closing null → fail; B declared, total_debits null → fail; B declared, total_credits null → fail; C declared, previous null → fail; C declared, statement_balance null → fail; D declared, printed_count null → fail

**Value-partition bins**
- empty `transactions` + A with opening===closing → pass
- empty `transactions` + B with total_debits=0,total_credits=0 → pass
- zero-amount row present, Level A (in signed sum, no effect) → still reconciles
- zero-amount row present, Level B (in NEITHER partition) → still reconciles (Q2)
- zero-amount row present, Level C (in NEITHER partition) → still reconciles (Q2)
- all-debit statement (no credits): B `total_credits=0`, credit_sum=0 → credit side passes
- all-credit statement (no debits): B `total_debits=0`, debit_sum=0 → debit side passes
- negative opening/closing balance (overdraft), Level A → signed arithmetic holds
- negative previous/statement balance (credit balance on card), Level C → holds
- very large bigint Σ exceeding 2^53 minor units → bigint exact, no precision loss
- exact boundary diff `+1n` → fail; `−1n` → fail; `0n` → pass (each of A/B/C)
- D count where printed===length but a transaction has wrong amount (A would catch, D would not) — confirms D's weakness rationale when combined

**Cross-coverage bins (UVM cross)**
- (zero-row) × (Level A vs B vs C) — the §11 oracle hazard
- (negative balance) × (Level A vs C)
- (one-fail) × (which level fails) for A/B/C/D

Target: 100% closure (every declared bin hit ≥1) before sign-off; any waived hole justified in writing.

---

## 3. Requirements → cover-point traceability (R1–R11, INV1–INV7)

| Req | Statement | Cover point(s) | Check lens |
|---|---|---|---|
| R1 | empty provides ⇒ refuse `[]` | `provides=[]` | L1 scoreboard, INV2 |
| R2 | only-D ⇒ refuse `[]` | `['D']`, `['D','D']` | L1 scoreboard |
| R3 | ≥1 strong ⇒ run all, ok ⇔ all pass | all multi-level bins | L1, INV2, INV3 |
| R4 | Level A formula | A-pass, A-fail, empty+A, zero-row+A, neg-balance+A | L1, L4 golden, L6 |
| R5 | Level B formula (abs debit, signed credit) | B-pass, B-fail(debit), B-fail(credit), all-debit, all-credit, zero-row+B | L1, L4, §11 hazard |
| R6 | Level C formula (contract reading) | C-pass, C-fail, neg-balance+C, zero-row+C | L1, L4, **Q1 escalation** |
| R7 | Level D count | D-pass, D-fail, D-null | L1, L4 |
| R8 | declared-but-unpopulated ⇒ that level fails | all 7 missing-field bins | L1, directed |
| R9 | strategy_used = join('+') in order | `"A+B"`, `"A+B+C+D"`, `"B+A"`, `"A+A"`, `"A+D"` | L1, INV7 |
| R10 | level_results 1-per-provides on pass AND fail | multi-level all-pass + one-fail bins | INV7 |
| R11 | diff = expected − actual; pass ⇔ diff 0; D as bigint | boundary `±1n`/`0n` bins | L6, L1 |
| INV1 | exactness, no tolerance | boundary bins for A/B/C | L6, INV1 property |
| INV2 | no false PASS | EVERY generated case | L2 property (headline) |
| INV3 | no false REFUSE on reconciling stmt | build-balanced generator | L2 property |
| INV4 | order independence | permutation MR | L2/L3 |
| INV5 | determinism/purity | double-call + frozen-arg | L2 |
| INV6 | metamorphic add-k / scale | MR1/MR2/MR3 | L3 |
| INV7 | results count = provides length, .level matches | shape bins | L2 |

100% of R1–R11 and INV1–INV7 map to ≥1 cover point and ≥1 check. **No traceability gaps** — except that R6's correctness cannot be certified until Q1 is resolved (the equation itself is ambiguous between contract and spec).

---

## 4. Spec-ambiguity list (the key PLAN output)

Each item: exact quote + location, defensible readings, expected black-box behavior reasoned from worked examples (NO code run). Ordered by severity.

---

### Q1 — **[HEADLINE / HIGH] Level C equation: contract R6 omits the `credits` term that the spec AND research §R13 both include.** Contract-vs-spec disagreement → a finding by contract §2.

**Contract R6** (`checksum.contract.md:77`):
> "Level C ... passes iff `previous_balance_minor + |Σ(charges, amount_minor<0)| − Σ(payments, amount_minor>0) === statement_balance_minor`"

**Spec FR-013** (`spec.md:165`):
> "Level C — Credit card balance equation: `previous_balance + sum(charges) - sum(payments) - sum(credits) == new_balance`"

**Research §R13** (`research.md:249`) — identical to the spec:
> "`previous_balance + sum(charges) - sum(payments) - sum(credits) == new_balance`"

**The disagreement:** the spec/research equation has FOUR terms (`previous + charges − payments − credits`); the contract's R6 has THREE (`previous + |charges| − payments`). The contract folds the sign convention in (charges are negative → take absolute → add), but it **has no separate `credits` term at all.** Contract §2 explicitly says: "If this contract and a spec doc disagree, the spec wins and that disagreement is a finding." This is exactly that case.

**Two defensible readings:**
- **(R-a) Contract reading:** on a credit-card statement under our normalized sign convention (§3a: outflows negative, inflows positive), there are only two transaction sign-classes — charges (negative) and payments/credits (positive). "Payments" in the contract's R6 already SUBSUMES all positive rows (payments AND statement credits/refunds), so the spec's separate `− sum(credits)` is redundant double-bookkeeping. Under this reading R6 is correct and complete: `previous + |charges| − (all positive rows) = new`.
- **(R-b) Spec reading:** "charges", "payments", and "credits" are THREE distinct partitions (e.g. native credit-card sign: purchases positive, payments negative, statement-credits/refunds a third class). Under the spec's literal arithmetic with NATIVE card signs, all three terms are needed. If the DUT implements the spec literally on normalized data, it could **double-subtract** refunds (once as a positive "payment", once as a "credit"), or mis-handle them.

**Why this matters (Knight & Leveson):** this is precisely a sign/partition oracle hazard the contract §11 itself flags. A reference model that blindly copies EITHER text could share a blind spot with the DUT. The risk scenario: a credit-card statement that includes a **refund/statement-credit** (a positive row that is NOT a "payment to the card"). Under R-a it's lumped with payments and subtracted once; under R-b the spec wants it subtracted as a separate `credits` term — but on normalized data that would be subtracting it TWICE. The two readings diverge on ANY statement containing a refund row, which is common.

**Expected black-box behavior (reasoned, contract worked example, `checksum.contract.md:77`):** prev 100000, charges [−5000,−2000], payments [+8000], no refund row ⇒ contract expects `100000 + 7000 − 8000 = 99000`. The spec's four-term formula on this same (refund-free) vector gives the SAME 99000 (credits term = 0). **So the worked example cannot distinguish the two readings** — they only diverge when a statement-credit/refund row exists. This is the dangerous kind of ambiguity: invisible on the happy-path example, divergent on a realistic edge.

**What I need from the architect:** Confirm the canonical Level-C equation **on normalized sign-convention data** (the data the gate actually receives). Specifically: is every positive-amount row treated identically (one "inflow" class, contract R-a), or must statement-credits/refunds be a distinct partition (spec R-b)? If R-a, the spec text FR-013/§R13 should be reconciled (note that it describes NATIVE card signs, pre-normalization). If R-b, the contract R6 is under-specified and the gate must partition positive rows — but then the gate needs a way to TELL a payment from a credit, which `ParsedTransaction` only exposes via `transaction_type` (a field R6 never references). **Until resolved, R6 cannot be certified.** My EXECUTE reference model will default to R-a (contract) but carry both behind a flag.

---

### Q2 — **[MEDIUM] Zero-amount transaction: confirmed-consistent under contract, but the spec's Level-C `credits` term reopens it.**

**Contract §6** (`checksum.contract.md:102`) and **§11** (`checksum.contract.md:133`):
> "A transaction with `amount_minor === 0n`: contributes 0 to Level A's signed sum, and is in NEITHER the `<0` debit partition nor the `>0` credit partition for B/C. (Confirm this is handled consistently — a zero row must not break any equation.)"

**Readings:**
- **(2-a)** Zero rows are inert everywhere: in A's signed sum they add 0; in B/C they fall in neither strict-inequality partition (`<0` and `>0` both exclude 0). All equations are preserved. This is internally consistent and is almost certainly the intent.
- **(2-b) Hazard:** if any implementation (DUT or a naive reference) uses `≤ 0` / `≥ 0` instead of strict `< 0` / `> 0`, a zero row would be counted as BOTH a debit and a credit (or be double-counted). The contract's strict-inequality wording (R5/R6 say `< 0` and `> 0`) makes 2-a authoritative — but this is the exact boundary to test.

**Expected behavior:** PASS. For Level A: opening 10000, txns [−3000, +500, **0**], closing 7500 ⇒ Σ still −2500 ⇒ PASS (zero inert). For Level B: same txns, total_debits 3000, total_credits 500 ⇒ |Σneg|=3000 (zero not in `<0`), Σpos=500 (zero not in `>0`) ⇒ PASS. A zero row must NOT shift either total.

**This is NOT a spec ambiguity per se — the contract resolves it (strict inequalities). I record it as a HIGH-VALUE COVER POINT, not an escalation,** UNLESS Q1 resolves to R-b (a distinct `credits` partition), in which case the partition boundaries multiply and zero-row handling must be re-confirmed across THREE partitions. Flagged as dependent on Q1.

---

### Q3 — **[LOW-MED] Level B reports two equalities through ONE `expected/actual/diff` triple — which sub-diff does a B failure surface?**

**Contract R5** (`checksum.contract.md:76`): Level B "passes iff `|Σ negatives| === total_debits` AND `Σ positives === total_credits`. Both sides must match." But the result shape (§3) is a SINGLE `ChecksumLevelResult` with ONE `expected_minor`, ONE `actual_minor`, ONE `diff_minor`.

**Ambiguity:** when only the credit side fails (debit side OK), what do `expected_minor`/`actual_minor`/`diff_minor` hold? Candidates: (3-a) the debit side's numbers (first sub-check); (3-b) the credit side's numbers (the failing one); (3-c) some combined/summed total (`total_debits+total_credits` vs `|Σneg|+Σpos`); (3-d) null. R11 says `passed === (diff_minor === 0n)` for a runnable level — so whatever is reported, `diff_minor` MUST be `0n` iff BOTH sides match and non-zero iff either side mismatches. A combined-sum representation (3-c) is hazardous: `|Σneg|+Σpos` could equal `total_debits+total_credits` by coincidence even when the two sides are individually wrong but offsetting (e.g. debit over by +5, credit under by −5) → a FALSE PASS, violating INV2.

**Expected behavior / what I verify:** Per contract §7, exact `message` prose is out of scope, but the DECISION and the numeric fields are pinned by R11. **I will NOT pin which sub-diff `expected/actual` carry** (that's a presentation choice the contract leaves open), BUT I WILL assert the safety-critical consequence: a Level-B result is `passed:true` ⇔ BOTH equalities hold exactly, and there is NO offsetting input (debit +k / credit −k) that the gate accepts. If the DUT uses a combined-sum representation that can be fooled by offsetting errors, that is a **CONFIRMED BUG (false PASS)**, not a presentation choice. **Question for the architect only if the DUT turns out to use a single combined comparison:** otherwise this is resolved by INV2.

---

### Q4 — **[LOW] D-only refusal returns empty `level_results`; a strong-level failure returns POPULATED results — confirm these are intentionally different shapes.**

**Contract R1/R2** (`checksum.contract.md:72-73`): empty provides and only-D both refuse with `level_results: []`. **R3/R10** (`checksum.contract.md:74,81`): the run path returns one result per `parser_provides` entry, on both pass and fail. **§11** (`checksum.contract.md:135`) explicitly calls these "two SEPARATE refusal reasons."

**Reading:** This is intentional and well-specified. An all-`D` input refuses with `[]` even though Level D *would* pass — because the refusal is "insufficient verification available" (a gate-eligibility refusal, R2), not a "Level D failed" refusal. A `['A','D']` where A fails returns BOTH results populated (R3 refusal). The shapes are deliberately different and carry different `reason` semantics.

**Not an ambiguity — I record it as a confirm-the-shapes cover point.** I will assert: `['D']`→`reason` non-empty + `level_results.length===0`; `['A','D']` A-fail → `reason` non-empty + `level_results.length===2` (both A and D present). The only thing I CANNOT derive from inputs alone is the exact `reason` STRING — which §7 says is out of scope. No escalation.

---

### Q5 — **[LOW] Duplicate level in `parser_provides` (`['A','A']`): strategy `"A+A"` and double-run, or de-dupe?**

**Contract §6** (`checksum.contract.md:107`):
> "Duplicate level in `parser_provides` (`['A','A']`): each runs; if A passes, both pass; strategy `"A+A"` (defensible — adapters shouldn't declare dups, but the gate must not crash)."

**Reading:** The contract RESOLVES this — each entry runs, `level_results` has TWO entries, strategy is `"A+A"` (via R9's `join('+')`). No de-dupe. This is explicitly stated, so not an open ambiguity.

**Low-risk note for the architect (enumerated as requested, not escalated):** `['A','A']` where A FAILS produces two identical failing results and refuses — fine. `['D','D']` is the only-D case (R2) → refuse `[]`. `['A','A','A']` → strategy `"A+A+A"`, three results. The only theoretical wrinkle: if an adapter declared `['A','A']` and the gate somehow short-circuited after the first, `level_results.length` would be 1, violating R10/INV7. **I will assert `length === parser_provides.length` for duplicate inputs** to catch a short-circuit. No escalation needed — contract is explicit.

---

### Q6 — **[LOW] Level D in a multi-level set is a hard requirement (`['A','D']` requires BOTH) — confirm D never silently "supplements."**

**Contract §7** (`checksum.contract.md:115`):
> "Level-D-as-supplement when combined with a strong level — `['A','D']` runs both and requires both; that's R3, not a special case to challenge."

**Reading:** RESOLVED by the contract. Even though research §R13 calls D "supplementary," once an adapter DECLARES D in `parser_provides`, R3 makes it a hard gate condition — a failing D refuses the import even if A passes. This is stricter than the prose "supplementary" might suggest, but the contract is explicit and §7 pre-empts the challenge.

**Not an escalation, but I flag a CONSISTENCY NOTE for the architect:** research §R13 rule 1 says "Level D alone is insufficient — it only catches missed transactions"; the contract makes a DECLARED D a hard requirement. These are compatible (D-alone refuses; D-with-A must pass). But an adapter author reading only §R13 might expect D to be advisory. **Cover point:** `['A','D']`, A pass, D fail → refuse, both results present. No spec change needed; surfacing for awareness.

---

### Q7 — **[LOW] `total_debits_minor` is "ABSOLUTE positive" — confirm comparison direction against negative debit transactions (§11 sign hazard).**

**Contract §3a** (`checksum.contract.md:68`) + **R5** (`:76`) + **§11** (`:131`):
> "`total_debits_minor` is the ABSOLUTE (positive) printed total of the debit side." / R5: "`|Σ(amount_minor of rows where amount_minor < 0)| === total_debits_minor`". / §11: "compare `|Σ negatives|` to the positive printed total. Hand-derive; don't mirror a suspected implementation."

**Reading:** RESOLVED and the contract even pre-warns it's the classic oracle hazard. Debits are negative; their sum is negative; take absolute; compare to the positive printed total. There is no genuine ambiguity — the contract pins direction. The escalation-worthy risk is only if `total_debits_minor` could ARRIVE as a negative value (contract says it's "ABSOLUTE positive when present" — so a negative `total_debits_minor` is malformed input). 

**Question for the architect (narrow):** if a buggy adapter populates `total_debits_minor` as a NEGATIVE number (violating the "absolute positive" contract), what should the gate do — fail Level B (because `|Σneg|` is positive and won't equal a negative), or is that out of scope as malformed input? The contract's §8 says `parser_provides` values are assumed valid but says nothing about the SIGN of `total_debits_minor`. **Reasoned expected behavior:** `|Σneg|` is always ≥ 0; a negative `total_debits_minor` can never equal it (unless both are 0) ⇒ Level B fails ⇒ refuse. That is the SAFE behavior (no false PASS) and I'll assert it as a cover point, but I flag the under-specification: the contract doesn't explicitly say "a negative `total_debits_minor` fails." Low risk because the safe outcome falls out naturally.

---

### Q8 — **[LOW] "≥1 of A/B/C" eligibility vs per-level pass — does an UNPOPULATED-but-declared strong level satisfy the eligibility check?**

**Contract R2/R3/R8** interaction: R3 says "when `parser_provides` contains ≥1 of A/B/C, run a check for each." R8 says a declared-but-unpopulated level FAILS. 

**Ambiguity:** consider `parser_provides = ['A']` with `opening_balance_minor = null`. Per R3, A is a strong level so the gate is on the "run" path (not R1/R2). Per R8, A fails (missing field) ⇒ gate refuses with ONE populated `level_results` entry (`passed:false`, nulls). 

- **(8-a)** This is the intended path: declaring A makes you eligible (you're NOT in the only-D refusal), but the missing field fails the level, so you refuse via R3-with-all-fail rather than via R2. `level_results.length === 1` (populated, not `[]`).
- **(8-b) Confusable alternative:** one might argue that a declared-but-unpopulated A provides no real verification, so it should be treated like only-D and refuse with `[]`.

**Contract resolves toward (8-a):** R8 says the level's RESULT has `passed:false` with nulls (a populated result), and §11 says R1/R2 return `[]` while R3 failures return populated results. So `['A']` with null opening → refuse with ONE populated failing result, NOT `[]`. **The §6 edge `checksum.contract.md:98` confirms this:** "`['A']` with `opening_balance_minor = null` ⇒ Level A fails (missing) ⇒ refuse (R8)" — R8 path, populated result. 

**Not a genuine ambiguity — the contract+edge resolve it. Recorded as a cover point** (distinguish the `[]` refusal of R1/R2 from the populated refusal of R8). No escalation.

---

## 5. Summary

**Ambiguities requiring architect escalation BEFORE EXECUTE:**
- **Q1 (HIGH, headline):** Level C equation — contract R6 (three-term, normalized) vs spec FR-013 / research §R13 (four-term, with separate `credits`). Contract §2 makes this a mandatory finding. Diverges on any statement with a refund/statement-credit row; invisible on the worked example. **Must resolve which equation is canonical on normalized-sign data, and whether the gate must partition positive rows into payments vs credits (and if so, by what field).**
- **Q7 (LOW):** behavior on a malformed NEGATIVE `total_debits_minor` is under-specified (safe outcome — Level B fails — falls out naturally, but not stated).

**Resolved by the contract — recorded as HIGH-VALUE COVER POINTS, not escalations:**
- Q2 zero-amount rows (strict-inequality partitions; inert) — re-confirm if Q1 → R-b.
- Q3 Level-B single-triple representation — resolved by asserting INV2 (no offsetting false PASS); only escalate if the DUT uses a foolable combined sum.
- Q4 different result shapes for R1/R2 (`[]`) vs R3 (populated) — intentional.
- Q5 duplicate level `['A','A']` → `"A+A"`, two results, no de-dupe.
- Q6 declared D is a hard requirement (consistency note vs §R13 "supplementary").
- Q8 declared-but-unpopulated strong level → R8 populated-result refusal, not `[]`.

**Traceability:** 100% of R1–R11 + INV1–INV7 map to ≥1 cover point and ≥1 planned check. The ONLY thing that blocks full certification in EXECUTE is **Q1** — R6's correctness cannot be judged until the Level-C equation is disambiguated, because both candidate reference models would otherwise risk a correlated blind spot with the DUT exactly where they diverge (refund rows).

**If Q1 is resolved (and Q7 noted), EXECUTE can proceed to full coverage closure + scoreboard + mutation sign-off.** No other ambiguity blocks expensive work.
