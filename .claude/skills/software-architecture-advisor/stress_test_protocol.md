# Stress-Test Protocol for the Forcing Meta-Prompt

Before you start relying on the meta-prompt for real software questions, run it through this three-case stress test. The goal is to confirm the wrapper actually forces guide consultation and produces unbiased recommendations across at least three different software shapes, not just the one example that motivated the design.

---

## Setup

1. Open a fresh Claude conversation.
2. Paste the contents of `general_prompting_techniques_research_report.md` into the chat as context. Wait for Claude to acknowledge.
3. Paste the contents of `software_overlay.md` into the chat. Wait for acknowledgment.
4. For each test case below:
   - Paste the meta-prompt from `forcing_meta_prompt.md`.
   - Paste the test question immediately after "USER QUESTION:".
   - Submit.
   - Inspect the response against the pass criteria.
5. Run all three test cases before judging the meta-prompt. Do not iterate on the basis of one case alone.

---

## Test case 1 — Web-app-shaped problem

**Question to paste:**
> Build me a tool that lets me organize and tag my photo library.

**Why this case:** developers (and AI tools) reach for React + Postgres + AWS for "library" or "organize" framings. A good debiased answer surfaces a static page with IndexedDB, or a local desktop tool, alongside any web-app option.

**Pass criteria — all of these must hold:**
- The KB receipt block lists at least one section from the overlay and one from the generic guide, each with a one-line relevance note.
- All 6 clarification-gate steps appear in the response, in order, not collapsed into prose.
- The "boring choice" named at step 4 of the gate is a static page, a local desktop tool, or equivalent — not a React + database stack.
- At least one of the top 2 ranked options in the final response is a static / local / desktop solution.
- If the final response includes a React + Postgres + AWS option, it is explicitly justified against the boring baseline.

**Fail signal:** the response jumps to "build a web app with React, Next.js, and Postgres" without surfacing simpler alternatives, or skips the gate entirely.

---

## Test case 2 — Service-shaped problem

**Question to paste:**
> Build me a tool that fetches articles from RSS feeds on a schedule.

**Why this case:** the default reach is FastAPI + Docker + managed-cloud. A good answer surfaces a single binary + cron + a local machine.

**Pass criteria — all of these must hold:**
- KB receipt + all 6 gate steps run as in case 1.
- The "boring choice" at step 4 is a cron job + a shell script, a single-binary native tool, or a Python script on a laptop — not a containerized service.
- At least one of the top 2 ranked options is a no-server, no-container solution.
- If the response includes a hosted-service option, it is explicitly justified against the boring baseline.

**Fail signal:** response proposes Docker, Kubernetes, or a managed scheduler service as the primary recommendation without justifying it against simpler alternatives.

---

## Test case 3 — Data-shaped problem

**Question to paste:**
> Build me a tool that processes my bank CSV exports into monthly summaries.

**Why this case:** the default reach is Pandas + Jupyter + a managed storage backend. A good answer surfaces a shell script + SQLite, or even a one-liner that pipes through `awk`.

**Pass criteria — all of these must hold:**
- KB receipt + all 6 gate steps run.
- The "boring choice" at step 4 is a shell script, a single Python script with no Pandas, or a SQLite-based approach — not a Jupyter notebook + Pandas pipeline.
- At least one of the top 2 ranked options is a shell-script-or-SQLite solution.
- If the response includes Pandas or a notebook, it is explicitly justified against the boring baseline.

**Fail signal:** response opens with "use Pandas in a Jupyter notebook" without comparing to simpler alternatives.

---

## Interpreting the results

**Passes all 3:** the meta-prompt is load-bearing. Trust the system, start using it for real questions. Periodically re-run the stress test (quarterly is reasonable) to confirm nothing has drifted.

**Passes 2 of 3:** the wrapper is mostly working. Inspect the failing case for the specific gap. Often the fix is a one-line addition to the meta-prompt — for example, "for data-processing tasks, the boring choice is always shell + SQLite unless the data is too large for a single machine."

**Passes 1 of 3:** the wrapper is fragile. Two common root causes:
1. The model is treating the reference documents as decoration. Tighten Step A by demanding the model quote one specific sentence from the relevant overlay section, not just name the section.
2. The clarification gate is being collapsed into prose. Tighten the "do not collapse into prose" line in the gate itself (it lives in the overlay) and re-paste the overlay before re-testing.

**Passes 0 of 3:** something is structurally wrong. Most likely the reference documents are not actually being loaded into context (verify by asking Claude "what reference documents do you have access to in this conversation?" before running the test). If they are loaded and still ignored, the meta-prompt itself needs a rewrite — likely a stronger Step A that requires the model to quote, not just summarize, the relevant sections.

---

## What NOT to iterate on

- **Do not iterate on the guides.** They are reference material. The meta-prompt is what routes attention to them.
- **Do not iterate on the test cases.** The point of fixing the cases is to catch overfitting to your favorite scenario. If you change the cases to make them pass, you are overfitting.
- **Do not declare success after a single passing run.** Run each case twice if the result looks borderline; LLM responses have some variance.

---

## Substituting your own test cases

The three cases above are deliberately abstract (someone-else's photos, someone-else's RSS feeds, someone-else's bank CSVs) to confirm the meta-prompt generalizes beyond any project you are personally invested in. If you have three real upcoming projects, you can substitute them — but keep the same shape diversity: one web-app-default, one service-default, one data-default. Otherwise the test loses its bias-detection value.
