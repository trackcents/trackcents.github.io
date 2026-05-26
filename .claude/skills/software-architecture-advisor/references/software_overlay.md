# Software Engineering Overlay to the Generic Prompting Guide

A companion document for a hobbyist developer running a one-person solutions company with AI as architect, developer, and tester.

---

## Section 1: Purpose and scope

This overlay assumes you've read the generic prompting guide. It adds only what's specific to software engineering work — the tactics that matter when you're picking stacks, designing systems, and shipping code as a solo operator. Where the generic guide already covers a topic well, this document defers to it (see Section 3) rather than restating.

The reader is presumed to be working across the full lifecycle alone: scoping, architecting, building, testing, deploying, and maintaining. That context shapes everything below — particularly a bias toward boring choices, reversibility, and honest cost accounting, since you personally absorb the consequences of every decision.

---

## Primary deliverable: clarification gate

Paste the block below verbatim above any software question you ask the AI. It is sized to stay under 300 words so it fits comfortably as a preface.

```
Before answering my question below, run this gate. Do not produce a recommendation, design, or code until the gate is complete.

1. Restate my question in one sentence. If you cannot restate it without guessing, ask before continuing.

2. List the hard constraints you are inferring rather than reading directly from my prompt. Cover at minimum:
   - Budget (one-time and monthly)
   - Team size and ops tolerance (assume 1 developer unless I say otherwise)
   - Expected scale at 3 months and 12 months
   - Latency or responsiveness requirements
   - Data sensitivity and lock-in tolerance
   - Reversibility appetite (am I prototyping or committing?)
   - Distribution model (who runs this, on what)

3. For each inferred constraint, mark it [confirmed by prompt], [inferred — likely], or [inferred — guessing]. If three or more are [guessing], STOP — produce ONLY the questions block and END the response. Do NOT continue to steps 4, 5, or 6 in this turn. Do NOT produce a recommendation. Wait for the user's next message before resuming. Prefer questions whose answers most change your recommendation.

4. Name the most boring, stable option that has been working for this class of problem for 10+ years. State it even if you think I want something fancier. Any fancier recommendation must be justified against this baseline.

5. Rate the reversibility of the core decision: trivial / weekend / month-long migration / effectively permanent. Spend deliberation budget proportionally.

6. Only now produce your answer. Lead with your recommendation in one sentence, then the reasoning, then anything I should ask you next.

Do not skip steps. Do not collapse them into prose. If a step is genuinely N/A for my question, say so explicitly and why.
```

### Commentary on the design choices

A few things are doing real work in there and are worth flagging so you can tune the block over time.

**Restating first.** Step 1 catches the most expensive failure mode — the model confidently answering a question adjacent to the one you asked. Forcing a one-sentence restatement surfaces that misread before any tokens are spent on a recommendation.

**Marking inference confidence.** The three-tier tagging (`[confirmed]` / `[inferred — likely]` / `[inferred — guessing]`) is more useful than a binary "did you assume anything." It gives you a scannable signal for where to push back without re-reading the model's whole reasoning. The threshold of three `[guessing]` tags before a forced pause is a heuristic — tighten to two if you find the model still steamrolling past weak inferences.

**Defaults baked into the constraints.** "Assume 1 developer unless I say otherwise" and the explicit 3-month / 12-month scale framing are there because the model's untouched defaults assume a team and a growth curve you don't have. Encoding your actual reader profile once in the gate beats restating it in every prompt.

**Boring choice before reversibility.** The ordering matters. Naming the boring option first gives the reversibility check something concrete to react to — "is the fancier option's irreversibility justified by the gap to the boring baseline?" Reversed, the model tends to rate reversibility in the abstract and then forget about it.

**No code, no recommendation until step 6.** This is the load-bearing constraint. Without it the model will produce the answer alongside the gate steps as a courtesy, and the gate becomes decoration.

**Why "do not collapse into prose."** Models compress structured checklists into flowing paragraphs when they think the user wants a polished answer. The compression hides skipped steps. Explicit anti-compression language preserves the audit trail.

---

## Section 2: Software-specific tactics

### 1. Constraint-first framing
**When to use:** any request where the model could plausibly produce ten valid answers because you haven't told it what "good" means. Especially relevant for architecture questions, library picks, and "how should I structure X."

**One-line prompt fragment:** "Before recommending anything, restate the hard constraints (budget, latency, team size = 1, ops tolerance, data sensitivity, lock-in tolerance) and flag any you're inferring rather than reading from my prompt."

### 2. Force-rank N options (with "second-best choice" as a variant)
**When to use:** when you want the model to commit rather than hedge. The model's natural tendency is to present options as a balanced menu; ranking forces a position. The second-best variant is for when the top choice is obvious and the interesting information is what's behind it.

**One-line prompt fragment:** "Give me your top 3 ranked, with a one-sentence reason each. Then tell me your second-best choice and what would make me prefer it over your first."

### 3. Name the boring choice explicitly
**When to use:** any greenfield stack pick, library choice, or deployment decision where the model is likely to surface a trending option as the default.

