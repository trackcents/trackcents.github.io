=== IV&V REPORT — reconciliation (2026-05-26) ===

Module: src/lib/app/reconciliation.ts — the bank-payment ↔ credit-card-statement
matcher. Risk tier: **P0 — money truth** (the "which card did my $X payment land
on?" half of US-P1-D; the FIFO "which purchases" half is transaction-stream.ts,
signed off separately the same night). Public entry points: reconcileImports,
findLinkForBankTxn. Collaborator (trusted oracle, not under verification this run):
src/lib/util/card-payment.ts (detectCardPayment, bankNameMatchesIssuer).

Why now: the second of the two P0 cores implementing the user's signature feature
that had never been independently verified (had designer tests only). This run +
the transaction-stream run together close independent verification of the entire
US-P1-D drill-down pipeline.

Independence audit: VE read only [contract, its own vplan, spec.md (US-P1-D/SC-004),
research §R12, data-model.md, constitution.md, tests/_framework/*, the PUBLIC TYPE
surface of src/lib/adapters/types.ts + card-payment.ts lines 1–45 (type/signature
only, NO function bodies/regex tables), an UNRELATED promoted ivv test for
import-convention only, and config files]. It did NOT read reconciliation.ts (the
DUT), the body of card-payment.ts, any other src/** body, or any tests/unit/**
Designer test. Honest disclosure: Stryker's survivor report printed 4 mutated
source lines (an unavoidable tool artifact); the VE reasoned about those mutants
behaviorally without opening the file. **CLEAN.**

Verification plan: R1–R11 (11) + INV1–INV7 (7) + error contract + domain edges →
49 cover points; traceability **100%**.

Environment: constrained-random ImportedStatement[] generators (non-CC bank imports
of every non-credit_card type with recognized/unrecognized/no-last-4 payment rows +
noise; CC imports across 5 issuers with 4-digit/3-digit/null last-4; period_end
straddling the ±30-day boundary) + an INDEPENDENT from-spec reference matcher
(refReconcile, own epoch-day window oracle + row-level ambiguity counting) + a
scoreboard (1500 clean DUT-vs-model comparisons) + INV1–INV7 inline assertions +
3 oracle-free metamorphic relations (permutation/INV6, irrelevant-CC-insert,
amount-sign-flip) + hand-computed goldens (R8 confidence, R9 fields, the canonical
US-P1-D case) + a directed INV5 ambiguity hunt + an independent date-window oracle
(±30/±31 both sides, month/year/leap-day crossings).

Functional coverage: **100.0% closure (49/49)** — no holes.

Fault injection: mutation score **96.67%** (85 killed + 2 timeout / 90; 3 survived)
on reconciliation.ts — well above the P0 floor of 80. The 3 survivors are EQUIVALENT
(a `< 0n`→`<= 0n` in abs() that is identical at 0n; two date-slice→parseInt mutants
unkillable because §8 guarantees well-formed ISO dates, putting malformed dates out
of domain). Reference-model self-mutation correctly failed the scoreboard → bench has
teeth.

Discrepancies: **1** (CONFIRMED P0 BUG, fixed).

  • D22 (CONFIRMED BUG — P0 anti-false-positive / INV5 violation, fixed):
    reconcileImports used `findIndex` to locate a matching CC payment row per
    statement, which returns only the FIRST match. So when ONE credit-card statement
    contained two `payment_to_card` rows of the matched amount, they collapsed to a
    single statement-level match — `matches.length === 1` — and the matcher emitted
    a link to row 0 instead of recognizing the ambiguity and staying silent.
    Minimal repro: a Chase checking "Payment To Chase Card Ending IN 1797" −$800,
    and a Chase CC statement (last-4 1797, period_end in window) carrying TWO +$800
    payment_to_card rows → expected 0 links (R7/INV5/A3: 2 distinct rows = ambiguous
    = never guess), actual 1 link to the first row. The across-statements ambiguity
    case was already handled correctly, which is why example tests missed the
    in-statement case. A real cardholder can make two equal payments in a cycle, so
    the drill-down could silently point at the wrong row. **Designer ruling: CONFIRMED
    BUG** (spec-mandated, not a judgment call — R7's match tuple is (cc_import,
    cc_payment_row), INV5 says "distinct CC payment ROWS", and A3 was resolved
    row-level at the plan gate). **Fix:** collect EVERY matching row (forEach, not
    findIndex) so ambiguity is counted at the row level; 2+ matching rows (in one
    statement or across statements) now correctly yield NO auto-link. The VE's
    failing "two matching CC rows in one statement → ZERO links" assertion is now the
    permanent regression guard. pnpm verify GREEN (1215). No designer test regressed
    (single-match cases still link).

Tests promoted: tests/unit/independent/reconciliation.ivv.test.ts (29 tests,
strict-TS clean, prettier + eslint clean). Runs in the permanent suite forever.

Final suite: **pnpm verify GREEN — 1215 tests** (was 1186; +29 promoted IV&V), build
OK, deployable.

Spec/doc note (NOT a bug — for morning, DECISIONS D21): spec FR-031 + US-P1-D +
data-model `reconciliation_date_window_days DEFAULT 10` + research §R12 still say
±10 days of the DUE DATE (configurable); the code uses a hardcoded ±30 days of
period_end (a documented deferral — due-date isn't reliably extracted yet). Verified
the ±30/period_end behavior per the contract; the spec/data-model text should be
reconciled to match (or due-date extraction scheduled). A product decision — left
to the human.

Honest residual (what independence could NOT cover):
  • Shared-spec blind spot (Knight & Leveson): the reference model and DUT both
    descend from this contract. D22 was caught because the model DISAGREED + the
    oracle-free directed/characterization probes don't depend on the model; a
    correlated misreading of R7/INV5 in both could still hide. Mitigated by
    hand-computed goldens + the independent epoch-day oracle + 3 metamorphic relations.
  • Currency-blind matching (A8): R6 matches amount_minor only; a future multi-
    currency world (P3) could mis-match 800.00 CAD to 800.00 USD. Out of scope per
    the USD-only v1 assumption — not generated as a failing case.
  • Malformed dates / last-4 not fuzzed (§8 guarantees well-formed input from
    adapters upstream); the 2 equivalent date-parse mutants are unkillable for that
    reason. Re-open if adapter guarantees weaken.
  • card-payment.ts collaborator treated as a trusted oracle — its regexes/alias
    table are a separate future IV&V run; a bug there would propagate here undetected.
