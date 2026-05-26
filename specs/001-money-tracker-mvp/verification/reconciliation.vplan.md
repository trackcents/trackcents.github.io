# Verification Plan (PLAN pass) — reconciliation (bank-payment ↔ credit-card-statement matcher)

> Produced by the independent **verification-engineer** in **PLAN mode** from the
> verification contract + cited spec ALONE. The implementation source
> (`src/lib/app/reconciliation.ts`) and the collaborator source
> (`src/lib/util/card-payment.ts`) and the Designer's tests were **NOT** read.
> This is the cheap plan-gate pass: verification plan + functional cover points +
> requirements traceability + the spec-ambiguity list. No stimulus / scoreboard /
> coverage model / mutation was built or run. Every "black-box behavior" note below
> is a **thought-experiment derived from the contract's worked examples and stated
> rules**, NOT an actual code execution (PLAN mode forbids running the DUT).

---

## 0. Files I read (independence audit)

- `specs/001-money-tracker-mvp/verification/reconciliation.contract.md` (primary — the only engineering artifact)
- `specs/001-money-tracker-mvp/spec.md` (US-P1-D / SC-004, FR-030..FR-035, edge cases, accuracy posture)
- `specs/001-money-tracker-mvp/research.md` (§R12 matching algorithm; §R13 only for context)
- `specs/001-money-tracker-mvp/data-model.md` (`transaction_type` / `account_type` enums, signed-cents convention, `reconciliation_links` constraints, `reconciliation_date_window_days`)
- `.specify/memory/constitution.md` (Principle II — integer cents, accuracy non-negotiable; anti-false-positive posture)
- `tests/_framework/scoreboard.ts`, `tests/_framework/coverage-model.ts` (test infra I will reuse in EXECUTE)
- `specs/001-money-tracker-mvp/verification/transaction-stream.vplan.md` (sibling vplan — read for repo plan FORMAT/conventions only; it is a different module)

**NOT read** (independence preserved): `src/lib/app/reconciliation.ts`, `src/lib/util/card-payment.ts`,
any other `src/**` body, any `tests/unit/**` (Designer tests). No implementation body appears above.

---

## 1. Verification plan — lenses for the EXECUTE pass

The DUT is a **pure, deterministic, P0 money-truth** function over an in-memory `ImportedStatement[]`.
Two public entry points: `reconcileImports` (the matcher) and `findLinkForBankTxn` (a lookup).
The headline safety property is **INV5** — never emit a link when 2+ CC rows match (silence over a guess).
A wrong link points the drill-down at the wrong card, which the spec treats as worse than no link.

### 1.1 Independent reference model + scoreboard (`tests/_framework/scoreboard.ts`)
I will write a **second, from-spec implementation** of `reconcileImports` — derived only
from R1–R11 + INV1–INV7, never from the DUT — and wire `Scoreboard{dut, model}`.
The model judges the FULL link set (all fields). To respect the Knight & Leveson oracle
caveat (model + DUT share the spec, so both can be wrong the same way), the scoreboard
is NOT my only oracle: it is paired with oracle-free metamorphic checks (§1.3),
hand-computed golden vectors (§1.4), and an **independent date-window oracle** (§1.5).

The collaborators `detectCardPayment` / `bankNameMatchesIssuer` are treated as **trusted
deterministic oracles** (contract §3b). My reference model calls the SAME real collaborator
functions the DUT does, so collaborator behavior is held constant across both sides of the
scoreboard and cannot create a spurious mismatch. (I import only their public exports; I do
not read their source.)

bigint discipline: `matched_amount_minor` is `bigint`; the scoreboard's `deepEqual`/`stringify`
are already bigint-aware. All amount assertions are on `bigint`, never `Number()`-roundtripped.

### 1.2 Property-based (fast-check) — invariants INV1–INV5, INV7 hold for ALL valid inputs
Constrained-random generators (the "sequencer") produce **legal** `ImportedStatement[]`. Every
generated run asserts each applicable invariant INLINE (self-checking at property level) and also
feeds the scoreboard. Generators:
- a `ParsedTransaction` arbitrary parameterized by `transaction_type` (must include `payment_to_card`
  AND a spread of non-`payment_to_card` types), sign (+/−, to exercise the absolute-value rule R6),
  magnitude (incl. amounts > 2^53 cents via `fc.bigInt`, since money is bigint), and `posted_date`
  drawn from BOTH a tight pool (to force same-amount/same-window collisions → ambiguity) and a wide
  pool (to exercise window in/out);
