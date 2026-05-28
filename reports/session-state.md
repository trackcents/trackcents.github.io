# Session state snapshot

Written by `scripts/hook-precompact.mjs` at **2026-05-28T06:03:53.981Z** just before Claude's context was compacted.

The NEXT Claude session can read this file to reconstruct what was in flight.

## Compaction trigger
auto

## Git state at compaction
```
M reports/session-state.md
 M src/components/BudgetBox.svelte
 M src/components/FilterBar.svelte
 M src/components/QuickAddSheet.svelte
 M src/components/StatementCard.svelte
 M src/components/UnifiedTransactionTable.svelte
 M src/lib/util/money.ts
 M src/routes/budget/+page.svelte
 M src/routes/goals/+page.svelte
 M src/routes/onboarding/+page.svelte
 M src/routes/today/+page.svelte
 M src/routes/transactions/+page.svelte
?? .agents/
?? skills-lock.json
```

Last commit: d0db270 feat(home): "I'll remember this" save toast closes the Bayes feedback loop (14 minutes ago)

## Latest validation report
(no validation report on disk)

(See `reports/validation/` for the full file. If validation hasn't been run recently, run `pnpm verify` or invoke /validate first.)

## How to use this file

When a new Claude session starts and the user asks "where are we" or anything similar:
1. Read this file first.
2. Read `specs/<latest>/tasks.md` to see implementation progress.
3. Read the latest validation report (named above) for test/coverage state.
4. Then answer the user with a synthesis.

This file is OVERWRITTEN at every compaction — only the most recent state is preserved.  Pre-compaction state from older sessions is in git history if needed.
