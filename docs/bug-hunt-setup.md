# Adversarial bug-hunt skill setup

This project uses [danpeg/bug-hunt](https://github.com/danpeg/bug-hunt) — a Claude Code skill that runs Hunter / Skeptic / Referee in three isolated agent contexts to find bugs and verify them with low false-positive rate. Source verified 2026-05-23, 138 stars, last push 2026-03-05, MIT license.

## Why this skill specifically (not the others)

I considered three candidates per the testing-strategy review on 2026-05-23:

| Repo                                                                                  | Why rejected for default install                                                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [codexstar69/bug-hunter](https://github.com/codexstar69/bug-hunter)                   | Has an _auto-fix_ mode that contradicts the project rule "show me the diff before applying critical fixes." Could still be used with `--scan-only` if scope expands. |
| [elementalsouls/Claude-BugHunter](https://github.com/elementalsouls/Claude-BugHunter) | Targets bug-bounty / red-team work on deployed applications. Wrong tool for finding logic bugs in code we just wrote.                                                |
| **danpeg/bug-hunt** ✓                                                                 | Pure read-only review, no auto-fix, simplest install, matches the brief exactly.                                                                                     |

## Install (one-time, user-level)

```bash
git clone https://github.com/danpeg/bug-hunt.git ~/.claude/skills/bug-hunt
```

Claude Code auto-discovers skills in `~/.claude/skills/`. No further config needed.

## Use

Inside a Claude Code session:

```
/bug-hunt                              # scan the whole project
/bug-hunt src/lib/app                  # scan a subdirectory
/bug-hunt src/lib/app/payment-drill.ts # scan one file
/bug-hunt -b feature-budget            # scan only files changed on the current branch vs main
```

## How it works (so you can interpret findings)

Three agents in isolated contexts (they can't see each other's reasoning):

1. **Hunter** — biased to over-report. Lists every possible bug.
2. **Skeptic** — biased to dismiss false positives. Tries to disprove each.
3. **Referee** — reads the code fresh and makes the final verdict.

Scoring incentives are calibrated so the Hunter is thorough, the Skeptic is precise (2× penalty for dismissing real bugs), and the Referee is symmetric. The HBR paper this is based on is referenced in the repo's README.

## When to run

- After landing a non-trivial feature on a branch.
- Before merging a PR.
- Whenever something feels "off" in code I just wrote — the Hunter/Skeptic/Referee pattern catches things a single-pass review misses.

The skill is **not run automatically.** You decide when an independent look is worth the time.

## What to do with findings

- **Critical / high**: stop, read the finding, decide whether it's real. Do NOT auto-apply fixes — write a test that exercises the bug first, then fix.
- **Medium**: triage. May be valid but low-priority.
- **Low**: usually false positives or style nits.

False positives are normal — that's why the skill exists in the first place. If a finding doesn't ring true, dismiss it explicitly.

## Updating

```bash
cd ~/.claude/skills/bug-hunt && git pull
```

## Removing

```bash
rm -rf ~/.claude/skills/bug-hunt
```
