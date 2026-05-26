# Overnight build — decisions & research log (review together tomorrow)

> Every time a spec/feature was ambiguous, I made a reasoned call here instead of
> stopping. Each entry: what was unclear, what I researched/reasoned, what I chose.
> Flag anything you want changed in the morning.

## D1 — Recurring detection without bank links
Rocket Money auto-detects recurring charges from linked-bank history. We have PDF imports only.
**Decision:** generalize the existing paycheck-detector (recurrence-by-descriptor + cadence) to ALL
merchants, not just paychecks. A merchant with ≥2 same-descriptor charges at ~monthly/biweekly spacing
is flagged recurring; next-due = last date + median cadence. Structure-based only (no amount guessing),
consistent with the no-amount-classification rule. User can manually mark/unmark "is recurring".

## D2 — "Ignore/exclude" semantics
Rocket Money lets you ignore a transaction from budgets/spending. **Decision:** add an `ignored` flag to
the transaction annotation overlay (same store as category/note/tags). Ignored txns are excluded from
spending-summary aggregations + dashboard + budget, but still shown (greyed) in the transactions list.

## D3 — Split transactions
**Decision:** model a split as annotation metadata on the parent txn: an array of {category_id, amount_minor}
that sums to the txn amount. The original parsed txn is never mutated (provenance preserved). Spending
aggregation, when a split exists, distributes the amount across the split categories instead of the single
category. (Deferred to TIER 2; if time-constrained, log to BLOCKERS.)

## D4 — Tags vs categories
**Decision:** tags are a many-to-many free-form label set on a txn (annotation overlay `tags: string[]`),
separate from the single category. Filter/group by tag mirrors category. Matches Rocket Money's Categories/Tags split.

## D5 — Home as default landing
**Decision:** when the vault has imports, `/` redirects to `/today` (Home); with no data, `/` stays the
import/Statements page. Onboarding still gates first-run. This matches Rocket Money's "Today" being the home.

## D6 — Cousin's pricewatch: adapt "price tracking" to bank data
pricewatch tracks the **unit price of items** over time — but that needs **itemised receipts**;
bank/CC statements only give the **merchant-level total per visit**. **Decision:** build
**merchant-level recurring-charge price-trend** detection (`merchant-trends.ts`): for each
recurring merchant, compare its charges *to its own past charges* and surface biggest jumps
(absolute + %). This delivers pricewatch's actual value ("my subscriptions/bills crept up")
within the constitution and our data. True item-level tracking is logged as a deferred
**receipt-ingestion** feature (needs an OCR/itemised adapter). Comparing a merchant to its own
history is NOT amount-based classification — we never guess *meaning* from size.

## D7 — JSON backup (export/import) — pricewatch Settings
**Decision:** add `backup.ts` + a Settings screen. Export bundles the user's already-local,
already-decrypted data to a JSON file the user saves themselves; import validates shape and
merges. UI warns the file is unencrypted-on-disk (it's the user's own data, their device, their
explicit action). The **synced Drive blob stays encrypted** — backup is a separate, manual,
offline path; it does not touch sync. Privacy-positive: a true offline escape hatch with no server.

## D8 — Manual transaction entry data model
The annotation key is `<pdf_source_hash>#<index>`, stable only because PDF imports are immutable.
A mutable manual list would reindex on delete and corrupt annotation keys. **Decision:** give each
manual txn a **stable id** and surface it to aggregation/categorisation as a one-transaction
synthetic import under a **Cash** account. Deleting one never reindexes another. Manual txns are
hidden from the *Statements* list but counted everywhere spend is summed. No checksum gate (nothing
printed to reconcile).

## D9 — CSV import: checksum is advisory, not a gate
PDF imports enforce the checksum invariant as a HARD gate (constitution II). A CSV carries **no
printed statement total**, so there's nothing to reconcile against. **Decision:** CSV import records
`checksum_status: 'not_applicable'` and is allowed; it is clearly labelled as un-reconciled in the UI
so the user knows it wasn't checksum-verified like a PDF. Malformed rows still throw with row context
(no silent failures). This keeps the hard gate meaningful for PDFs while supporting unsupported banks.