- a `ParsedStatement` arbitrary whose `account_type` spans the full enum (must include `credit_card`
  AND non-`credit_card` types) and whose `account_last_4` includes 4-digit, <4-digit (padding), and
  `null` values; `period_end` drawn to land bank dates on/around the ±30 boundary;
- an `ImportedStatement` arbitrary whose `bank_name` is drawn from a pool that exercises the issuer-
  alias substring matcher (e.g. `"Bank of America"`, `"BoA"`, `"JPMorgan Chase"`, `"Discover"`, a
  non-matching name), and whose `description`s are drawn from the §3b recognized-descriptor pool
  plus unrecognized strings (R2);
- an `imports[]` arbitrary mixing multiple banks / multiple CC statements / same issuer+last-4 across
  statements (to manufacture ambiguity configs) and multiple distinct bank payments per import (R1 loop).

### 1.3 Metamorphic relations (oracle-free — highest value)
- **MR-permute (INV6, the headline metamorphic check):** permuting `imports[]` MUST NOT change the
  SET of *logical* links — each link re-identified by provenance tuples
  (`bank_name` + bank row's `(description, amount_minor, posted_date)`) ↔ (cc `bank_name` + cc row's
  `(amount_minor, posted_date)` + cc `period_end` + cc `account_last_4`), NOT by the numeric
  `*_index` fields (which the permutation relabels). This is the oracle-INDEPENDENT catch for
  position-dependent bugs (the D13/D19 bug family flagged in contract §11). Validity domain: the
  provenance tuple must be unique enough to re-identify a row after relabeling; I will generate rows
  with distinct provenance (or carry a hidden unique tag) so the relation is sound.
- **MR-determinism (INV7):** calling `reconcileImports` twice on the same input yields deeply-equal
  output incl. ordering (also covers R11 purity — input not mutated).
- **MR-irrelevant-CC-insert:** adding a CC import that matches NO issuer/last-4/amount/window of any
  bank payment MUST NOT change the existing logical link set (and MUST NOT, by itself, turn a unique
  match ambiguous). Conversely, inserting a SECOND genuinely-matching CC row MUST collapse a former
  unique link to NO link (INV5) — the negative direction of the same relation.
- **MR-amount-sign-flip:** flipping the sign of a bank `payment_to_card` amount (−80000 ↔ +80000)
  and/or the matched CC row's sign MUST NOT change the link (R6 matches on absolute value). Validity
  domain: only sign flips, magnitude unchanged — exact in integer/bigint, no float hazard.
- **MR-window-symmetry:** if a bank date `D` at offset `+k` days from `period_end` produces a link,
  then the mirror date at offset `−k` (all else equal) produces the same link for k ≤ 30, and neither
  does for k = 31. (Tests the symmetry claim in §6/§11.)

  *MR soundness guard*: all the above MRs are exact (set membership, determinism, integer sign flip,
  symmetric integer day offsets) — no floating-point shift/scale, so no out-of-domain false-positive
  hazard of the kind the charter's variance-MR warning describes. Before trusting any MR I will first
  confirm it PASSES on my own reference model (known-good) so a failure indicts the DUT, not the relation.

### 1.4 Hand-computed golden vectors (externally-derived truth)
A small table of fully hand-worked cases with the arithmetic shown in comments, including the §3b
worked descriptors mapped to expected links: e.g. `"Payment To Chase Card Ending IN 1797"` for −$800.00
(`-80000n`) vs a Chase CC statement with `account_last_4='1797'`, a `+80000n` `payment_to_card` CC row,
`period_end` 12 days after the bank date ⇒ exactly one link, `confidence_score=1.0`,
`matched_amount_minor=80000n`. And a no-last-4 case (`"Bk of Amer Visa Online Pmt"`) matched by
issuer+amount+date ⇒ `confidence_score=0.85`. These pin R8/R9 to concrete values, independent of the model.

