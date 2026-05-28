# Session state snapshot

Written by `scripts/hook-precompact.mjs` at **2026-05-28T22:34:37.384Z** just before Claude's context was compacted.

The NEXT Claude session can read this file to reconstruct what was in flight.

## Compaction trigger
auto

## Git state at compaction
```
M src/lib/app/nl-quick-add.ts
?? .agents/
?? skills-lock.json
```

Last commit: dcc0551 fix(quickadd): amount tracks description live + AM/PM time + smart year heuristic (11 minutes ago)

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