## D10 — CSV export precision
**Decision:** amounts are rendered from the **bigint cents** to a fixed-decimal string
(cents → `${whole}.${frac}`), never via float, never via `Number()`. RFC-4180 quoting. The exporter
and importer round-trip (verified by IV&V). Honours constitution II (no float in money paths).

## D11 — Scope cut for one session
Researched but **deferred** (logged, not dropped): rollover/envelope budgets (YNAB/Skwad),
savings goals (US-P4-B), receipt item-level tracking, multi-currency UI polish. Built this batch:
merchant-trends, JSON backup, manual entry + Cash, CSV import/export, split. Rationale: highest
value × constitution-fit × pure-logic-first (so each is independently verifiable by verif-kit).

## D12 — Sequence refund tracking (T-R5) AFTER the verifier agents
T-R5 (US-P3-C) must reduce a category's total when a refund is linked to a purchase. In our
signed-cents model a same-category refund (positive) already NETS against the purchase (negative)
when summed — so the real work is: (a) annotation `refund_of?: <txnKey>`, (b) make an
uncategorized refund INHERIT its linked purchase's category in the spending aggregation so it
nets instead of floating as uncategorized income. **Decision:** because (b) edits the
spending-aggregation money path (used by dashboard/today/budget), it must be gated by a FULL
`pnpm verify` AND its own fresh verif-kit run. Right now two VE agents (csv-import, merchant-trends)
are running and temporarily hold the default vitest config (Stryker), so a full verify isn't
runnable and a 3rd concurrent VE is undesirable. So T-R5 is sequenced to start once those two land
and are promoted. Logged rather than rushed — money paths don't get built without their gate.

## D13 — Same-day tie ordering in merchant-trends (IV&V finding, CONFIRMED BUG)
The merchant-trends verifier's oracle-free metamorphic relation INV4 (permutation invariance)
found that `merchantTrends` sorted each merchant's charges by `posted_date` ONLY. With a stable
sort, two charges to the same merchant on the SAME day kept their input order — so the same data
imported in a different order produced a different "latest charge" / price-jump. **Decision:** a
finance tool MUST be deterministic regardless of import order, so I added a deterministic tiebreak:
within a merchant, sort by `posted_date` asc, then `amount_minor` asc, then `description` asc. Same-day
charges have no true temporal order, so any total order is defensible; this makes INV4 hold
UNCONDITIONALLY (not just for distinct-date inputs) and removes ambiguity A1. Also hardened
`largestPurchases` to a full total order (magnitude desc → date desc → description) for the same
reason. This is a CONFIRMED BUG fix surfaced by IV&V (the value of metamorphic testing — the
scoreboard passed because the reference model had copied the stable behavior; only the oracle-free
relation caught it). Contract R5/INV4 updated; the VE's directed same-day test expectation updated
to the decided order on promotion.

## D14 — Pick up US-P4-A (per-category budgets) now that the core is complete
The planned TIER 1/1.5/2/3 backlog is fully built + verified + green. Rather than the deliberately-
skipped low-value dashboard W/Q toggle, I'm picking up a real spec-roadmap feature the user's broad
"add all those features" mandate covers: **per-category monthly budget limits + over-budget
indicators (US-P4-A)** — a staple of YNAB / Monarch / Rocket Money, constitution-compatible (local,
no bank link, money as bigint). **Decision:** persist limits under a SEPARATE local store key
(`mtrb.budgets`, encrypted at rest like categorization) rather than extending the IV&V-signed-off
CategorizationState/backup schema — cleaner separation, no re-verification of the merge/backup paths.
Pure logic in `category-budget.ts` (limit vs spent per category for a month) → verif-kit; UI extends
`/budget`. NO amount-based classification (the user sets limits explicitly; we only compare spend to
the user's own limit). Over-budget is an on-screen indicator, not a push notification (constitution
XIII — no telemetry/notifications).

