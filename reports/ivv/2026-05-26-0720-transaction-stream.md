=== IV&V REPORT — transaction-stream (2026-05-26) ===

Module: src/lib/app/transaction-stream.ts — per-card transaction streams + FIFO
attribution of payments to purchases. Risk tier: **P0 — money truth** (it answers
the app's core US-P1-D question: "the $X I paid to my credit card, which specific
purchases did that $X pay off?"). Public entry points: cardKeyString,
buildCardStreams, computeFifoAttributions, unpaidBalanceAfter,
findAttributionForPosition.

Why now: this P0 core had designer property+stateful tests but had NEVER been
independently verified (the prior 8 IV&V sign-offs were all on newer feature
modules + earlier sync-engine/spending-summary/budget-window). The 12 promoted
suites covered everything EXCEPT the highest-risk money-truth core. This run
closes that gap on the single most important module in the app.

Independence audit: VE read only [contract, its own vplan, spec.md, data-model.md,
research.md, constitution.md, tests/_framework/{scoreboard,coverage-model}.ts, and
the PUBLIC TYPE/SIGNATURE surface of src/lib/app/import.ts (ImportSuccess interface
only, no function bodies — charter explicitly permits public type declarations)].
It did NOT read transaction-stream.ts (the DUT), any other src/** body, or any
tests/unit/** Designer test. The cardKeyString key format was learned BLACK-BOX
from output, not from source. **CLEAN.**

Verification plan: 13 requirements (R1–R13) + 7 invariants (INV1–INV7) + error
contract + 14 domain edges → 55 functional cover points; traceability **100%**
(every R#/INV# → ≥1 cover point + ≥1 check).

Environment: constrained-random fast-check generators (clean + dirty/pathological
transactions, all 6 account types incl. null last-4, multi-card/multi-bank imports)
+ an INDEPENDENT second-implementation reference model (all 5 functions) + 4
scoreboards (~1900 DUT-vs-model comparisons) + INV1–INV7 assertions on every run.
Money TOTALS cross-checked against the hand-derivable conservation identities
(INV1 per-payment, INV2 global), never trusting the shared-spec model's sums alone
(Knight & Leveson discipline). Stimulus: 26 directed + ~5,400 random + 4 metamorphic
relations (full permutation invariance, scale-by-k bigint, append-ignored-row,
split-payment) + a 28-field cardKeyString collision matrix + 2,000 random-pair
injectivity + 1,000-case pathological fuzz.

Functional coverage: **100.0% closure (55/55)** — holes: none.

Fault injection: mutation score **84.02%** (171 killed + 13 timeout / 219) achieved
by the IV&V suite ALONE (Designer tests excluded) — ABOVE the P0 floor of 80. The
35 survivors are classified equivalent or unobservable-through-the-public-contract
(boundary `<=`↔`<` flips at exact equality; internal buildCardStreams construction
variants that produce contract-identical output). Reference-model self-mutation
(off-by-one in the model's FIFO) correctly FAILED the scoreboard → the bench has
teeth. No check was weakened to reach the score.

Discrepancies: **1** surfaced across PLAN + EXECUTE → bugs fixed **1** (D20) /
spec-typo fixed in contract **1** (PLAN §5.1) / spec ambiguities resolved at the
plan gate **1** (D19) / VE misreads **0** / out-of-scope **0**.

  • PLAN §5.1 (contract typo, CONFIRMED — Designer error, no code bug): the
    contract's worked example said the 2nd coverage was 1007¢; correct is 1000¢
    (35127 − 34127 = 1000; 1507 − 1000 = 507 = unpaidBalanceAfter). Fixed in the
    contract so the oracle wasn't poisoned — caught by the VE before any stimulus,
    exactly what the cheap PLAN gate is for.

  • D19 (SPEC AMBIGUITY → resolved at plan gate, CONFIRMED determinism bug):
    buildCardStreams sorted by posted_date ONLY, so same-day rows kept import order.
    A same-day purchase −$50 + payment +$50 imported payment-first left the payment
    covering nothing (balance $50) instead of $0 — the answer flipped on PDF/parse
    order. Same bug-class as merchant-trends D13. Resolved (Reading B) with a
    deterministic intrinsic-field total order: posted_date asc → debits before
    credits → amount_minor asc → description asc. INV7 (import-order independence)
    now holds UNCONDITIONALLY. The old "original order matters" test was rewritten
    into a two-direction order-independence test. Decision logged DECISIONS D19,
    flagged for morning confirmation.

  • D20 (CONFIRMED BUG, fixed): cardKeyString used `${bank}::${last4}`, which is
    NOT injective — {bank_name:'', account_last_4:':'} and {bank_name:':',
    account_last_4:''} both produce ':::'. Two DIFFERENT cards would merge into one
    stream and a payment would be mis-attributed across cards (a money-truth error
    on US-P1-D's critical path). Low probability in the production domain (4-digit
    last-4 + registry bank names — VE verified 0 collisions there and 0/2000 random
    pairs), high severity. Designer ruling: CONFIRMED BUG (contract R1 requires
    injectivity over the typed `string` domain; constitution "defaults to no on
    anything that weakens accuracy" — relying on "production won't hit it" for a
    money-truth identity function is the silent-failure posture the constitution
    forbids). Fixed with an injective JSON-tuple key (`JSON.stringify([bank,
    last4])`); the key is a purely internal Map key (built + looked up via the same
    function, never persisted), so the format change is safe. The VE's
    D1-documenting test was flipped to a regression guard (asserts ZERO collisions
    over the adversarial set + 2000 random pairs).

Tests promoted: tests/unit/independent/transaction-stream.ivv.test.ts (52 tests,
strict-TS clean, prettier + eslint clean). Now runs in the permanent suite forever.

Final suite: **pnpm verify GREEN — 1186 tests** (was 1133; +52 promoted IV&V + the
net same-day test), build OK, deployable.

Honest residual (what independence could NOT cover):
  • Shared-spec blind spot (Knight & Leveson): the VE's reference model and the DUT
    both read this contract; a contract that misstated FIFO semantics could yield
    correlated agreement. Mitigated by oracle-free checks (conservation INV1/INV2,
    metamorphic permutation/scale, hand-computed goldens) — which is exactly what
    caught the §5.1 contract typo.
  • cardKeyString exact string format is unspecified by design — the VE verifies the
    injectivity PROPERTY, not a literal string, so a format change that preserves
    injectivity is (correctly) invisible.
  • Multi-currency mixed streams are out of scope (the module ignores `currency`);
    a real mixed-currency card would not be caught here.
  • ~35 equivalent mutants left unchased to preserve independence (not reading source
    to decide equivalence beyond mutation-operator + contract-surface reasoning).

FOLLOW-UP (logged, NOT fixed in this run): the same `::`-separator collision
bug-class has a SIBLING in src/lib/app/transaction-view.ts (the account-key helpers,
~lines 90 & 226–227, a 3-part `bank::type::last4` key). That is a separate P0 module
whose key format is part of its filter contract (the /transactions filter + its tests
construct literal `'BankA::credit_card::1111'` keys), so migrating it is a larger,
separately-verified change. Tracked in DECISIONS D20 + BLOCKERS as a follow-up IV&V
target — not changed unattended tonight because it would require updating the filter
UI + hardcoded test keys and re-verifying transaction-view.
