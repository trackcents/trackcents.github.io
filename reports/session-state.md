# Session state snapshot

Written by `scripts/hook-precompact.mjs` at **2026-05-26T13:24:02.407Z** just before Claude's context was compacted.

The NEXT Claude session can read this file to reconstruct what was in flight.

## Compaction trigger
auto

## Git state at compaction
```
A  .claude/skills/software-architecture-advisor/README.md
A  .claude/skills/software-architecture-advisor/SKILL.md
A  .claude/skills/software-architecture-advisor/references/decision_log_template.md
A  .claude/skills/software-architecture-advisor/references/general_prompting_techniques.md
A  .claude/skills/software-architecture-advisor/references/software_overlay.md
A  .claude/skills/software-architecture-advisor/stress_test_protocol.md
A  .claude/skills/speckit-analyze/SKILL.md
A  .claude/skills/speckit-checklist/SKILL.md
A  .claude/skills/speckit-clarify/SKILL.md
A  .claude/skills/speckit-constitution/SKILL.md
A  .claude/skills/speckit-implement/SKILL.md
A  .claude/skills/speckit-plan/SKILL.md
A  .claude/skills/speckit-specify/SKILL.md
A  .claude/skills/speckit-tasks/SKILL.md
A  .claude/skills/speckit-taskstoissues/SKILL.md
A  .specify/integration.json
A  .specify/integrations/claude.manifest.json
A  .specify/integrations/speckit.manifest.json
AM .specify/memory/constitution.md
A  .specify/scripts/powershell/check-prerequisites.ps1
A  .specify/scripts/powershell/common.ps1
A  .specify/scripts/powershell/create-new-feature.ps1
A  .specify/scripts/powershell/setup-plan.ps1
A  .specify/scripts/powershell/setup-tasks.ps1
A  .specify/templates/checklist-template.md
A  .specify/templates/constitution-template.md
AM .specify/templates/plan-template.md
AM .specify/templates/spec-template.md
AM .specify/templates/tasks-template.md
AM CLAUDE.md
?? .env.example
?? .github/
?? .gitignore
?? .npmrc
?? .prettierignore
?? .prettierrc.json
?? .specify/extensions.yml
?? .specify/extensions/
?? .specify/feature.json
?? .specify/init-options.json
?? .specify/templates/report-template.md
?? .specify/templates/verification-contract-template.md
?? .specify/templates/verification-tasks-template.md
?? .specify/templates/vplan-template.md
?? .specify/workflows/
?? DEPLOY.md
?? LICENSE
?? README.md
?? components.json
?? convert_and_split_docs_to_md_v3_3.py
?? docs/
?? eslint.config.js
?? package.json
?? playwright.config.ts
?? pnpm-lock.yaml
?? pnpm-workspace.yaml
?? reports/
?? scripts/
?? specs/
?? src/
?? static/
?? stryker.config.json
?? svelte.config.js
?? tests/
?? tsconfig.json
?? vite.config.ts
?? vitest.config.ts
?? vitest.ivv.config.ts
```

Last commit: (unknown)

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