## D15 — Budgets/goals in the JSON backup — RESOLVED (now included)
Originally budgets/goals were left out of the backup bundle (acceptable for v1). **Update
(2026-05-26 ~06:40):** folded both in — `BackupBundle` now carries `budgets` (CategoryLimits) +
`goals` (SavingsGoal[]); `exportBackup` takes an optional `{budgets, goals}` extras arg; `importBackup`
validates their shape and defaults them to `{}`/`[]` for OLDER backups (backward-compatible, no version
bump). `/settings` export/import wires loadBudgets/saveBudgets + loadGoals/saveGoals. 4 new round-trip +
malformed-section tests; bigints round-trip via the existing sentinel. So a device migration via backup
now restores EVERYTHING (imports + categorization + budgets + goals). pnpm verify GREEN (1047).

## D16 — Task #41 (anonymizer over-redaction) closed; found+fixed a real privacy bug
#41 targeted `cleanup-output.mjs` (a JSON-coordinate redactor) — that file is GONE, replaced by the
text-based `src/lib/util/anonymize.ts`, so the original JSON-coordinate over-redaction bug can't occur.
Reviewing the CURRENT anonymizer for the same spirit, found a genuine **privacy LEAK** (Principle I):
the account-number path used `num.slice(-keepLast)` — with `keep_last_n_digits: 0` that's `slice(-0)` =
the WHOLE number, so "fully redact" actually emitted `XXXXXXXXX123456789` (full account number leaked
after the X's); and `keepLast > length` threw a RangeError (`'X'.repeat(negative)`). **Fixed** by clamping
`eff = min(max(keepLast,0), num.length)`. Added 2 regression tests (keepLast 0 → fully masked, no digit
survives; keepLast 20 → no crash). The CC path already handled 0 via an explicit branch; only the account
path was affected, and it was untested. pnpm verify GREEN (1126). Good catch from the pre-deploy review.

## D17 — Offline service worker was built but NEVER REGISTERED (SC-006/FR-054 gap) — fixed
Found during deploy-readiness review: `src/service-worker.ts` is a complete, production-ready offline
app-shell SW (precache build+files, cache-first same-origin, never caches cross-origin Google
auth/sync, version-scoped cache cleanup) — but `svelte.config.js` has `serviceWorker.register: false`
and NOTHING registered it manually, so it never ran. SC-006 ("app loads + view data offline") and
FR-054 were therefore NOT satisfied despite the feature being written. **Fixed:** register it in the
root +layout `onMount`, base-path-aware (`${base}/service-worker.js`), PRODUCTION-only (`!dev`, so it
doesn't fight HMR), wrapped in try/catch (a registration failure must never block the app — offline is
an enhancement). Verified: full 23-test E2E suite GREEN against the production preview WITH the SW
active (registers cleanly, no console errors, no flow breakage); pnpm verify GREEN (1133). Offline is
runtime+precache-cached, so SC-006's "reopen offline after an online load" scenario works; manual
acceptance per spec = disable network, reopen. (4th real bug found by review tonight.)

## D18 — iOS standalone PWA meta tags were missing (Add-to-Home-Screen / storage-persistence gap) — added
Continuing the deploy-readiness review after D17. `static/manifest.webmanifest` is correct
(`display: standalone`, and `start_url`/`scope` are RELATIVE `"."` so they survive a base-path
deploy), and `app.html` links the manifest + apple-touch-icon base-path-aware (`%sveltekit.assets%`).
BUT `app.html` had **no `apple-mobile-web-app-capable` / title meta tags**. This matters specifically
for this app: US-P1-A / constitution IV nudge iOS users to Add-to-Home-Screen precisely so the data
survives Safari's 7-day storage eviction — which only happens when the app launches **standalone**.
The manifest's `display:standalone` covers iOS 16.4+, but the Apple meta tags are the load-bearing,
cross-iOS-version signal (older iOS) and also set the home-screen title. **Fixed:** added
`mobile-web-app-capable`, `apple-mobile-web-app-capable`, and `apple-mobile-web-app-title=Money Tracker`
to `app.html` <head>. Static tags only — zero JS, zero test impact; left status-bar-style at the iOS
default (the app has a light/dark toggle, so a hardcoded bar style would clash in one theme). pnpm
verify GREEN (1133). Note: `icon-512.png` and `icon-maskable-512.png` are byte-identical placeholders
(the maskable one lacks safe-zone padding) — that's the user-owed "real app icon" already in BLOCKERS,
not a new issue.

## D19 — FIFO attribution was import-order-dependent on same-day rows (IV&V plan-gate finding) — fixed
Ran a full `/ivv` on `transaction-stream.ts` — the P0 FIFO engine that answers the app's CORE
question (US-P1-D: "the $X I paid to my card — which purchases did it pay off?"). It had designer
property+stateful tests but had NEVER been independently verified. The fresh-context verification
engineer's PLAN pass surfaced (a) a typo in MY contract's worked example (`1007`→`1000`; $351.27−$341.27
= $10.00 = 1000¢, not 1007 — fixed so the oracle isn't poisoned, no code bug) and (b) a GENUINE
ambiguity: `buildCardStreams` sorted by `posted_date` ONLY, so two rows on the SAME day kept their
import order. A same-day `purchase −$50` + `payment +$50` imported payment-first would leave the
payment covering nothing (uncovered $50, balance $50) instead of the intuitive $0 — and the answer
would flip based on PDF/parse order. **This is the exact bug-class D13 fixed in merchant-trends.**
**Decision (Reading B):** the spec doesn't pin same-day order, but D13 already established the binding
principle "a finance tool MUST be deterministic regardless of import order." So I added a deterministic
TOTAL order to the same-day tie-break: posted_date asc → **debits (purchase/fee/interest) before credits
(payment_to_card/refund)** → amount_minor asc → description asc. Debit-before-credit means a same-day
payment pays off that day's charges (the intuitive, standard answer), and the order is built from
INTRINSIC fields only (no import index) so it's permutation-invariant up to genuinely-identical rows.
Rewrote the old `same-day → original order matters` test (whose very intent was now wrong) into a
two-direction test proving order-independence. pnpm verify GREEN (1133). Contract R6/INV7/§7/§11 updated
to the resolved semantics; the EXECUTE VE verifies against the corrected contract. **FOR MORNING REVIEW:**
this is a defensible default chosen autonomously per the "decide like other finance apps + log it" rule —
if you'd rather same-day ties resolve differently (e.g. credits-first, or by time-of-day if we ever parse
it), say so and I'll adjust. (The VE also flagged a `cardKeyString` separator-collision hazard — deferred
to a directed EXECUTE-pass injectivity probe.)