### 1.5 Independent date-window oracle (contract §11 oracle hazard)
The ±30-day boundary is computed by an **independent epoch-day differencing** method
(`Date.UTC(y,m-1,d)/86400000` → integer day index, then `Math.abs(dayBank − dayPeriodEnd) <= 30`),
NOT by mirroring any suspected implementation. I will exercise month crossings, year crossings, and
leap-day crossings (e.g. period_end `2024-02-29`; bank date 30/31 days either side, across Feb→Mar and
Dec→Jan). This oracle is used both inside the reference model and as a standalone assertion on goldens.

### 1.6 Adversarial / fault-injection (Phase E)
- **Ambiguity hunt (INV5):** construct the highest-value safety inputs — 2+ valid CC matches across one
  and across multiple statements — and assert ZERO links emitted. A matcher that "helpfully" picks one
  passes naive example tests but violates the spec; hunt this hard.
- **Mutation testing** (`stryker`) on the DUT, per CLAUDE.md P0 floor (mutation ≥ 80). Surviving mutants
  → strengthen checks or justify individually.
- **Reference-model self-mutation:** deliberately corrupt my own model (off-by-one in the window;
  `<=30` → `<30`; pick-first instead of return-none on ambiguity) and confirm the scoreboard FAILS,
  proving the bench has teeth. Revert.

### 1.7 Totality / error contract (§8)
Property: `reconcileImports` NEVER throws for any well-shaped `ImportedStatement[]` (incl. `[]`, no CC
imports, no bank imports, no matches, mixed types, bigint amounts, null last_4). `findLinkForBankTxn`
returns `undefined` (never throws) on a miss. No conservation-of-money law applies here in the
double-entry sense (this module identifies WHICH statement, it does not move money), but INV2 is the
local conservation analogue: `matched_amount_minor === |bank amt| === |cc amt|` and always `> 0n`.

---

## 2. Functional cover points (the coverage model for EXECUTE)

The §6 edge list is the FLOOR. Cover points (each `cov.cover(...)`-instrumented; `assertClosed()` gates):

**Origination / filtering (R1–R3)**
- `origin.bank-payment-row` — a non-CC import `payment_to_card` row originates a candidate
- `origin.rejected.cc-import-row` — a `payment_to_card` row that sits ON a credit_card import → never originates
- `origin.rejected.non-payment-type` — every non-`payment_to_card` `transaction_type` on a bank import → no link (loop over enum)
- `detect.unrecognized-descriptor` — `detectCardPayment` returns null → no link (R2)
- `issuer.alias-substring-match` — `"Bank of America"` vs `'BofA'`, `"JPMorgan Chase"` vs `'Chase'`
- `issuer.alias-no-match` — bank_name not an alias of the detected issuer → candidate rejected (R3)

**Last-4 gate (R4)**
- `last4.present-exact-match` — descriptor `'1797'` vs CC `'1797'`
- `last4.padding.cc-shorter` — descriptor `'0562'` vs CC stored `'562'` → pad CC to `'0562'` → match
- `last4.padding.descriptor-padded` — collaborator already left-pads 3-digit capture to `'0562'`; confirm consistent
- `last4.mismatch` — descriptor `'1797'` vs CC `'4321'` → reject
- `last4.cc-null-descriptor-has-last4` — CC `account_last_4 = null`, descriptor carried last-4 → cannot satisfy R4 → reject (§6)
- `last4.absent-in-descriptor` — descriptor carried NO last-4 → gate skipped, rely on issuer+amount+date (R4 second clause)

**Date window (R5) — month/year/leap crossings**
- `window.within` — |Δ| < 30
- `window.boundary.30-kept` — |Δ| === 30 → kept
- `window.boundary.31-rejected` — |Δ| === 31 → rejected
- `window.before-period-end` — bank date earlier than period_end (negative offset)
- `window.after-period-end` — bank date later than period_end (positive offset)
- `window.cross-month` — boundary crosses a month edge
- `window.cross-year` — boundary crosses Dec→Jan
- `window.cross-leap-day` — period_end near Feb-29 of a leap year; boundary spans 29 Feb

**Amount match (R6)**
- `amount.exact-cent-match` — |bank| === |cc| to the cent
- `amount.off-by-one-cent-no-match` — differs by 1 cent → no match
- `amount.sign.bank-neg-cc-pos` — canonical signs, absolute match
- `amount.sign.bank-pos-or-cc-neg` — guarded inverted signs still match on absolute value
- `amount.bigint-large` — magnitude > 2^53 cents → still exact

