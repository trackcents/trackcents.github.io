# Verification retrospective + architect analysis — money_management_tool

> Commissioned after the observation that verification consumed **~10×** the design
> time (~10 h vs ~1 h) for a modest bug yield. This report (a) tabulates what the
> IV&V flow actually did, with real numbers, (b) analyses — as a designer/verifier —
> where deep verification paid off and where it was waste, and (c) states the
> evidence base for the right-sized verif-kit redesign. Date: 2026-05-26.

## 1. What was verified (the hard numbers)

Eleven modules went through the full PLAN→EXECUTE IV&V (fresh-context verifier,
independent reference model + scoreboard + constrained-random + functional-coverage
closure + mutation). Source: `reports/ivv/*.md`.

| # | Module | Tier | Promoted tests | Coverage | Mutation | Code bugs | Spec ambiguities / notes |
|---|--------|------|---------------|----------|----------|-----------|--------------------------|
| 1 | budget-window | core | 42 | 100% (33/33) | 100% | **0** | 3 (escalated, resolved) |
| 2 | sync-engine | critical | 42 | 100% (40/40) | 88.4% | **0** | 1 latent design issue |
| 3 | recurring-detector | core | 45 | 100% (40/40) | 88.8% | **0** | 2 |
| 4 | merchant-trends | core | 41 | 100% (37/37) | high | **1** (determinism) | A1 |
| 5 | csv-import | core (parser) | 78 | 100% (93/93) | 83.6% | **0** | 3 |
| 6 | refund-resolution | critical (money) | 29 | 100% (29/29) | 98.2% | **0** | 0 |
| 7 | category-budget | core | 30 | 100% (23/23) | 87.2% | **0** | 0 |
| 8 | transfer-detector | core | 32 | 100% (29/29) | 71.6% | **0** | 3 |
| 9 | split-distribution | critical (money) | 32 | 100% (24/24) | in-scope 100% | **0** | 0 |
| 10 | transaction-stream | critical (money) | 52 | 100% (55/55) | 84.0% | **2** (D19, D20) | + contract typo |
| 11 | reconciliation | critical (money) | 29 | 100% (49/49) | 96.7% | **1** (D22) | A7 (doc), A3/A6 |
| — | **TOTAL** | — | **~452** | **100% everywhere** | 71–100% | **4** | ~12 |

**Yield: 4 confirmed code bugs across 11 modules / ~10 h ≈ 1 bug per 2.5 h.**
Seven of eleven modules (64%) found **zero** code bugs from the full heavy run.

## 2. Which technique actually found each bug (the decisive finding)

| Bug | Module | Severity | Found by | Cost of the finding technique |
|-----|--------|----------|----------|-------------------------------|
| Same-day price-jump ordering | merchant-trends | real | **metamorphic reasoning** (permutation invariance) — surfaced by PLAN-stage reading | minutes |
| D19 same-day attribution order | transaction-stream | P0 | **metamorphic reasoning** (permutation invariance) — PLAN gate | minutes |
| D20 cardKeyString collision | transaction-stream | P0 (latent) | **directed adversarial probe** (~28 crafted strings testing injectivity) | minutes |
| D22 statement-vs-row ambiguity | reconciliation | P0 | **one directed test** (two equal payment rows) | minutes |

**Every bug was caught by a cheap, *directed*, reasoning-driven technique** —
independent spec re-reading + a handful of boundary/metamorphic/adversarial tests.
**The expensive phase — thousands of constrained-random cases + mutation testing —
found _zero_ new product bugs.** It did two useful-but-different things: it
*confirmed* correctness on the 7 clean modules, and it *proved the test bench can
fail* (mutation score). Those are **regression-confidence** activities, not
**bug-discovery** activities — and they were run at full volume on every module
regardless of risk or of whether the cheap stage had already found blood.

This is the entire problem in one sentence: **we paid bug-discovery prices for
regression-confidence work, on every module, whether or not the evidence justified
it.**

## 3. Architect analysis — where deep verification paid off vs was waste

Taking the design+verification architect's seat:

**Where it paid (keep):**
- **Independent fresh-context spec re-reading.** Cheap, and the single highest-yield
  activity — it produced every spec ambiguity and, by forcing the verifier to state
  invariants (permutation invariance, conservation), it *reasoned its way* to the two
  determinism bugs before any stimulus ran. This is the core of IV&V and must stay.