**One-line prompt fragment:** "Before recommending, name the most boring/stable option for this problem — the one that's been working for 10+ years. Justify any fancier choice against that baseline."

### 4. Trade-off table
**When to use:** when you're comparing 3+ concrete options across multiple axes and prose comparisons are getting muddled. Best for decisions you'll revisit or need to justify later.

**One-line prompt fragment:** "Compare these options as a table with rows = options, columns = [setup cost, ongoing cost, ops burden, lock-in, ceiling]. One short cell each, no hedging."

### 5. Disconfirming evidence ("what would make you not pick this?")
**When to use:** after the model has recommended something and you want to stress-test it. Distinct from #4 because the table surfaces known axes; this surfaces the reasons the recommendation could be wrong.

**One-line prompt fragment:** "For your top recommendation, list 3 specific conditions or facts about my situation that would flip you to a different choice. Be concrete — 'if you have >X users' not 'at scale.'"

### 6. Ownership axis (build-vs-buy and self-host-vs-managed as one spectrum)
**When to use:** any time you're choosing how much of a capability to own. Treating build/buy and self-host/managed as one spectrum (write-from-scratch → OSS-you-host → OSS-managed-for-you → SaaS) avoids the common trap of debating "build vs buy" without considering the middle.

**One-line prompt fragment:** "Place this capability on the ownership spectrum from 'write it myself' to 'pure SaaS,' with one concrete option at each rung. Recommend the rightmost rung that doesn't violate my constraints."

### 7. Reversibility ladder and scale-and-cost elicitation (paired)
**When to use:** before any decision that's hard to undo (data model, auth provider, hosting platform, framework). Paired because reversibility and projected scale together determine how much deliberation a choice deserves — a reversible choice at any scale is cheap; an irreversible one at low scale is still cheap if you're honest about the scale.

**One-line prompt fragment:** "Rate this decision's reversibility (trivial / weekend / month-long migration / effectively permanent), then ask me 2 sharp questions about scale and cost ceilings before recommending — don't assume."

---

## Section 3: Deferral to the generic guide

**Role prompting.** See generic guide §Role Assignment. Software-specific addendum: roles like "senior backend engineer" or "site reliability engineer" usefully shift defaults toward production concerns; "library author" shifts toward API ergonomics.

**Few-shot examples.** See generic guide §Few-Shot Prompting. Software-specific addendum: for code style and naming conventions, two examples from your existing codebase beat any prose description.

**Chain-of-thought / step-by-step reasoning.** See generic guide §Chain-of-Thought. Software-specific addendum: for debugging, ask the model to enumerate hypotheses before testing any of them, then rank by likelihood and cheapness-to-check.

**Output format specification.** See generic guide §Output Formatting. Software-specific addendum: ask for unified diffs rather than full file rewrites when iterating on existing code — easier to review, easier to apply, less context churn.

**Length control.** See generic guide §Response Length. Software-specific addendum: "no preamble, no postamble — just the code and a one-line summary of what changed" works well for iterative work.

**Asking for clarification.** See generic guide §Clarifying Questions. Software-specific addendum: explicitly grant the model permission to ask before producing code ("ask up to 3 questions if you're guessing about anything that would change the design") — its default is to guess.

*(Persona / tone removed — no software-specific addendum.)*

---

## Section 4: Recipe appendix

Fifteen scenarios, weighted away from the default web-app-with-managed-database assumption that AI tools tend to drift toward.

### Web / hosted (3)

**R1 — Internal admin dashboard for a side business.** Constraint-first + boring choice. Likely lands on server-rendered templates over a SPA; SQLite or Postgres over anything fancier.
*Prompt fragment:* "This is a 1-user internal tool, no public surface, will run for years with near-zero changes. Pick the boring stack."

**R2 — Public marketing site with a contact form.** Boring choice + ownership axis. Static site generator + a form-handling service beats a full web framework.
*Prompt fragment:* "Place the form handler on the ownership spectrum and pick the rightmost rung — I don't want to maintain a backend for one form."

**R3 — Multi-tenant SaaS prototype (paying customers within 3 months).** Reversibility ladder + scale-and-cost. Forces honest conversation about auth, billing, and data isolation before code.
*Prompt fragment:* "Rank these decisions by reversibility: auth provider, billing provider, database schema, hosting region. Tell me which 2 deserve the most deliberation now."

### Local / CLI / native / desktop (6)

**R4 — Personal knowledge-base CLI over local markdown files.** Boring choice. Ripgrep + a thin wrapper beats anything involving embeddings for most use cases.
*Prompt fragment:* "Name the boring version of this that uses grep and the filesystem before suggesting anything with a vector store."

**R5 — Cross-platform desktop app for managing a personal collection.** Ownership axis + trade-off table. Native toolkit vs Electron vs Tauri vs web-app-pretending-to-be-desktop.
*Prompt fragment:* "Trade-off table across native, Electron, Tauri, and 'just a local web server' — columns = binary size, distribution friction, dev velocity, OS integration."