**Cardinality / ambiguity (R7, INV5)**
- `cardinality.exactly-one` → one auto-link
- `cardinality.zero` → no link
- `cardinality.ambiguous.same-statement-2-rows` — 2 matching CC rows in ONE statement → no link
- `cardinality.ambiguous.across-statements` — 2 CC statements each with a matching row → no link
- `cardinality.disambiguated-by-window` — 2 same-issuer statements, only one in window → link to that one
- `cardinality.disambiguated-by-issuer` — same amount to TWO different issuers' cards → two separate links (NOT ambiguous)
- `cardinality.disambiguated-by-last4` — same issuer+amount+window, different last-4, descriptor pins one → one link

**Confidence (R8)**
- `confidence.1.0-with-last4`
- `confidence.0.85-without-last4`
- `confidence.lower-without-than-with` (the §7-robust property: no-last-4 < explicit-last-4)

**Link fields / lookup (R9, R10)**
- `link.fields-populated` — all index/type/amount/date fields correct on an emitted link
- `link.matched-date-is-bank-posted-date`
- `findlink.hit`, `findlink.miss-returns-undefined`

**Structure / invariants**
- `inv.at-most-one-link-per-bank-row` (INV4)
- `inv.bank-side-non-cc`, `inv.cc-side-is-cc` (INV3)
- `inv.permute-stable` (INV6) — exercised by MR-permute
- `inv.determinism` (INV7)

**Degenerate / totality (§6, §8)**
- `edge.empty-imports` → `[]`
- `edge.no-cc-imports` → no links
- `edge.no-bank-imports` → no links
- `edge.cc-payment-no-matching-bank` → CC exists, no link (links originate bank-side only)
- `edge.multiple-bank-payments-one-import` — each evaluated independently (R1 loop)

---

## 3. Requirements → cover-point traceability (100% — every R# / INV# mapped)

| Req | Cover point(s) / check | Lens |
|---|---|---|
| **R1** only bank `payment_to_card` originates | `origin.bank-payment-row`, `origin.rejected.cc-import-row`, `origin.rejected.non-payment-type`, `edge.multiple-bank-payments-one-import` | property + directed |
| **R2** unrecognized descriptor ⇒ no link | `detect.unrecognized-descriptor` | directed + property |
| **R3** issuer-alias candidate filter | `issuer.alias-substring-match`, `issuer.alias-no-match` | directed (real collaborator) |
| **R4** last-4 gate + padding + null | `last4.*` (6 bins) | directed + golden |
| **R5** ±30-day inclusive window | `window.*` (8 bins) | independent date oracle + MR-window-symmetry |
| **R6** amount match to the cent (absolute) | `amount.*` (5 bins) | property + MR-amount-sign-flip |
| **R7** exactly-one ⇒ link; 0/many ⇒ none | `cardinality.*` (7 bins) | directed + property + scoreboard |
| **R8** confidence 1.0 vs 0.85 | `confidence.*` (3 bins) | golden + property (lower-without-than-with) |
| **R9** link field population | `link.fields-populated`, `link.matched-date-is-bank-posted-date` | golden + scoreboard |
| **R10** `findLinkForBankTxn` lookup | `findlink.hit`, `findlink.miss-returns-undefined` | directed + property |
| **R11** purity | MR-determinism + input-not-mutated assertion | metamorphic |
| **INV1** index validity | inline assertion every emitted link | property |
| **INV2** amount agreement, `>0n` | inline assertion (local conservation) | property |
| **INV3** side typing | `inv.bank-side-non-cc`, `inv.cc-side-is-cc` | property |
| **INV4** ≤1 link per bank row | `inv.at-most-one-link-per-bank-row` | property |
| **INV5** anti-false-positive (headline) | `cardinality.ambiguous.*`, MR-irrelevant-CC-insert (negative dir) | adversarial + property |
| **INV6** reorder stability | `inv.permute-stable` / MR-permute | metamorphic (oracle-free) |
| **INV7** determinism | `inv.determinism` / MR-determinism | metamorphic |

No requirement is left without ≥1 cover point and ≥1 check ⇒ **traceability 100%** at plan time.

---

## 4. Spec-ambiguity list (the key PLAN output)