- **A small set of high-leverage targeted tests** keyed to the module's *hazard
  class*: boundary-value, conservation/metamorphic, and adversarial probes
  (injectivity for keys, ambiguity for matchers, sign for money). 3 of 4 bugs died
  to ≤1 such test each.
- **Promoting the accepted tests** as permanent regression guards (all 452 stay).

**Where it was waste (gate or cut):**
- **Running the full constrained-random + reference-model scoreboard at thousands of
  cases on every module.** On the 7 clean modules this was pure confirmation; a
  bounded scoreboard (hundreds, stop at coverage closure) on only the *critical*
  ones would give the same assurance.
- **Mutation testing on every module.** It is the most expensive lens
  ([systematic reviews call it impractical at scale due to mutant volume](https://www.sciencedirect.com/science/article/abs/pii/S0164121219301554);
  [industrial CI studies recommend a small live-mutant budget rather than exhaustive runs](https://ieeexplore.ieee.org/document/10132170/)).
  It found **no product bugs** here — it measures *test-suite strength*, which only
  matters for the critical tier. Mutating glue/feature modules is low-signal noise.
- **One-size depth.** A simple feature module (category-budget, savings goals) got
  the same ~25-min treatment as the money-truth core. That violates the first law of
  [risk-based testing — effort proportional to risk](https://totalshiftleft.ai/blog/risk-based-testing-strategy-explained),
  and the principle that you test to *acceptable* risk, not zero.

**Risk tiers that should drive depth (project-agnostic):**
- **Critical** — value/money math, safety/validation gates, security/authz, crypto,
  data-integrity invariants, irreversible actions. (checksum gate, FIFO, reconciliation, money)
- **Core** — non-trivial bank/feature-agnostic logic; parsers of untrusted input.
- **Supporting** — glue/orchestration over already-verified parts; simple transforms.
- **Chrome** — UI/formatting/non-logic. No IV&V; smoke only.

## 4. The redesign in one paragraph (full spec in verif-kit/docs/methodology.md §"Proportionality")

Replace "always build the full environment" with a **tiered, evidence-gated** flow:
**Triage** (classify risk, seconds) → **Stage 1: Review + targeted probes** (cheap,
minutes — independent spec read + boundary/metamorphic/adversarial/golden tests; this
is the bug-finding stage and is **always** run for Core/Critical) → **Stage-1 gate**
(escalate to Stage 2 **only** if Stage 1 found a bug, *or* the module is Critical with
a state/combinatorial space the targeted set can't pin) → **Stage 2: Deepen**
(reference-model scoreboard + *bounded* random to coverage-closure + *incremental,
sampled* mutation — time-boxed, Critical tier mainly). Hard rule: **total IV&V time ≤
~1× the module's design time**; mutation is Stage-2-only and never gates Core/Supporting.
Spec ambiguity still escalates to the human, cheaply, at Stage 1.

Applied retroactively to this project: all 4 bugs would have been caught in **Stage 1**
(minutes each); only `transaction-stream`, `reconciliation`, `checksum` (Critical, and
two had blood) would have earned **Stage 2** — an estimated **~70–80% time reduction**
with the same bugs caught. (This estimate is being validated empirically in a separate
fresh-context run — see `reports/overnight-build/verifkit-revalidation.md` when complete.)

## 5. Sources

- Risk-based testing / effort ∝ risk / stop at acceptable risk:
  [Total Shift Left](https://totalshiftleft.ai/blog/risk-based-testing-strategy-explained),
  [testomat.io](https://testomat.io/blog/risk-based-testing/),
  [BrowserStack](https://www.browserstack.com/guide/risk-based-testing-in-agile).
- Mutation-testing cost / impracticality at scale / CI live-mutant budget:
  [ScienceDirect SLR](https://www.sciencedirect.com/science/article/abs/pii/S0164121219301554),
  [IEEE CI case study](https://ieeexplore.ieee.org/document/10132170/),
  [Predictive Mutation Testing (arXiv)](https://arxiv.org/pdf/2309.02389).
- Existing verif-kit grounding (kept): NASA IV&V SWE-141, IEEE 1012, Knight & Leveson
  1986, Doulos CDV/UVM, SQLite testing, Jepsen, OWASP A01.