**R6 — Long-running background sync daemon on the developer's own machine.** Reversibility + disconfirming evidence. systemd / launchd / Task Scheduler vs a userspace loop.
*Prompt fragment:* "What would make you not recommend systemd here? Be specific about my situation."

**R7 — One-off data migration script (run once, then deleted).** Constraint-first. The constraint is "I will run this once" — no tests, no abstractions, no config files.
*Prompt fragment:* "Hard constraint: this runs once and gets deleted. Optimize for read-it-and-trust-it, not reusability."

**R8 — TUI for a workflow the developer does dozens of times a day.** Boring choice + force-rank. Probably a shell function or alias before any TUI framework.
*Prompt fragment:* "Top 3 ranked, including 'don't build a TUI, just write a shell function' as an option."

**R9 — Local-first note-taking tool with sync as an optional later feature.** Reversibility ladder. Data format decisions dominate; sync mechanism is reversible, file format is not.
*Prompt fragment:* "Rank decisions by reversibility. I want to spend deliberation budget on the irreversible ones."

### Cross-cutting: data, testing, deployment-agnostic (4)

**R10 — Choosing a data format for inter-tool exchange (JSON / SQLite / Parquet / plain text).** Trade-off table + disconfirming evidence.
*Prompt fragment:* "Table across these four. Then: what facts about my data volume or access patterns would flip your recommendation?"

**R11 — Test strategy for a project with no existing tests.** Force-rank + constraint-first. Constraint is "solo developer, finite attention." Likely outcome: a handful of integration tests over a pyramid.
*Prompt fragment:* "Given 1 developer and ~2 hours/week for tests, rank strategies by ROI."

**R12 — Picking a deployment target without committing to a cloud.** Ownership axis. Bare VM → container on a VM → managed container → PaaS → serverless.
*Prompt fragment:* "Walk the ownership spectrum from bare VM to serverless. Recommend the rightmost rung that doesn't lock my code shape to a vendor."

**R13 — Observability for a small system (one app, one database).** Boring choice + scale-and-cost. Logs to a file and a cron'd grep beats a full observability stack for many real systems.
*Prompt fragment:* "Boring version first. Ask me about volume before recommending anything that costs money monthly."

### Anti-default (2)

**R14 — Habit tracker, normally shipped as a web app, built as a static HTML page with IndexedDB.** Productivity tool. No accounts, no backend, no hosting bill, no privacy concerns.
*Prompt fragment:* "Build this as a single HTML file with in-browser storage. Justify any deviation from that against the baseline of zero infrastructure."

**R15 — Webhook receiver that normalizes and forwards events, normally shipped as a hosted service, built as a single Go/Rust binary the developer runs on a home server or VPS.** Developer tool. No container, no orchestrator, no platform — one binary, one systemd unit.
*Prompt fragment:* "Single-binary version first. What would make me regret not using a managed service? Be specific."

*(A data-utility anti-default isn't called out separately because R7 and R10 together cover the "don't reach for a pipeline framework when a script will do" pattern.)*

---

## Section 5: Coverage and limits

**What this overlay covers well.** Solo-developer decision-making at the architecture and stack-selection layer. Greenfield choices where the model's defaults are likely to mislead. The recurring problem of overshooting infrastructure for the actual workload. Honest reversibility and cost conversations before code is written.

**What it covers partially.** Code-level prompting (style, refactoring, debugging) is handled mostly by deferral to the generic guide. The software-specific addenda there are real but thin — a dedicated code-prompting overlay would be a separate document.

**What it doesn't cover.**

- **Multi-developer coordination.** Code review prompts, PR description templates, onboarding docs, conventions-for-a-team — all out of scope by the reader assumption.
- **Regulated domains.** Healthcare, finance, anything with auditability or compliance requirements changes the constraint set enough that the boring-choice bias can mislead. The tactics still apply; the recipes don't.
- **ML/AI engineering as the product.** The overlay treats AI as the tool, not the system being built. Building ML systems brings in dataset, evaluation, and drift concerns this document doesn't address.
- **Performance-critical / systems programming work.** The "boring choice" bias is sometimes wrong here — the boring choice in systems work is often "write it in C," which is rarely what a hobbyist solo developer wants. A separate overlay would invert several defaults.
- **Mobile (iOS / Android native).** Distribution, review, and platform-lock-in dynamics are different enough that R5's framing is insufficient.

**What would change the recipe set.**

- If the reader were on a team rather than solo, recipes would shift toward coordination artifacts (ADRs, runbooks, review checklists) and the ownership-axis tactic would weight differently — managed services get cheaper when there's no one to be on-call.
- If the reader had a deadline-driven commercial context rather than hobbyist, the anti-default recipes (R14, R15) would be deprioritized and reversibility would weight higher than boringness.
- If the assumed AI tool changed from a general chat model to a coding-agent-with-execution, the deferral section would shrink (the generic guide assumes less tool use) and recipes would gain a "what does the agent verify before declaring done" column.
- If the reader's domain narrowed (e.g., "solo developer building data tools") the recipe distribution would re-weight toward that domain rather than spanning productivity / developer / data tools as it currently does.
