=== IV&V REPORT — split distribution in summaryFromImports (US-SPLIT) (2026-05-26) ===

Module: src/lib/app/categorization-glue.ts (the NEW split-distribution behavior in summaryFromImports)
Contract: specs/001-money-tracker-mvp/verification/split-distribution.contract.md
VE: verification-engineer subagent (fresh context, agent a63ffe2a), PLAN+EXECUTE, full run.

Independence audit: VE read only the two contracts (split + refund, for the remainder-category
  composition allowed by §7), the TYPES (categorization.ts, store.ts, spending-summary.ts,
  adapters/types.ts), the spec docs, the framework, and config. categorization-glue.ts body NEVER
  opened; only the Designer test's import LINE confirmed via grep (not its body). → CLEAN.

Verification plan: R1–R5 + INV1–INV4 + error contract + 12 §6 edges → 24 cover points; traceability 100%.

Environment: constrained-random generator (signed bigint amounts ±$500 + ±1e18 adversarial; splits ∈
  {undefined | [] | 1–5 signed parts incl. 0n + null-category}; ignored; refund_of; phantom/dangling
  keys) + independent from-contract reference model + scoreboard (>1000 comparisons over 1500 random
  stim, clean) + 14 hand-computed golden row-sets + INV1 grand-total & per-txn conservation (1800) +
  INV2 row-count (1000) + INV3 determinism+purity (1000, deep-freeze) + INV4 part-fidelity/date (800) +
  3 metamorphic relations (concatenation, sign-flip, ignore-removal).

Functional coverage: 100.0% (24/24). Holes: none.

Fault injection: 49/49 COVERED mutants KILLED = 100% of the in-scope surface (whole-file 65.33% only
  because 26 NoCoverage mutants live in resolveEffectiveCategory's standalone export +
  detailedRowsFromImports — both explicitly out of scope per §7, verified separately). Killing the last
  guard mutants required decoy annotations at keys "" and "undefined". Reference-model self-mutation
  (off-by-one remainder): scoreboard flagged it → bench has teeth.

Discrepancies: NONE. The DUT matched the reference model on >5100 stimuli + all 14 goldens, including
  the load-bearing sign convention: over-split yields an OPPOSITE-SIGN remainder (e.g. −100 split into
  −60+−70 → rows −60,−70,+30 summing to −100) — CORRECT per §11, not a bug. Conservation (INV1) holds
  for unsplit / exact / partial / over-split / refund+split; ignored txns emit zero rows even when split.

Spec ambiguities: NONE found (the contract pinned every boundary). One observation (not an ambiguity):
  the contract is silent on a split part using a different sign than the parent; the DUT emits parts
  verbatim so conservation still holds by construction — the only defensible reading.

Tests promoted: tests/unit/independent/split-distribution.ivv.test.ts (32 tests; import depth fixed;
  one dead metamorphic-helper var + stray eslint-disable removed; prettier+eslint clean).

Final suite: pnpm verify GREEN (1124 tests).

Honest residual (per VE): shared-spec blind spot (mitigated by oracle-free conservation/row-count/
  metamorphic checks + externally-reasoned goldens — these hold for ANY conserving aggregator); the
  out-of-scope §7 surfaces (resolveEffectiveCategory standalone, detailedRowsFromImports) not assessed
  here (refund-resolution covers them); the split-editor UI that AUTHORS splits + cross-device sync of
  split[] not verified (out of scope / deferred); single-currency precondition assumed (upstream).

Decision: ACCEPTED. The split distribution in summaryFromImports is the verification-of-record for US-SPLIT.