Each item: exact quote + location, the defensible readings, and the behavior I would EXPECT
from the contract's stated rules/examples (reasoned, not run). Severity: **BLOCKER** = must be
resolved before EXECUTE; **MINOR** = I can proceed with the stated assumption, flag if DUT differs;
**NON-ISSUE** = enumerated and found unambiguous (recorded for audit completeness).

---

### A1 — [MINOR] Window unit: calendar-day count vs millisecond/24h-period, and the role of `posted_date` having no time component
**Quote:** "the bank row's `posted_date` is within **±30 days inclusive** of the candidate CC statement's `period_end`. 30 days exactly = kept; 31 days = rejected." (contract §4 R5); "Dates are assumed well-formed ISO `YYYY-MM-DD`" (§8).
**Readings:** (a) `|epochDay(posted) − epochDay(period_end)| <= 30` where epochDay is the integer date index (calendar-day count, DST-immune). (b) a millisecond/`(b−a)/86400000` difference, which is identical here because both are pure `YYYY-MM-DD` dates at UTC midnight.
**Expected:** Both readings coincide exactly because there is no time-of-day component — reading (a) is what §11 explicitly recommends ("epoch-day differencing"). I will use (a). **No genuine ambiguity; recorded so the EXECUTE oracle choice is auditable.** I do NOT plan to escalate this.

---

### A2 — [NON-ISSUE] Ambiguity rule scope: 2+ matches across multiple statements as well as within one
**Quote:** "Collect all `(cc_import, cc_payment_row)` matches **across all candidates**. … If two or more ⇒ **no link**." (§4 R7); "Two CC statements, same issuer, same last-4, both within the window, both having a row of the matched amount ⇒ **ambiguous ⇒ no link**." (§6).
**Readings:** (a) ambiguity counts matches across ALL candidate CC imports AND multiple rows within one import. (b) ambiguity only within a single statement.
**Expected:** Reading (a) — R7 says "across all candidates" and §6's worked example is explicitly two SEPARATE statements. **Unambiguous; (b) is not defensible against the §6 example.** No escalation.

---

### A3 — [MINOR→clarify] Counting unit of "two or more matches": distinct CC *rows* vs distinct CC *statements*
**Quote:** "Collect all `(cc_import, cc_payment_row)` matches across all candidates. If exactly one ⇒ … If two or more ⇒ no link." (§4 R7); INV5: "two or more distinct CC payment **rows** match a single bank payment." (§5)
**Readings:** (a) the count is over distinct `(cc_import_index, cc_transaction_index)` tuples — so even two matching rows *within the same statement* is ambiguous. (b) the count is over distinct CC *statements*, so two rows in ONE statement might be treated as a single statement-level match.
**Expected:** Reading (a). R7's tuple is `(cc_import, cc_payment_row)` (row-level) and INV5 says "distinct CC payment **rows**." So a single CC statement that happens to contain TWO `payment_to_card` rows of the matched amount within the window ⇒ **2 matches ⇒ no link**. The `cardinality.ambiguous.same-statement-2-rows` cover point pins this. **I will verify reading (a).** Worth a one-line confirm from the Designer because it is the kind of thing an implementation could get wrong by de-duplicating on statement id; flagging as a CONFIRM-INTENT item, not a blocker.

---

### A4 — [MINOR→clarify] Does the bank ORIGINATING row also have to pass `detectCardPayment` AND be the right side, when a `payment_to_card` row appears on a CC import whose own description is a recognized payment descriptor?
**Quote:** "A row originates a candidate link iff its import's `statement.account_type` is **not** `credit_card` AND its `transaction_type` is `payment_to_card`." (§4 R1); "Rows on credit-card imports … never originate links."
**Readings:** unambiguous on its face — origination requires (non-CC import) AND (`payment_to_card` type). (Edge worth probing: a `savings`/`loan`/`cash`/`other` account_type bank row that is `payment_to_card` — R1 says "not credit_card", so ALL non-CC types originate, including `loan`/`cash`/`other`.)
**Expected:** A `payment_to_card` row on a `loan` or `cash` or `other` import DOES originate a candidate (only `credit_card` is excluded). I will generate non-CC types beyond just `checking`/`savings` to confirm the matcher does not silently restrict origination to checking/savings only. **Verify; flag if DUT narrows it.** Not a blocker — R1 is explicit ("not credit_card").

