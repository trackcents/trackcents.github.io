# verif-kit Staged-Flow Re-Validation Study

**Date:** 2026-05-26
**Question:** Does the cheap **Stage-1** flow (independent spec reasoning + a small set of
targeted boundary / metamorphic / adversarial probes) re-catch the SAME real bugs that the
old heavy IV&V flow caught (thousands of constrained-random cases + mutation testing,
~20–30 min/module)?

**Answer:** Yes, for all four historical bugs — with one Stage-1 probe each, in seconds, not
tens of minutes.

Scratch suite (quarantined, NOT promoted): `tests/ivv/revalidation/staged-revalidation.test.ts`
Run: `pnpm exec vitest run --config vitest.ivv.config.ts tests/ivv/revalidation/`
Result: **9 tests, all green** (test exec 11 ms; cold wall incl. Vite/jsdom startup ~2.7 s).

---

## Results table

| # | Bug (module) | Risk tier | Contract relation | Stage-1 technique | # test cases | Caught on buggy? | Passes on fixed? | Stage-1 time |
|---|--------------|-----------|-------------------|-------------------|:---:|:---:|:---:|:---:|
| 1 | merchant-trends — same-day ordering determinism | P2 (UX-truth, money-bearing) | INV4 permutation invariance / R5 within-merchant order | **Metamorphic permutation** — same data in 2 import orders ⇒ identical trends | 1 buggy + 1 fixed | ✅ yes | ✅ yes | ~2 min author, <1 ms exec |
| 2 | transaction-stream D19 — same-day attribution order | **P0 (money truth)** | R6 total order + INV7 import-order independence | **Metamorphic permutation** — same-day purchase −$50 + payment +$50 ⇒ balance 0 & payment covers purchase in BOTH orders | 1 buggy + 1 fixed | ✅ yes | ✅ yes | ~3 min author, <1 ms exec |
| 3 | transaction-stream D20 — cardKeyString collision | **P0 (money truth)** | R1 injectivity (distinct identities → distinct keys) | **Adversarial injectivity probe** — `{'',':'}` vs `{':',''}` must map to distinct keys | 1 buggy + 1 fixed | ✅ yes | ✅ yes | ~2 min author, <1 ms exec |
| 4 | reconciliation D22 — statement-vs-row ambiguity | **P0 (money truth)** | R7 exactly-one-or-zero + INV5 anti-false-positive | **Directed ambiguity probe** — 2 equal payment rows in ONE statement ⇒ 0 links | 1 buggy + 2 fixed (incl. 1-row control) | ✅ yes | ✅ yes | ~4 min author, <1 ms exec |

Each "buggy" test reconstructs the historical defect in an isolated scratch function and asserts
the **invariant is violated** (so the test passes by *confirming the bug exists*). Each "fixed"
test runs the **real function imported from `src/`** and asserts the invariant **holds**.
Bug 4 adds a single-matching-row control proving the fixed matcher still emits the legitimate link
(so the ambiguity fix isn't just "always return 0").

**Total: 4 distinct Stage-1 probes, 9 assertions/test cases. Every probe caught its bug.**

---

## Effort / cost reduction

| | Old heavy IV&V flow | New Stage-1 flow |
|---|---|---|
| Per module | constrained-random stimulus (1000s of cases) + reference model + scoreboard + functional-coverage closure + **mutation/fault-injection sign-off** | independent contract read → 1 targeted probe keyed to the hazard class → run |
| Wall time / module | ~20–30 min (mutation dominates) | ~2–4 min to author + **<1 ms** to execute |
| 4 modules | **~80–120 min** of compute + thousands of generated cases + 4 mutation runs | **~11 min** of authoring + **11 ms** total execution |

**Reduction: roughly an order of magnitude in wall-clock (≈ 80–120 min → ≈ 11 min authoring),
and ~3–4 orders of magnitude in *executed cases* (thousands of random cases + mutation survivors
per module → 9 hand-picked assertions total).** The Stage-1 probes are deterministic and
hand-derivable, so they also re-run for free in CI forever, whereas the heavy run is too slow to
keep in the inner loop.

Why this works: each of these four bugs lives on a **named hazard axis** that the contract already
calls out (permutation invariance, key injectivity, anti-false-positive ambiguity). Once you read
the invariant from the implementation-free contract, the single probe that exercises that axis is
obvious and surgical. The heavy run *also* found these — but it spent thousands of random cases and
a full mutation pass to rediscover an invariant the contract had already stated explicitly.

---

## Honest residual — what Stage 1 would NOT have caught, and where Stage 2 is still needed

This study only proves Stage 1 re-catches these **four specific, already-characterized** bugs whose
hazard class is named in the contract. It does **not** prove Stage 1 finds *unknown* bugs of other
shapes. Stage 2 (independent reference model + bounded-random stimulus + mutation) remains genuinely
necessary for:

1. **Arithmetic / accumulation bugs that hold the invariant for the hand-picked input but break on
   magnitudes or sequences you didn't think to enumerate.** A targeted probe checks one or two
   inputs; FIFO conservation (transaction-stream INV1/INV2) and `divRound` rounding (merchant-trends
   R4) can be subtly wrong only at large bigints (>2^53), specific partial-coverage chains, or
   half-up boundaries. Bounded-random + the conservation reference model probes that space; a single
   metamorphic probe does not.

2. **Date-window boundary arithmetic (reconciliation R5, ±30 days incl. leap days / month-year
   crossings).** None of these four bugs touched it, so no Stage-1 probe here exercised it. Catching
   an off-by-one in `daysBetween` needs the independent epoch-day oracle across many boundary dates —
   a Stage-2 job.

3. **Surviving-mutant classes with no obvious metamorphic relation** — e.g. a flipped comparator in a
   ranking tiebreak, or a `<=` vs `<` in the FIFO queue drain. Mutation testing is what *proves* those
   branches are pinned; a permutation probe can miss them if the mutated branch still produces an
   order-invariant (but wrong-magnitude) result.

4. **The injectivity probe (Bug 3) is existence-only.** It proves ONE colliding pair exists under the
   buggy encoding and that the fixed encoding separates that pair. It does **not** prove the fixed
   encoding is injective over *all* string inputs — that's a property the contract asserts and that a
   Stage-2 fuzz/property run over random `(bank_name, last_4)` pairs should certify.

**Conclusion.** Stage 1 is the right-sized **bug-re-finding / fast-regression** gate for
contract-named hazard axes: it re-caught 4/4 historical bugs at ~10% of the heavy run's wall time and
a tiny fraction of its executed cases. Stage 2 stays **gated** — invoked when a module has
*accumulation arithmetic, boundary math, or branch-density* that a handful of metamorphic/adversarial
probes provably cannot blanket. For these four specific bugs, Stage 2 was **not needed** to catch them.

---

## Methodology caveat (independence)

This is a **methodology-validation study, not an independence-preserving verification run.** The buggy
variants were reconstructed by reading the *current fixed source*, so the usual IV&V firewall (the
verifier never sees the source) was deliberately dropped. The **probes themselves are spec-driven** —
each asserts the invariant taken from the implementation-free contract
(`specs/001-money-tracker-mvp/verification/{merchant-trends,transaction-stream,reconciliation}.contract.md`),
not anything read from the implementation. The claim proven here is narrow and honest: *given the
contract's named invariant, the single Stage-1 probe keyed to it re-catches the historical bug.*
