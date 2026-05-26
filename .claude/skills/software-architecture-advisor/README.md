# software-architecture-advisor

A Claude Code skill that makes Claude behave like a senior software-solutions architect rather than a junior engineer reaching for popular frameworks. Built for a solo developer working on personal or hobby projects who wants AI to enumerate options, name boring choices, and respect tight constraints instead of defaulting to enterprise-grade stacks.

---

## What this skill is and why it exists

### The problem

When you ask AI "build me a personal money-management tool" or "build me a habit tracker" or "build me a tool that processes CSVs," the AI tends to default to the same stack: Python web app, React frontend, Postgres database, AWS hosting, Docker containers. For a hobbyist project with one user and a $0 budget, those answers are almost always wrong. Better fits — a static HTML page with in-browser storage, a single-binary CLI, a shell script — exist in the AI's training but are systematically under-surfaced because popular-stack tutorials dominate the data.

This is called **mode collapse on popular frameworks**, and it is the recurring pain that motivated this skill.

### The fix

This skill loads two curated reference documents and a per-project constraint template, then routes every software question through a four-step protocol:

1. **KB receipt** — Claude must declare which reference sections it consulted.
2. **Decision log application** — if you supplied a per-project constraint block, Claude honors it.
3. **Clarification gate** — a six-step forced enumeration of constraints, boring choices, and reversibility before any recommendation is allowed.
4. **Final response** — recommendation, reasoning that cites overlay tactics, one follow-up question.

The clarification gate is the load-bearing piece. It prevents Claude from skipping straight to a popular-stack recommendation without first naming the boring baseline and checking its own assumptions.

---

## How to use the skill

### One-time setup

1. Copy this entire `software-architecture-advisor/` directory to `~/.claude/skills/software-architecture-advisor/`. The directory structure must be preserved (do not flatten the `references/` subdirectory).
2. Restart any open Claude Code sessions so the skill is registered.

### Daily usage

You do not need to invoke the skill manually. Claude Code reads the `description` field in `SKILL.md` and routes any matching question (software architecture, stack selection, hosting, storage, deployment, library choice, debugging strategy, build-vs-buy decisions, etc.) through the skill automatically.

For best results on a project you work on more than once:

1. Fill in a copy of `references/decision_log_template.md` once per project, capturing your hard constraints (user count, budget, deployment preferences, hard nos, etc.).
2. Save the filled-in version as `decision_log.md` somewhere in your project, or paste it at the top of your Claude Code conversation when you start a session about that project.
3. Ask your software questions normally. Claude Code applies the skill's protocol automatically.

### Verifying the skill is active

In any Claude Code session, ask: *"What skills do you have loaded for this session?"* Claude will list registered skills. Confirm `software-architecture-advisor` is among them.

If you want to test the skill is actually following its protocol, ask a deliberately under-specified question like *"build me a tool to track my habits."* The response should print a KB receipt, run the clarification gate (six numbered steps), and name a boring choice — NOT jump straight to "use React and a database."

---

## Use cases

Concrete examples of when this skill earns its space:

**Picking a stack for a new personal project.** *"I want to build a tool to organize my photo library. What stack should I use?"* The skill forces Claude to surface static-page or local-desktop options alongside any web-app option, instead of defaulting to React + a database.

**Library or framework selection.** *"What's the best way to handle background jobs in a Python script that runs on my laptop?"* The skill forces Claude to consider cron or a shell loop before suggesting Celery or RQ.

**Hosting decisions.** *"Where should I deploy this small tool I built?"* The skill forces Claude to walk the ownership spectrum from "run it on my laptop" through "static hosting" before reaching managed-cloud options.

**Build-vs-buy and self-host-vs-managed.** *"Should I run my own auth or use a service?"* The skill applies the ownership-axis tactic and forces explicit constraint elicitation before recommending.

**Database and storage choices.** *"What database should I use for a personal note-taking tool?"* The skill forces Claude to consider the file system, SQLite, or in-browser storage before reaching for Postgres.

**Refactoring strategy.** *"How should I refactor this messy codebase?"* The skill applies disconfirming-evidence and force-rank tactics so Claude commits to a recommendation rather than producing a balanced menu.

**Testing strategy for a hobby project.** *"How should I test this?"* The skill forces Claude to weigh "no tests at all" and "a handful of integration tests" against any full-pyramid recommendation, given the solo-developer constraint.

**Debugging help.** *"This thing is broken, here are the symptoms."* The skill applies chain-of-hypotheses prompting (enumerate causes, rank by likelihood and cheapness-to-check) instead of immediately suggesting a fix.

**Choosing between languages.** *"Should I write this in Python, Go, or Rust?"* The skill applies the language-choice and reversibility tactics, surfacing the boring choice (whatever you already know well) before any fancier option.

---

## What this skill does NOT do

- **It does not write code.** It produces architecture recommendations, decisions, and follow-up questions. Once you accept a recommendation, you ask Claude to write the code as a separate step.
- **It does not handle multi-developer team coordination.** The reference material assumes solo-developer context. If you start working with a team, the recipes and defaults shift.
- **It does not handle regulated domains** (healthcare, finance with compliance requirements). The boring-choice bias can mislead in regulated contexts.
- **It does not handle ML/AI engineering as the product.** The skill treats AI as a tool, not as the system being built.

---

## Files inside this skill

```
software-architecture-advisor/
├── SKILL.md                              ← skill entry point (frontmatter + operating protocol)
├── README.md                             ← this file (human-readable intent and usage guide)
├── stress_test_protocol.md               ← procedure for validating the skill works correctly
└── references/
    ├── general_prompting_techniques.md   ← broad prompting reference (47KB)
    ├── software_overlay.md               ← software-specific tactics, clarification gate, recipes (18KB)
    └── decision_log_template.md          ← per-project constraint template
```

- `SKILL.md` is what Claude Code reads to know when to activate the skill and what protocol to follow. The frontmatter `description` field is the trigger.
- `references/` holds the curated material the skill consults. Claude Code loads only the files relevant to each question, so the full size of this directory does not consume tokens on every conversation.
- `stress_test_protocol.md` is for you, not for Claude. It tells you how to verify the skill is actually working as intended (three test cases with explicit pass criteria).

---

## Maintenance

The reference documents are the source of truth. When prompting techniques evolve or you discover new failure modes, update the markdown files in `references/`. The skill picks up changes immediately on the next session.

If you find Claude is bypassing the clarification gate or skipping the KB receipt step, the fix is usually in `SKILL.md` — tighten the "do not skip" language and re-test. Do not edit the reference documents to fix a forcing-mechanism problem; that is the wrong unit of analysis.

---

## If you forget what this skill is for

Read this README, then ask any AI assistant: *"Read SKILL.md and the README.md in this directory and tell me what this skill is for and how I use it."* The skill is intentionally self-documenting; the intent and usage protocol are both encoded in plain English in these two files.

---

## Stress-testing the skill

Before relying on the skill for important decisions, run the three-case stress test in `stress_test_protocol.md`:

1. A web-app-shaped question (photo organizer or similar).
2. A service-shaped question (RSS scheduler or similar).
3. A data-shaped question (CSV processor or similar).

The skill passes if all three responses run the full clarification gate and surface a non-default option (static page, single binary, shell script) in the top recommendations. Re-run the stress test whenever you significantly update the reference documents.