---

### A5 — [MINOR] Last-4 normalization: which side is padded, and behavior for last-4 of length ≠ 3/4 or non-numeric
**Quote:** "a candidate CC import must have `statement.account_last_4` (**left-padded to 4 chars**) equal to it" (§4 R4); §6: "descriptor `"...0562"`, CC last-4 `"562"`: the padding rule (R4) must make `'0562'` match `'562'→'0562'`." §11 calls this an "easy off-by-one oracle."
**Readings:** (a) ONLY the CC `account_last_4` is left-padded to 4; the descriptor's `card_last_4` is already 4 chars (collaborator §3b left-pads its 3-digit capture). Compare the two 4-char strings. (b) both sides padded (harmless if descriptor is already 4). (c) what about a CC `account_last_4` of length 5+, or `'56'` (2 chars → `'0056'`), or containing letters?
**Expected:** (a) — pad CC to 4 with leading zeros, compare to the (already-4-char) descriptor last-4. For length 2 → `'0056'` (left-pad). Length-5+ / non-numeric last-4 is **not exercised by any stated example** and is arguably out of domain (adapters guarantee a real last-4). I will generate the `'562'`→`'0562'` and `'56'`→`'0056'` cases as goldens; I will NOT fuzz non-numeric/over-length last-4 as a "bug" unless the Designer says it's in-domain. **Confirm padding is left-pad-CC-side only; treat malformed last-4 as out of domain.** Recorded as a thing the EXECUTE pass should not over-reach on.

---

### A6 — [MINOR→clarify] Output ordering / tie-break of the emitted `ReconciliationLink[]` (INV7 says deterministic — but deterministic in WHICH order?)
**Quote:** "**INV7 — Determinism.** Same input ⇒ deeply-equal output, **including link ordering**." (§5); "INV6 … Permuting the `imports` array MUST NOT change the SET of logical links … even though the numeric `*_index` fields are relabeled." (§5)
**Readings:** (a) the emitted array is ordered by some stable rule (e.g. ascending `bank_import_index` then `bank_transaction_index` — i.e. the natural origination-loop order). (b) ordering is unspecified beyond "stable for a fixed input ordering."
**Expected:** INV7 pins determinism for a FIXED input order, and INV6 says the link SET is permutation-invariant (the *set*, not the *sequence*). So under permutation the array ORDER may legitimately change (indices relabel) — my MR-permute therefore compares SETS of logical links, never array position, and my MR-determinism compares the full array (order included) only for the SAME input. **Tension to confirm:** does the contract intend a canonical sort of the output array independent of input order? Nothing states one. I will NOT assert a particular output order across permutations (that would be an unsound MR — see §1.3 soundness guard); I WILL assert exact-array equality only on repeated identical input. **CONFIRM-INTENT:** is output array order defined to follow origination-loop order (bank import index, then bank tx index)? If yes I can add a stronger directed assertion; if the contract is silent I leave it as set-equality only. Low risk either way.

---

### A7 — [NON-ISSUE / accept-as-scoped] The ±30-days-of-`period_end` generalization vs US-P1-D's "±10 days" and "new balance"
**Quote (contract §7, OUT OF SCOPE):** "research §R12 originally framed it as ±10 days of the due-date; the module deliberately generalizes to **±30 days of `period_end`** … Verify the ±30/`period_end` behavior as specified in R5; do not flag 'spec said ±10/due-date'." Conflicting upstream text: spec FR-031 "within a configured date tolerance (default ±10 days)"; US-P1-D AS#1 "±10 days"; data-model `reconciliation_date_window_days INTEGER NOT NULL DEFAULT 10`; research §R12 step 3 "±10 days of the … due-date or post-period-end."
**Readings:** (a) follow the contract: window is ±30 of `period_end`, fixed (not the `reconciliation_date_window_days=10` setting). (b) honor the spec/data-model ±10 and the configurable setting.
**Decision:** **I ACCEPT the contract's §7 framing as the authoritative scope for THIS run and will verify ±30/`period_end` per R5.** Rationale: (i) §7 is an explicit, documented design decision with a stated reason (`payment_due_date` not always extracted yet); (ii) the contract is the engineering artifact I verify against; (iii) the generalization does NOT contradict US-P1-D's *outcome* (a 1-click drill to the matching statement) — it only widens the tolerance and swaps the anchor date, which still satisfies SC-004. **HOWEVER** I am flagging it for the architect's awareness, NOT as a bug, because there is a real **latent inconsistency**: the spec, the data-model schema column, and research §R12 all still say ±10/due-date/configurable, while the code uses a hardcoded ±30/period_end. Per contract §2 ("If this contract and a spec doc disagree, the **spec wins** and that disagreement is a finding"), this contract-vs-spec disagreement is technically a finding I must surface — but §7 pre-empts it as a deliberate, accepted deferral. **Recommendation:** the human should reconcile the spec/data-model text to match the implemented ±30/period_end (or schedule the due-date extraction), so the documents stop disagreeing. **No EXECUTE behavior depends on this; I will not challenge ±30/period_end.**

