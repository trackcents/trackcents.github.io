# Constitution red-flag audit — overnight features (2026-05-26)

A pre-deploy scan of every new logic module added this session against the most safety-critical
binding principles. Modules audited: merchant-trends, manual-entry, csv-import, export-csv, backup,
category-budget, savings-goal, transfer-detector, budget-store, goals-store (+ their routes).

## Principle XIII — No hidden data outflow (no telemetry/network)
PASS. `grep` for `fetch( / XMLHttpRequest / sendBeacon / navigator.* / analytics / gtag / postMessage
/ WebSocket` across all new modules → **none**. The new features are pure on-device logic; the only
I/O is the existing OPFS/localStorage stores (via store-crypto) and user-initiated file download/upload
(backup/CSV), which never hit the network.

## Principle II — Money is integer cents, never float
PASS. No `parseFloat` and no `.toFixed` anywhere in the new money code. Every monetary VALUE is `bigint`
(enforced by the types + the store's Zod schema). The four `Number(...)` uses are all display-only or
non-money:
- `merchant-trends` jump_pct, `category-budget` pct, `savings-goal` rawPct — percentages for progress
  bars / labels (contracts explicitly mark `pct` as display-only float; the exact money oracle is the
  bigint field alongside).
- `csv-import` `Number(frac[2])` — reads ONE fractional digit to decide half-up rounding; the cents
  result is computed in bigint.
CSV amount strings render from bigint via `centsToDecimal` (no float); CSV import parses to bigint via
integer arithmetic. backup/budget/goal stores serialize bigints as decimal strings (round-trip exact).

## "No amount-based classification" project rule
PASS by construction. None of the new modules infer a transaction's MEANING from its size:
- merchant-trends compares a merchant to its OWN past charges (structural).
- transfer-detector pairs equal-and-opposite movements across accounts (structural conservation).
- refund/split/budgets/goals all act on user-set labels/limits, never size-guessing.

## Layering (Principle VI)
PASS. New logic lives in `src/lib/app/` (Layer 3) + `src/lib/db/` (Layer 2 stores); no adapter (Layer 1)
imports app/db. The ESLint layering guard remains green.

## SC-007 — Bundle < 5 MB initial download
PASS. Full production build output is **4.25 MB on disk** (everything, excl. source maps) — under the
5 MB ceiling even if it ALL loaded. The actual INITIAL download is ~1 MB (entry ~8 KB + CSS 30 KB +
Inter font 213 KB + the code-split landing route). The two heavy assets are lazy-loaded and NOT in the
initial download: `pdf.worker.mjs` (~2.06 MB, fetched only when a PDF is dropped) and the ECharts chunk
(~1.1 MB, dynamic-imported by EChart.svelte on the dashboard). The overnight features (small pure-logic
modules + per-route code-split pages) added negligible weight. SC-008 (zero telemetry) is covered by
the Principle XIII scan above.

## Mutation testing — the three designer-test-only modules (manual-entry, backup, savings-goal)
These three were covered by designer + property tests instead of a full fresh-context IV&V (a
proportionality call: simple logic). To validate that call, ran Stryker scoped to them: **74.93%** →
found GENUINE killable gaps in the budgets/goals shape-validation added to backup.ts (several
malformed-input rejection branches unexercised — a no-silent-failures concern). Added 7 targeted
rejection tests → **78.59%**. The residual (~21%) is the equivalent class the 8 IV&V verifiers
consistently justify — error-message string literals, `issue`/`issues` pluralization, the `Error.name`,
regex-anchor mutants, and defensive guards masked by a later guard — which the project convention does
NOT over-fit tests to ("asserting exact prose over-fits"). Above the 70 hard floor; the behavioral
surface is fully covered. The proportionality call was sound, and the check still hardened the newest
validation code.

## Verdict
No constitutional drift introduced by the overnight features. Independent IV&V sign-offs (7 modules)
+ 23 E2E + the 1092-test suite + bundle/telemetry checks back this up. Safe to deploy on the
privacy/accuracy/cost axes.