## D20 — cardKeyString collided on adversarial inputs (IV&V EXECUTE finding) — fixed; sibling logged
The EXECUTE-pass verification engineer for `transaction-stream.ts` (a fresh context that never read
the source) signed off at 84% mutation / 100% coverage closure with ONE confirmed discrepancy:
`cardKeyString` built its card identity as `${bank_name}::${account_last_4}`, which is NOT injective —
`{bank_name:'', account_last_4:':'}` and `{bank_name:':', account_last_4:''}` BOTH map to `':::'`. Two
genuinely-different cards would merge into one stream, so a payment to card X would be attributed to
card Y's purchases — a money-truth error on US-P1-D's critical path. Probability is low in production
(account_last_4 is 4 digits, bank_name from a fixed adapter registry — the VE verified 0 collisions in
that domain and 0/2000 random pairs), but severity is high. **Designer ruling: CONFIRMED BUG** (the VE
offered "spec ambiguous"; I overrode to "bug" because contract R1 requires injectivity over the typed
`string` domain, and constitution Principle II + the "default to no on anything that weakens accuracy"
governance make "production inputs won't hit it" the exact silent-failure posture the constitution
forbids for a money-truth identity function). **Fixed:** injective JSON-tuple key
`JSON.stringify([bank_name, account_last_4])`; the key is a purely internal Map key (built + looked up
via the same function, never persisted), so the format change is safe — confirmed no caller hardcodes
the old `::` form. The VE's discrepancy test was flipped from "asserts the collision (documents D1)" to
a regression guard (asserts ZERO collisions over the adversarial set + 2000 random pairs). pnpm verify
GREEN (1186); 52-test IV&V suite promoted to tests/unit/independent/. Report:
reports/ivv/2026-05-26-0720-transaction-stream.md.
**SIBLING bug-class FOLLOW-UP (logged, not fixed unattended):** the same `::`-separator hazard exists in
`src/lib/app/transaction-view.ts` (account-key helpers ~L90 & L226–227, a 3-part `bank::type::last4`
key). That key is part of the /transactions FILTER contract — the filter UI and its tests construct
literal `'BankA::credit_card::1111'` keys — so fixing it is a larger, separately-verified migration
(update the filter key construction + hardcoded test keys + re-run transaction-view's own IV&V). Queued
in BLOCKERS as the next P0 IV&V target rather than changed blind tonight.

## D21 — Reconciliation date-window: spec/data-model say ±10d/due-date, code does ±30d/period_end (IV&V A7) — FOR MORNING DECISION
The reconciliation.ts IV&V PLAN pass flagged a documentation-vs-code divergence (not a code bug):
the matcher links a bank "PAYMENT TO …CC" to a credit-card statement when the payment date is within
a date window of the statement. **Spec FR-031 + US-P1-D + data-model column
`reconciliation_date_window_days INTEGER NOT NULL DEFAULT 10` + research §R12 all say ±10 days of the
DUE DATE (configurable). The shipped, tested code uses a hardcoded ±30 days of `period_end`.** The code's
own comment documents WHY: `payment_due_date` isn't reliably extracted yet, so it generalizes to
period_end with a wider window. This is defensible and doesn't break US-P1-D's 1-click-drill outcome, so
I accepted ±30/period_end as authoritative for THIS verification run (and the VE verified that behavior).
But which way to reconcile is a genuine PRODUCT decision only you should make, so I did NOT rewrite the
spec autonomously. **FOR MORNING REVIEW — pick one:** (a) adopt ±30/period_end as the spec (update
FR-031 + the data-model default + §R12 to match reality — simplest, the behavior is already shipped &
tested), or (b) keep ±10/due-date as the goal and schedule due-date extraction + make the window
configurable per the original schema. Until you decide, the docs and code disagree (a constitution
cross-artifact-consistency WARN). Recommendation: (a) unless you specifically want due-date-anchored
windows. (Plan-gate confirmations, no round-trip needed: ambiguity is counted over distinct CC payment
ROWS — 2 matching rows in one statement ⇒ no link; emitted link order is deterministic origination-loop
order.)

## D22 — Reconciliation matched ambiguous CC rows at statement level, not row level (IV&V EXECUTE finding) — fixed
The reconciliation.ts IV&V EXECUTE pass (fresh context, never read the source; 96.67% mutation, 100%
coverage closure, 1500-case clean scoreboard) found a P0 anti-false-positive bug: `reconcileImports`
used `findIndex` to locate a matching CC payment row within a statement, returning only the FIRST match.
So when one credit-card statement carried TWO `payment_to_card` rows of the matched amount, they
collapsed to ONE statement-level match → `matches.length === 1` → the matcher emitted a link to row 0
instead of recognizing the ambiguity and staying silent. This violates the spec's headline safety
property (US-P1-D / R7 / INV5: when 2+ distinct CC payment rows match a single bank payment, emit NO
auto-link — never guess), confirmed row-level at the plan gate (A3). A real cardholder can make two
equal payments in one cycle, so the drill-down could silently point at the wrong row. The
across-statements ambiguity case was ALREADY handled correctly (so example tests missed the
in-statement case — exactly the blind spot independent verification exists to catch). **Designer ruling:
CONFIRMED BUG** (spec-mandated, not a judgment call). **Fix:** collect EVERY matching row (forEach, not
findIndex) so ambiguity is counted per ROW; 2+ matches (in one statement or across statements) now yield
NO link. The VE's failing "two matching CC rows in one statement → ZERO links" assertion is the permanent
regression guard. pnpm verify GREEN (1215); 29-test IV&V suite promoted to tests/unit/independent/. No
designer test regressed. Report: reports/ivv/2026-05-26-0810-reconciliation.md. (This completes
independent verification of BOTH halves of the US-P1-D pipeline: reconciliation = "which card",
transaction-stream = "which purchases".)

## D23 — checksum (hard import gate) IV&V — SIGNED OFF clean; first run of the new staged verif-kit
Verified `src/lib/app/checksum.ts` (the constitution Principle II enforcement point — reconcile to the
cent or REFUSE) using the **newly-rebuilt right-sized staged gate** (dogfooding it). Result: **SIGNED OFF,
zero bugs.** Stage 1 (boundary/exactness per level, sign-hazard probes, refusal-shape, metamorphic,
no-false-PASS/no-false-REFUSE) ran clean and closed 100% coverage; the bounded Stage 2 (independent
reference gate + ~22k-case scoreboard + sampled mutation) confirmed without rebuilding. The Level-C
3-term-vs-4-term ambiguity (plan-gate Q1) was ruled **algebraically identical** under the normalized sign
convention (refunds + payments are both positive inflows, so Σpositives = payments+credits) — not a bug,
no code/spec change. Mutation 78.18% raw but every one of 48 survivors justified (message prose the
contract puts out of scope, Level-B's intentionally-unpinned display numbers, or provable equivalents) →
effective decision-logic kill 100%. 52-test suite promoted; pnpm verify GREEN (1258).
**Process learning fed back into verif-kit (committed 081c381):** the run was ~24 min, ~20 of which were
full Stryker passes that found nothing actionable while the cheap reference-model self-mutation check had
ALREADY proven the bench has teeth. So the charter now says: self-mutation is the PRIMARY teeth-proof; a
full external mutation run is the most expensive lens and should be sampled-hard/deferred when Stage 1 +
the bounded scoreboard are clean and self-mutation proved teeth. (Next time this gate would run in ~5 min.)
Report: reports/ivv/2026-05-26-1530-checksum.md.

## D24 — money.ts IV&V — SIGNED OFF clean in ~4 min (lean staged flow proving itself)
Verified `src/lib/util/money.ts` (parseMoney/formatMoney/sumMoney/absMoney). parseMoney is a real
parser of PDF-extracted money strings (Core tier, one Critical surface); the rest are trivial. Ran the
lean staged flow: Stage 1 = round-trip metamorphic (oracle-free, the headline) + hand-derived parser
hazard goldens + the 13-case reject set (no-silent-failure / Principle II) + 1000-run bounded fuzz +
formatMoney goldens. **SIGNED OFF, zero bugs**, 100% cover-point closure. Per the new policy for a
4-function module, NO heavy reference model and NO full Stryker marathon — the reference-model
self-mutation teeth-check (a corrupted golden + off-by-one both correctly failed) is the proportionate
substitute. **~4 minutes total** vs the ~25 min the old always-full flow spent on comparable modules — the
staged gate delivering its intended ~5-6× speedup at the same assurance. 39-cover-point suite promoted;
pnpm verify GREEN (1278). Report: reports/ivv/2026-05-26-1600-money.md. Remaining unverified P0/Core:
card-payment.ts (regex recognizer — low mutation-signal), payment-drill.ts (glue over two verified
halves), transaction-view.ts (gated key-collision fix).

## D25 — card-payment `bankNameMatchesIssuer` substring false-positive (IV&V finding) — fixed
The lean staged IV&V on `card-payment.ts` (the CC-payment descriptor recognizer that feeds the US-P1-D
matcher) found a real bug in ~4 minutes: `bankNameMatchesIssuer` used a loose case-insensitive SUBSTRING
match, so a bank whose name merely CONTAINS a short alias matched the wrong issuer — `"Citizens Bank"`→Citi,
`"Pineapple Credit Union"`→Apple, `"purchase…"`→Chase (chase ⊂ purchase), `"BoARD…"`→BofA (8 independent
false positives; contract INV3 mandates `false`). A wrong issuer match mis-routes a reconciliation link —
the exact false-positive hazard US-P1-D must avoid. **Fix: EXACT case-insensitive match against the alias
list.** Decisive evidence it's both safe and sufficient: every CC adapter sets `bank_name` to a plain
canonical alias (`'Robinhood'`, `'Bank of America'`, `'Chase'`, `'Discover'`, `'American Express'`), so
exact-match covers 100% of production with ZERO false positives and **fails closed** (a future suffixed
bank_name yields a missing link — safe + fixable by adding the exact string to the alias table — never a
wrong link). An obsolete designer test asserting the removed substring behavior on a non-adapter input
(`"Robinhood Credit, Inc."`) was updated to the corrected semantics + a no-false-positive regression test.
Scope decision (autonomous, logged): bank_name is adapter-controlled per the layered architecture
(constitution VI), so the VE's two whole-word-in-unrelated-entity cases (`"BoA Fitness Club"`, `"Capital
One Realty Brokers"`) are out of the production domain — exact-match rejects them anyway, so moot. 57-test
IV&V suite promoted; pnpm verify GREEN (1336). Report: reports/ivv/2026-05-26-1640-card-payment.md.
**This completes end-to-end independent verification of the US-P1-D pipeline** (card-payment → reconciliation
→ transaction-stream) + the checksum gate + money parser. **4 real bugs found + fixed across the P0 core
tonight: D19 (same-day determinism), D20 (key collision), D22 (matcher ambiguity), D25 (issuer false-match).**

## D26 — payment-drill IV&V — SIGNED OFF clean (~5 min); US-P1-D pipeline verification COMPLETE
Verified `payment-drill.ts` (`getPaymentDrill`, the US-P1-D drill-down orchestrator) via the lean staged
flow. It's a thin orchestrator over two already-signed-off modules; its own surface is provenance
resolution + null-guards + conservation pass-through. **SIGNED OFF, zero bugs**, 15 cover points 100%
closed, ~5 min. The headline provenance round-trip (over 400 random multi-statement histories, every
shown purchase resolves to its exact source row, right card, no cross-contamination) + conservation
held; the index-confusion bug-class the contract flagged was specifically clean. Collaborators driven
transitively via real fixtures, not mocked or re-verified. Full Stryker deferred (thin orchestrator, no
bug); teeth proven via a 1-cent self-mutation of the conservation oracle. 22-test suite promoted; pnpm
verify GREEN (1349). Report: reports/ivv/2026-05-26-1710-payment-drill.md.
**MILESTONE — the entire US-P1-D signature-feature pipeline is now independently verified end-to-end:**
card-payment (detect) → reconciliation (match) → transaction-stream (FIFO) → payment-drill (orchestrate +
provenance), plus the checksum import gate + money parser. Session IV&V tally: **4 real P0-core bugs found
+ fixed** (D19 determinism, D20 key collision, D22 matcher ambiguity, D25 issuer false-match). The only
core module left unverified is transaction-view.ts (sole hazard = the production-unreachable `::` key
collision; fix is user-gated — changes the /transactions filter-key contract). **The high-value
verification campaign is complete; remaining work is user-gated or large-infra (unsafe unattended).**

## D27 — transaction-view IV&V — SIGNED OFF clean; CORE VERIFICATION CAMPAIGN COMPLETE
Verified `transaction-view.ts` (US-P1-E unified view: flatten/filter/sort) via the lean flow — **SIGNED
OFF, zero bugs**, 53 cover points 100% closed, ~6 min. The CLAUDE.md-mandated pairwise filter check
(AND-decomposition across all 10 dimension pairs) passed; inclusive date+amount bounds, abs-amount
filtering, token-AND search, sort stability/permutation all clean. **Two hazards independently cleared:**
(a) the amount-bound float (dollars→cents) handles the float traps correctly at every cent-exact bound;
(b) the `accountKeyString` `::` key — the D20 sibling I'd flagged — is actually SAFE here (540 adversarial
combos, no collision) because its middle field is a TYPED ENUM, so the straddling collision that bit the
2-part cardKeyString is unreachable in this 3-part key. No fix needed (confirms the earlier
production-unreachable call). **A1 (spec ambiguity, resolved — not a bug):** a filter amount bound finer
than a cent (`$2.675`) is spec-silent; DUT rounds half-up to 268¢ (self-consistent). **Decision (what
other apps do):** amount filter inputs are entered in dollars and the cent is the unit, so round-half-up-
to-cent is correct and accepted; cent-granularity is guaranteed; optionally the UI could clamp the input
to 2 decimals later (low priority, no code change). 46-test suite promoted (an unused reference comparator
removed on promotion for lint); pnpm verify GREEN (1395).
**MILESTONE — CORE VERIFICATION CAMPAIGN COMPLETE.** Every core/P0 logic module is now independently
verified: money, checksum, card-payment, reconciliation, transaction-stream, payment-drill (full US-P1-D
pipeline) + transaction-view (US-P1-E) + the earlier feature/money modules. Session IV&V found + fixed 4
real P0-core bugs (D19 same-day determinism, D20 key collision, D22 matcher ambiguity, D25 issuer
false-match); all other modules verified clean. **No core-logic module remains unverified.** Remaining
PLAN work is exclusively user-gated (deploy target, OAuth, real icon, live 2-device test, the D21
date-window product decision, the transaction-view filter-key migration if ever desired) or large-infra
unsafe-unattended (#49 wa-sqlite, #79 cross-device store sync).

## D28 — categorization rule engine IV&V — SIGNED OFF clean (~5 min)
Verified `categorization.ts` (US-P2-A: matchRule/firstMatchingRule/applyRules + annotation CRUD) via the
lean flow — **SIGNED OFF, zero bugs**, 35 cover points 100% closed. The headline user-intent safety
properties hold over 800+ random runs: **a manual category is IMMORTAL under applyRules (no rule, in any
config, overwrites a user's hand-pinned category)** and **user extras (note/tags/ignored/rename/recurring/
refund_of/split) survive rule re-apply** (incl. for txns not in the current batch). Classic bug-classes
probed + clean: empty pattern matches NOTHING (no silent tag-everything), invalid regex → false (no
throw), `enabled===undefined` is ENABLED (no inversion), deleteCategory leaves no dangling reference.
Categorization is money-adjacent (it decides which bucket spending lands in → the dashboards), so these
properties protect the user's money picture. 32-test suite promoted; pnpm verify GREEN (1427). One
optional spec-tightening noted (drop-vs-keep-null for a no-longer-matching rule annotation; both
defensible, not a bug). Report: reports/ivv/2026-05-26-1820-categorization.md.
**This was the last genuinely-distinct unverified pure-logic module.** Independent verification now spans
the entire money-truth core + the full US-P1-D pipeline + the US-P1-E view + the import gate + the US-P2-A
rule engine. The remaining unverified code is regex-heavy adapters (low IV&V signal — covered by the
real-PDF corpus + synthetic fixtures + cross-adapter exclusivity per CLAUDE.md) and I/O/UI/glue (store,
schema, import pipeline, sync-controller, Svelte components — not pure logic). Forcing IV&V on those would
be the over-verification the staged redesign exists to prevent.

## D29 — Built month-over-month spending insights (US-INSIGHT) — a remaining feature from the other-apps mandate
With the verification campaign complete, returned to the user's ORIGINAL dominant mandate ("study other
finance apps, bring their worthwhile features in, spec-first then code"). The clearest unbuilt,
high-value, on-mandate feature: **month-over-month category spending insights** — Copilot Money's "vs last
month", also in Monarch + Rocket Money. **Ambiguity call (per the directive's "decide using what other
finance apps do"):** every comparable app surfaces this; it directly serves the user's core problem ("I
lose track of where the money goes") by showing WHERE spend moved — so build it. **Constitution fit:** it
compares the user's OWN category totals across periods (like merchant-trends self-comparison D6) — NOT
amount-based classification; money stays bigint cents; the % is a display Number (like budget/trends %);
on-screen only, no notifications (XIII). Spec-first per the user's insistence: added §8 (US-INSIGHT) to
spec-tracker-research-features.md BEFORE coding. Built as a thin PURE module `spending-insights.ts` on top
of the already-signed-off `spendingByCategoryByMonth`, lean-verified (Stage 1: conservation + ranking
determinism + period edges), surfaced compactly on /today. **FOR MORNING REVIEW:** this was an autonomous
call to keep making forward progress on your feature mandate while you're away — if you feel the feature
set is already complete, this strip is easy to remove (one Home section + one self-contained module).

(more entries appended as the night proceeds)