---

### A8 — [MINOR] "Amount match to the cent" with currency: must bank and CC rows share `currency` to match?
**Quote:** "a match requires a CC-side `payment_to_card` row whose **absolute** `amount_minor` equals the bank row's absolute `amount_minor` exactly." (§4 R6). `ParsedTransaction` carries `currency` (§3a). Spec assumes home currency USD (Assumptions).
**Readings:** (a) match on `amount_minor` only; `currency` is ignored (a USD-only world per the spec assumptions; a CAD 80000 minor would spuriously match a USD 80000 minor, but that's out of v1 scope). (b) require `currency` equality as well.
**Expected:** R6 mentions ONLY `amount_minor`, not currency. I will verify reading (a) — currency is NOT part of the match key. **Flag as a known residual:** if multi-currency ever lands (P3), an 800.00 CAD CC payment could mis-match an 800.00 USD bank payment. Out of scope for v1 per the spec's USD-only assumption; I record it as a residual, not a bug, and will NOT generate cross-currency stimulus as a failing case. Worth one line to the architect that R6 is currency-blind by design.

---

### A9 — [NON-ISSUE] CC side must also be a `payment_to_card` row, not just any amount-matching row
**Quote:** "a match requires a **CC-side `payment_to_card` row** whose absolute `amount_minor` equals …" (§4 R6); INV3 "the cc side is always a `credit_card` import."
**Readings:** unambiguous — the matched CC row must itself be `transaction_type === 'payment_to_card'` (a purchase/fee/interest row of the same amount must NOT match).
**Expected:** A CC `purchase` of 80000 must NOT match; only a CC `payment_to_card` of 80000 (the payment that reduced the balance). I will add a directed case: CC statement has a `purchase` of the matched amount but NO `payment_to_card` of it ⇒ no link. Cover point `amount.exact-cent-match` is constrained to `payment_to_card` CC rows. **Unambiguous; recorded.**

---

### A10 — [MINOR] `confidence_score = 0.85` exact value
**Quote:** "`confidence_score = 1.0` when the descriptor carried an explicit `card_last_4`; `0.85` when matched by issuer + amount + date only." (§4 R8); §7: "The exact 0.85 number … verify only that no-last-4 matches are scored lower than explicit-last-4 matches (1.0); the specific 0.85 is a Designer constant, not spec-pinned."
**Decision:** Per §7 I will NOT pin 0.85 as a hard golden in a way that fails on a different constant; the verified property is `score(no-last-4) < score(with-last-4)` AND `score(with-last-4) === 1.0`. I will additionally record the observed no-last-4 value and note it, but the GATE assertion is the ordering, not the literal 0.85. **Accepted as scoped; no escalation.**

---

### A11 — [NON-ISSUE] `cc_transaction_index` can be `null` on an emitted link — when?
**Quote:** Interface: `cc_transaction_index: number | null` (§3); R9 "`cc_transaction_index` to the matched CC payment row"; INV1 "`cc_transaction_index` is either `null` or a valid index"; R6 requires "a CC-side `payment_to_card` row."
**Readings:** (a) For an AUTO link produced by `reconcileImports`, R6 always identifies a concrete CC row, so `cc_transaction_index` is always a valid number (never null) on auto links; `null` is reserved for the deferred `manual` link path (§7) where a user links to a statement without pinning a row. (b) auto links could emit null.
**Expected:** (a) — since `reconcileImports` only emits `'auto'` and R6/R9 require an identified CC payment row, every link it emits has a non-null `cc_transaction_index`. The `null` arm of the type exists for the deferred manual feature. I will assert `cc_transaction_index !== null` on every link emitted by `reconcileImports`. **If the DUT ever emits a null `cc_transaction_index` from `reconcileImports`, that is a discrepancy** (would violate R9's "matched CC payment row"). Recorded as an INV-style check, not an ambiguity to escalate.

---

### A12 — [MINOR→confirm] Does an already-`payment_to_card` bank row whose descriptor is UNRECOGNIZED, but which obviously names a card, still produce no link?
**Quote:** "If `detectCardPayment(description)` returns `null`, that bank row produces no link." (§4 R2); the row is still typed `payment_to_card`.
**Readings:** unambiguous — recognition is delegated ENTIRELY to `detectCardPayment`; the matcher does not do any independent issuer sniffing. So a `payment_to_card` row with description `"some random grocery store"` (→ null per §3b) yields no link even though its `transaction_type` says it's a card payment.
**Expected:** No link. This is the correct loud-but-silent behavior (no link, not a wrong link). I will add `detect.unrecognized-descriptor` with `transaction_type='payment_to_card'` to confirm the type does NOT override the descriptor result. **Unambiguous; recorded.** (One latent concern surfaced as residual, not ambiguity: if the upstream adapter typed a row `payment_to_card` but `detectCardPayment` can't recognize it, the drill-through silently has no link — consistent with INV5's "silence over a guess," and matches spec edge "matching CC statement not yet imported"-style graceful degradation.)

---

## 5. Summary for the plan gate

- **Verification plan:** scoreboard vs independent from-spec model + property-based invariants + 5 metamorphic relations (permute/determinism/irrelevant-insert/sign-flip/window-symmetry) + hand-computed goldens + an independent epoch-day window oracle + ambiguity-hunt + mutation/self-mutation. All oracle-free checks prioritized per Knight & Leveson.
- **Cover points:** ~45 bins across origination, issuer alias, last-4 padding, ±30 window (incl. month/year/leap crossings), amount/sign/bigint, cardinality/ambiguity, confidence, link fields, lookup, structure invariants, and degenerate/totality. §6 edges fully covered plus the added issuer-alias / last-4-padding / boundary-crossing / disambiguation bins requested.
- **Traceability:** R1–R11 + INV1–INV7 each map to ≥1 cover point and ≥1 check — **100%** at plan time.
- **Ambiguities found:** **No BLOCKERs.** 12 items enumerated; most are NON-ISSUE (unambiguous, recorded for audit) or MINOR (I can proceed under the stated reading). The items genuinely worth the architect's attention before/with EXECUTE:
  - **A7 (accept-as-scoped, but surface):** the spec / data-model schema (`reconciliation_date_window_days DEFAULT 10`) / research §R12 all still say **±10 days of due-date, configurable**, while the contract §7 mandates a hardcoded **±30 days of period_end**. Per §2 a contract-vs-spec disagreement is a finding; §7 pre-empts it as a deliberate deferral. **Recommend the human reconcile the spec + data-model text to the implemented ±30/period_end** so the documents stop disagreeing. I will verify ±30/period_end and will NOT flag it as a bug.
  - **A3 (confirm intent):** ambiguity is counted over distinct CC *rows* (so two matching `payment_to_card` rows in ONE statement ⇒ no link), not over distinct statements. One-line confirm.
  - **A6 (confirm intent):** is the emitted array order defined (origination-loop order) or only set-stable? Affects whether I can add a stronger ordering assertion. Low risk.
  - **A4, A5, A8 (proceed under stated reading, flag if DUT differs):** non-CC origination includes loan/cash/other; last-4 is left-pad-CC-side-only and malformed last-4 is out of domain; R6 is currency-blind by design (P3 residual).
- **PLAN verdict:** the spec is **executable as-is** under the contract's §7 framing. No human round-trip is strictly required to start EXECUTE; A7 should be reconciled in the docs at the architect's convenience, and A3/A6 are cheap one-line confirmations that would let me tighten two assertions. Orchestrator may proceed to EXECUTE.

**STOP — PLAN pass complete.** No stimulus, scoreboard, coverage model, or mutation was built or run.
