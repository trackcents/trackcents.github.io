# Spec-Kit Deep Study & VeriKit Comparison Blueprint

> **Audience:** the autonomous overnight VeriKit build.
> **Author:** principal-architect study of GitHub Spec-Kit v0.8.13 as installed in this repo, compared to the in-progress VeriKit / IV&V tooling.
> **Goal:** extract exactly *how* spec-kit achieves persisted ticking task state, "where-are-we?" survivability, and project-genericity, then specify how VeriKit must adopt those mechanics, where VeriKit must be *better*, and how the two integrate.
> **Date:** 2026-05-23.

This document is descriptive of spec-kit and prescriptive for VeriKit. Every spec-kit claim below is grounded in a real file in this repo (path cited). No files were modified to produce it except this blueprint.

---

## Part A — Spec-Kit architecture map (line-by-line study)

### A.0 The three pillars spec-kit is loved for

1. **Persisted, ticking task state** — a markdown checklist on disk (`tasks.md`) whose `[ ]`→`[X]` flips survive context compaction because they live in a file, not in the model's context.
2. **"Where are we?" survivability** — state is reconstructable from a small, fixed set of on-disk artifacts (`spec.md` / `plan.md` / `tasks.md` + a pinned feature dir in `.specify/feature.json`), and `/speckit-implement` resumes purely by re-reading them.
3. **Project genericity** — nothing is hard-coded to a stack; portability comes from the triad **templates + scripts + slash-commands**, parameterized by feature directory, branch, and JSON hand-offs.

The rest of Part A documents each precisely.

---

### A.1 File inventory and roles

Spec-kit installs into two trees: `.specify/` (data, scripts, templates, config) and `.claude/skills/speckit-*/` (the slash-command prompts). The split matters: **`.claude/` is the agent-facing command surface; `.specify/` is the portable engine + state.**

#### `.claude/skills/speckit-*/SKILL.md` — the slash commands (the workflow state machine)

Each is a markdown prompt with YAML frontmatter (`name`, `description`, `argument-hint`, `user-invocable: true`). The verbs and their roles:

| Command | Role | Reads | Writes | Source of truth file |
|---|---|---|---|---|
| `/speckit-constitution` | create/update project principles | interactive input | `.specify/memory/constitution.md` | constitution.md |
| `/speckit-specify` | NL feature description → spec | `spec-template.md` | `specs/<dir>/spec.md`, `checklists/requirements.md`, `.specify/feature.json` | spec.md |
| `/speckit-clarify` | ≤5 targeted questions, encode answers back into spec | spec.md | spec.md (adds `## Clarifications`) | spec.md |
| `/speckit-plan` | spec → design artifacts + constitution gate | spec.md, constitution.md, `plan-template.md` | `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` | plan.md |
| `/speckit-tasks` | design → dependency-ordered task list | plan.md, spec.md, +optional docs, `tasks-template.md` | `tasks.md` | tasks.md |
| `/speckit-analyze` | cross-artifact consistency audit (READ-ONLY) | spec/plan/tasks/constitution | nothing (report only) | — |
| `/speckit-checklist` | "unit tests for English" — requirements-quality checklists | spec/plan/tasks | `checklists/<domain>.md` | checklist files |
| `/speckit-implement` | execute tasks.md, tick `[X]` as it goes | ALL artifacts | source code + edits `tasks.md` checkboxes | tasks.md (mutated) |
| `/speckit-taskstoissues` | tasks.md → GitHub issues | tasks.md | GitHub (via MCP) | — |
| `/speckit-git-*` | branch/commit/init/remote/validate helpers (the "git extension") | git | git | — |

Key observation: **every command except `analyze` and the git helpers is anchored on one canonical artifact file it owns.** That one-file-per-phase ownership is what makes state legible.

#### `.specify/templates/*.md` — the portable document skeletons

- `spec-template.md` — user-story-first (`### User Story N (Priority: PN)` with **Independent Test** + Given/When/Then acceptance), `### Functional Requirements` (`FR-001` IDs), `### Measurable Outcomes` (`SC-001` IDs). Critically: **technology-agnostic by mandate** ("Avoid HOW to implement"). This repo's copy also has a project-specific `## Constitutional Posture` block appended — proof the template is an override point.
- `plan-template.md` — `## Technical Context`, a `## Constitution Check` **gate** (a checklist of principle boxes that must be ticked or justified in `## Complexity Tracking`), `## Project Structure`. The plan is where the abstract spec meets the concrete stack.
- `tasks-template.md` — the **ticking checklist format** (see A.2). This repo appended a **`## Phase Z: Verification gate`** that injects `/ivv` + `/validate` + `/verify` + `/bug-hunt` tasks into *every* feature — proof that verification was bolted on at the template layer.
- `checklist-template.md` — `CHK001`-numbered items, `[ ]` checkboxes.
- `constitution-template.md` — placeholder-token (`[PRINCIPLE_1_NAME]`) skeleton the constitution command fills.
- `verification-contract-template.md` — *(VeriKit/IV&V addition, not stock spec-kit)* the implementation-free contract handed to the VE.

#### `.specify/scripts/powershell/*.ps1` — the portable engine

These are the **deterministic, language-of-the-host glue** the slash commands shell out to. They do path resolution, branch math, and template copying so the *prompt* never has to hard-code a path. (See A.3 for the exact mechanics.)

- `common.ps1` — the shared library: `Get-RepoRoot`, `Get-CurrentBranch`, `Get-FeaturePathsEnv` (the central path resolver), `Resolve-Template` (the override stack), `Test-FeatureBranch`.
- `create-new-feature.ps1` — invoked by the `before_specify` git hook; computes next branch number, creates branch + `specs/<NNN-slug>/`, copies `spec-template.md`.
- `setup-plan.ps1` — copies `plan-template.md` → `plan.md`, emits JSON of paths.
- `setup-tasks.ps1` — resolves `tasks-template.md` through the override stack, emits `FEATURE_DIR` + `AVAILABLE_DOCS` + `TASKS_TEMPLATE` JSON.
- `check-prerequisites.ps1` — the universal pre-flight: validates feature dir + plan (+ optionally tasks) exist, emits `FEATURE_DIR` + `AVAILABLE_DOCS` JSON. Modes via flags: `-Json`, `-RequireTasks`, `-IncludeTasks`, `-PathsOnly`.

#### `.specify/` config & state JSON

- `.specify/feature.json` — `{ "feature_directory": "specs/001-money-tracker-mvp" }`. **This single file is the "active feature" pointer** that decouples downstream commands from git branch names.
- `.specify/init-options.json` — install-time choices: `branch_numbering: sequential|timestamp`, `context_file: CLAUDE.md`, `integration: claude`, `script: ps`.
- `.specify/integration.json` + `integrations/*.manifest.json` — which AI integration is installed (`claude`), and SHA-256 hashes of every installed file (tamper/version tracking).
- `.specify/extensions.yml` — the **hook registry** (see A.4).
- `.specify/workflows/workflow-registry.json` — names the bundled `speckit` workflow ("specify → plan → tasks → implement with review gates").

---

### A.2 The exact `tasks.md` ticking convention (quote-precise)

This is the heart of what the user loves. From `tasks-template.md` and the real `specs/001-money-tracker-mvp/tasks.md`:

**Format line (verbatim from `tasks-template.md`):**
```
## Format: `[ID] [P?] [Story] Description`
```

**The strict checklist grammar (verbatim from `speckit-tasks/SKILL.md`):**
```
- [ ] [TaskID] [P?] [Story?] Description with file path
```
with these components, in this order:
1. **Checkbox** — ALWAYS `- [ ]` (markdown checkbox).
2. **Task ID** — sequential `T001`, `T002`, … *in execution order*.
3. **`[P]`** — present ONLY if parallelizable (different files, no incomplete-task deps).
4. **`[Story]`** — `[US1]`, `[US2]`… REQUIRED on user-story-phase tasks, ABSENT on Setup/Foundational/Polish.
5. **Description** — clear action **with an exact file path**.

Spec-kit's own correct/wrong examples (verbatim):
```
✅ - [ ] T012 [P] [US1] Create User model in src/models/user.py
❌ - [ ] Create User model          (missing ID and Story label)
❌ - [ ] T001 [US1] Create model    (missing file path)
```

**Phase grouping (verbatim structure):**
- `## Phase 1: Setup (Shared Infrastructure)`
- `## Phase 2: Foundational (Blocking Prerequisites)` — `**⚠️ CRITICAL**: No user story work can begin until this phase is complete`
- `## Phase 3+:` one phase **per user story in priority order**, each carrying a `**Goal**:` and an `**Independent Test**:` line, then optional `### Tests for User Story N` then `### Implementation for User Story N`.
- `## Phase N: Polish & Cross-Cutting Concerns`
- Each phase ends with a `**Checkpoint**:` line stating what is now demonstrable.

**The ticking mechanism (verbatim from `speckit-implement/SKILL.md` step 8):**
> **IMPORTANT** For completed tasks, make sure to mark the task off as `[X]` in the tasks file.

And the real artifact shows it working — `specs/001-money-tracker-mvp/tasks.md` mixes done and pending:
```
- [x] T001 Initialize SvelteKit project ...
- [ ] T041 [P] [US2] Write Vitest tests at tests/unit/app/checksum.test.ts ...
```

**Why this survives compaction:** the checkbox state is a *byte on disk in `tasks.md`*, not a fact in the model's context window. When context is compacted/lost, the next `/speckit-implement` invocation re-reads `tasks.md`, sees which lines are `[x]` vs `[ ]`, and resumes at the first `[ ]`. The model is stateless across the gap; the file is the state. This is the single most important mechanic for VeriKit to copy.

**Auxiliary on-disk state in the same convention:** `checklists/*.md` use `CHK001` items with the same `[ ]`/`[x]` flips, and `/speckit-implement` step 2 *counts* them (`Total / Completed / Incomplete`) and gates on completeness before implementing. So spec-kit already has a precedent for "a checklist that gates the next phase" — exactly the shape VeriKit's cover-point checklist needs.

---

### A.3 Genericity & "where-are-we?" — the path-resolution machinery

Spec-kit is project-agnostic because **the slash-command prompts never contain a hard-coded path**; they shell out to scripts that compute paths and hand them back as JSON. The flow is identical for every command:

1. The SKILL says: *"Run `.specify/scripts/powershell/<x>.ps1 -Json` from repo root and parse JSON for FEATURE_DIR / IMPL_PLAN / …"*.
2. `common.ps1::Get-RepoRoot` finds the project root by walking **up** for a `.specify/` directory (NOT git — deliberately, so a sub-project inside a larger git repo still works; see `Find-SpecifyRoot`).
3. `common.ps1::Get-FeaturePathsEnv` resolves the **active feature directory** by a 3-tier priority (verbatim from `common.ps1`):
   > 1. `SPECIFY_FEATURE_DIRECTORY` env var (explicit override)
   > 2. `.specify/feature.json` `feature_directory` key (persisted by `/speckit.specify`)
   > 3. Branch-name-based prefix lookup
   then derives `FEATURE_SPEC`, `IMPL_PLAN`, `TASKS`, `RESEARCH`, `DATA_MODEL`, `QUICKSTART`, `CONTRACTS_DIR` by `Join-Path`.
4. The script `ConvertTo-Json -Compress` emits the paths; the prompt parses them and proceeds.

This indirection is *the* portability trick: **the prompt knows the artifact's role (`tasks.md`), the script knows its location.** Move the repo, rename the branch, run on Windows or POSIX (there's a parallel `scripts/bash/`), and the prompts are unchanged.

**`check-prerequisites.ps1` is the "where-are-we?" oracle.** Any phase can call it with `-Json -RequireTasks -IncludeTasks` and learn, in one shot: does the feature dir exist? is there a plan? a tasks file? which optional docs (`research.md`, `data-model.md`, `contracts/`, `quickstart.md`) are present? That single JSON answer reconstructs the entire feature state from disk — no memory needed.

**Template override stack (`Resolve-Template`, verbatim priority):**
```
1. .specify/templates/overrides/<name>.md   (project override — wins outright)
2. .specify/presets/<id>/templates/<name>.md (installed presets, sorted by .registry priority)
3. .specify/extensions/<id>/templates/<name>.md
4. .specify/templates/<name>.md              (core)
```
plus `Resolve-TemplateContent` supports composition strategies (`prepend` / `append` / `wrap` with a `{CORE_TEMPLATE}` placeholder). **This is how a project customizes a template without forking spec-kit** — e.g. this repo appended `## Phase Z` to tasks and `## Constitutional Posture` to spec without touching upstream. VeriKit needs an equivalent.

---

### A.4 The hook / extension system (`extensions.yml`)

Each SKILL has identical **Pre-Execution** and **Post-Execution** hook-scan blocks. The contract (verbatim from `speckit-specify/SKILL.md`):
- Read `.specify/extensions.yml`; look under `hooks.before_<phase>` / `hooks.after_<phase>`.
- Skip hooks with `enabled: false`; treat missing `enabled` as enabled.
- Do **not** evaluate `condition` expressions in the prompt (leave to the HookExecutor); if a non-empty `condition` exists, skip.
- Map command dots→hyphens: `speckit.git.commit` → `/speckit-git-commit`.
- `optional: true` → print an "Optional Hook" the user *may* run; `optional: false` → "Automatic Hook", `EXECUTE_COMMAND`, wait for result.

The installed `extensions.yml` wires the **git extension** into every phase: `before_specify` → `speckit.git.feature` (mandatory, creates the branch), `before_constitution` → `speckit.git.initialize`, and `after_<everything>` → optional `speckit.git.commit`. **This is the integration seam VeriKit should hook into** (an `after_implement` hook that fires `/verikit-verify`). See Part D.

---

### A.5 The workflow state machine (hand-offs)

```
/speckit-constitution → constitution.md          (principles, once per project)
        │
/speckit-specify  ───► spec.md  + feature.json   (WHAT/WHY; tech-agnostic)
        │              + checklists/requirements.md (auto self-validation)
/speckit-clarify  ───► spec.md  (++ ## Clarifications)   (≤5 Qs, optional)
        │
/speckit-plan     ───► plan.md + research.md + data-model.md + contracts/ + quickstart.md
        │              (Constitution Check gate; HOW)
/speckit-tasks    ───► tasks.md  (dependency-ordered, phase-grouped, ticking checklist)
        │
/speckit-analyze  ───► (read-only consistency report across spec/plan/tasks)   (optional gate)
        │
/speckit-implement ──► source code + ticks tasks.md [ ]→[X]   (resumable)
```

Each arrow is a file hand-off; each command re-derives its inputs from disk via `check-prerequisites.ps1`. The model carries *no* cross-command state. **That statelessness-via-files is the whole architecture.**

---

## Part B — What VeriKit must adopt from spec-kit

VeriKit today (`verikit/STATUS.md`, `.claude/agents/verification-engineer.md`, `.claude/skills/ivv/SKILL.md`) is a powerful *engine* but is **missing the persisted-state and portability layer** that makes spec-kit beloved. The IV&V flow runs in one big orchestration and emits a one-shot report to `reports/ivv/`; there is no on-disk, ticking, resumable verification state. Adopt the following.

### B.1 A persisted, ticking, on-disk `verification-plan.md` (the vplan as a *living checklist*, not a one-shot report)

The VE already produces a vplan (`specs/<feature>/verification/<module>.vplan.md`) in PLAN mode — but today it's a static enumeration. **Make it a ticking artifact in spec-kit's exact grammar**, owned by the verification flow the way `tasks.md` is owned by implement:

```markdown
# Verification Plan: <module>

**Module**: src/lib/app/budget-window.ts   **Risk tier**: P0   **Contract**: ...contract.md

## Phase V1: Cover-point closure (functional coverage)
- [ ] V001 [CP] n=0 (empty input) — directed
- [ ] V002 [CP] n=1 — directed
- [ ] V003 [CP] [INV2] amount-blindness — metamorphic (scale all amounts ×k)
- [ ] V004 [CP] year-wrap boundary 12/28→01/27 — directed
- [ ] V005 [CP] [R3] error path: month outside 1–12 throws — directed

## Phase V2: Oracle-independent checks
- [ ] V010 [MR] permutation-invariance — metamorphic
- [ ] V011 [GOLD] hand-derived: window(2026-02) = {…}  (arithmetic shown)

## Phase V3: Fuzz / adversarial (parsers & ingest only)
- [ ] V020 [FUZZ] malformed amount strings never crash, never emit float — corpus seeded
- [ ] V021 [FUZZ] rerun persisted corpus tests/ivv/corpus/<module>/

## Phase V4: Fault-injection sign-off
- [ ] V030 [MUT] mutation score ≥ 80 on DUT
- [ ] V031 [MUT] reference-model self-mutation → scoreboard FAILS (bench has teeth)
```

**Label vocabulary** (VeriKit's analogue of spec-kit's `[P]`/`[US1]`): `[CP]` cover-point, `[INV#]`/`[R#]` traceability to the contract, `[MR]` metamorphic relation, `[GOLD]` hand-derived golden, `[FUZZ]` fuzz lens, `[MUT]` mutation. Same `- [ ]`→`- [x]` flip. Same "exact path / concrete input in the description."

**Why this is the headline adoption:** a cover point that has been *closed* (its bin hit in the run) flips to `[x]`. If the session is compacted or the EXECUTE pass is interrupted, the next invocation re-reads `verification-plan.md`, sees which cover points already closed, and resumes at the first `[ ]`. This makes the *expensive* EXECUTE pass resumable, which spec-kit's design proves is the right shape and the current IV&V flow lacks. The `CoverageModel` (`tests/_framework/coverage-model.ts`) already computes closure %; the new step is to **reflect each closed bin back into the markdown checkbox on disk** so it survives the model losing context.

### B.2 A `verification-tasks.md` (the IV&V flow's own phase checklist)

Separately from the cover-point plan, give the *orchestration* a ticking task list mirroring the 7 IV&V phases — so a half-finished `/ivv` run is resumable:

```markdown
# Verification Tasks: <module>
- [x] VT001 Phase 0 — preconditions green (pnpm check && pnpm test)
- [x] VT002 Phase 1 — wrote contract specs/<f>/verification/<module>.contract.md
- [x] VT003 Phase 2 — PLAN pass: vplan + ambiguity list produced
- [ ] VT004 Phase 3 — PLAN gate: ambiguities triaged/escalated  ← RESUME HERE
- [ ] VT005 Phase 4 — EXECUTE pass: environment built + run
- [ ] VT006 Phase 5 — discrepancies triaged
- [ ] VT007 Phase 6 — accepted tests promoted to tests/unit/independent/
- [ ] VT008 Phase 7 — report written to reports/ivv/
```

This is the direct analogue of `tasks.md`. The IV&V SKILL already has the 7 phases; it just doesn't persist *which phase it's on*. A `verification-tasks.md` fixes that with zero new methodology — pure spec-kit mechanics applied to verification.

### B.3 A generic templates + scripts + slash-command structure (install into ANY repo)

Spec-kit installs via a copy-the-engine model. VeriKit must do the same so it stops being money-project-specific. Required pieces, each modeled on a spec-kit counterpart:

- **`verikit/templates/`** — `verification-contract-template.md` (exists; generalize it — strip money/bigint assumptions into an optional language pack), `vplan-template.md` (NEW — the ticking checklist skeleton from B.1), `verification-tasks-template.md` (NEW — B.2).
- **`verikit/scripts/powershell/` + `verikit/scripts/bash/`** — `vk-common.ps1` (clone of `common.ps1`'s `Get-RepoRoot` / path resolver, but resolving `verification-plan.md` / `verification-tasks.md` / `<module>.contract.md` under `specs/<feature>/verification/`), `vk-check-prerequisites.ps1` (the "where-are-we?" oracle: does a contract exist? a vplan? how many cover points are closed?), `vk-setup-verification.ps1` (copy templates into place, emit JSON paths). **These must be cross-platform (ps + sh) exactly as spec-kit ships both.**
- **`verikit/skills/`** — `verikit-verify/SKILL.md` (the generalized `/ivv` orchestrator, plan-gate-then-execute), and the resumability logic that ticks the checklists.
- **`verikit/agents/verification-engineer.md`** — generalized (de-money-fied) VE charter.
- **`verikit/install.ps1` / `install.sh` / `install.md`** — copy `agents/` → target `.claude/agents/`, `skills/` → `.claude/skills/`, `templates/` + `scripts/` → target `.specify/` (or a VeriKit-owned `.verikit/`). Write a `verikit.json` manifest with file SHA-256s (mirroring `integrations/*.manifest.json`) for version/tamper tracking. Register an `after_implement` hook in the target's `.specify/extensions.yml` (Part D).

The portability principle to copy verbatim: **slash-command prompts never hard-code paths; they call a script that resolves them and returns JSON.** VeriKit's current SKILL embeds `tests/ivv/`, `vitest.ivv.config.ts`, `tests/_framework/`, and PowerShell-with-hardcoded-`C:\Program Files\nodejs` — all of which are *this repo's* specifics. Those must move behind a `vk-check-prerequisites` script + a per-project `verikit.config.json` (where the test runner, framework dir, quarantine dir, and mutation command are declared once).

### B.4 A "where are we?" resume story for verification

Concretely, a `/verikit-verify --resume` (or a bare re-invocation) must:
1. Run `vk-check-prerequisites.ps1 -Json` → learn the active feature dir + which verification artifacts exist.
2. If `verification-tasks.md` exists, read it; resume at the first `- [ ]` VT line.
3. If a `verification-plan.md` exists with closed cover points, *do not re-derive them* — continue closing the open `[ ]` bins.
4. Reconstruct prior discrepancies from the last `reports/ivv/*.md`.

This is exactly spec-kit's `/speckit-implement` resume behavior (re-read tasks.md, resume at first `[ ]`), transplanted to verification.

---

## Part C — Spec-kit's disadvantages / gaps, and how VeriKit is better

Spec-kit is a *specification & implementation* harness. It is deliberately NOT a verification harness, and its verification posture is weak. VeriKit's entire reason to exist is to fill these gaps. Being critical:

### C.1 Spec-kit gaps

1. **No independent verification — design and check share one context.** `/speckit-implement` writes the code *and* (optionally) its tests in the same session, off the same spec reading. This is the classic oracle problem (Knight & Leveson: same-spec workers make *correlated* errors). A misread requirement yields a green-but-wrong result. Spec-kit has no mechanism to break this.
2. **Tests are OPTIONAL and author-written.** `tasks-template.md` says verbatim: *"Tests are OPTIONAL - only include them if explicitly requested."* And when included, they're written by the implementing agent. No independence, no coverage floor, no mutation gate.
3. **No coverage or mutation gating.** Nothing measures functional-coverage closure or proves the tests can fail. `tasks.md` can be 100% `[x]` with zero real verification.
4. **No security lens, no runtime/E2E lens.** `/speckit-analyze` checks *artifact consistency* (does every requirement have a task?), not *behavioral correctness*. There is no adversarial input, no fuzzing, no "does it actually run."
5. **`/speckit-checklist` validates the *English*, not the *system*.** It is explicit: *"NOT for verification/testing… testing whether the requirements are well-written… NOT whether the implementation works."* Valuable, but orthogonal to correctness.
6. **`/speckit-analyze` is structural only.** It maps tasks↔requirements by keyword; it cannot tell you a money calculation is wrong.
7. **No conservation/balance, metamorphic, or oracle-independent reasoning.** Spec-kit has no concept of "this output must re-sum to the input."

### C.2 How VeriKit is better (already, by design)

VeriKit's `verification-engineer.md` + `ivv/SKILL.md` directly counter each gap:

| Spec-kit gap | VeriKit answer |
|---|---|
| Design+check share a context | **Two-context** flow: a fresh `verification-engineer` subagent that **never reads the source** (THE ONE INVIOLABLE RULE). |
| Optional, author-written tests | Verification is the *deliverable*; the VE *architects an environment* (generator → reference model → scoreboard → assertions → coverage). |
| No coverage gating | `CoverageModel.assertClosed()` gates sign-off on functional-coverage closure. |
| No mutation gating | Phase E mutation testing + **reference-model self-mutation** ("prove the bench has teeth"); P0 floor ≥80. |
| No oracle independence | Metamorphic relations, hand-derived goldens, real-data truths; explicit Knight & Leveson "honest residual." |
| No security/adversarial lens | Fuzz lens + persisted seed corpus for parsers; anomaly/fault-injection ("nemesis"); Jepsen-style history checks for sync. |
| No conservation reasoning | Mandatory **conservation/balance invariant** for any money-moving module. |
| Structural-only analysis | A *behavioral* scoreboard that runs stimulus and judges DUT vs an independent model. |
| Unproven ("trust me") | **Bug-injection validation study** (`experiments/ve-validation/`): 4/4 detection, 0/151 false positives in Batch 1 — VeriKit ships *evidence* it catches bugs. Spec-kit ships none. |

**Net:** spec-kit answers "did we build the thing we wrote down?" (structurally). VeriKit answers "is the thing we built *actually correct*, judged independently?" These are complementary, not competing — which sets up Part D.

### C.3 What VeriKit should additionally borrow *from spec-kit's discipline* (the reverse direction)

VeriKit's engine is strong but its *ergonomics* are weak vs spec-kit. Borrow:
- **The ticking-checklist persistence** (Part B) — VeriKit's biggest ergonomic gap.
- **The one-shot prerequisite JSON oracle** (`check-prerequisites`) — replace the SKILL's hard-coded paths.
- **The template override stack** — let projects customize the contract/vplan templates without forking VeriKit.
- **The installer + file-hash manifest** — make VeriKit `npx verikit init`-able like `specify init`.
- **The `## Phase Z` precedent** — this repo *already* proved spec-kit can be extended to auto-invoke verification at the template layer. VeriKit should ship that injection as a first-class install option.

---

## Part D — Integration design: spec-kit ↔ VeriKit

### D.1 Two concrete invocation seams

**Seam 1 — `extensions.yml` `after_implement` hook (the clean, spec-kit-native way).**
Add to the target repo's `.specify/extensions.yml`:
```yaml
hooks:
  after_implement:
  - extension: verikit
    command: verikit.verify
    enabled: true
    optional: false        # mandatory for P0/P1 modules; optional otherwise
    prompt: Run independent verification on the modules just implemented?
    description: Independent coverage-driven IV&V on non-trivial logic
    condition: null
```
Because every `speckit-*/SKILL.md` already scans `after_<phase>` hooks and maps dots→hyphens (`verikit.verify` → `/verikit-verify`), `/speckit-implement` will naturally surface (or auto-execute, if `optional: false`) the VeriKit run at the end of implementation. **Zero changes to spec-kit core** — this is precisely the extensibility seam the hook system was built for. This is strictly cleaner than the current approach.

**Seam 2 — the `## Phase Z` task injection (already present in this repo).**
This repo's `tasks-template.md` appends a `## Phase Z: Verification gate` with `/ivv` + `/validate` + `/verify` tasks. So `/speckit-tasks` emits verification tasks into `tasks.md`, and `/speckit-implement` executes them like any other task — ticking them `[x]`. This is the *batch* integration (verification as the last phase of the feature). Keep it for project-level "feature done" gating.

**Recommendation:** ship **both**, with different cadence. Seam 1 (`after_implement` hook, `optional: true` by default) is the per-increment nudge. Seam 2 (`Phase Z` task, `optional: false` for P0) is the feature-completion gate. The hook is the reminder; the task is the requirement. They don't conflict — the hook can no-op if the Phase Z task already ran.

### D.2 Same session vs separate cloud sessions/context windows — the core trade-off

The deepest design question. The IV&V methodology's *entire value* is **independence** (`verification-engineer.md`: "Your entire value is that independence"). The risk to independence scales with how much shared context the verifier inherits.

| Option | How | Independence | Orchestration cost | Verdict |
|---|---|---|---|---|
| **(a) Same session, same context** (Designer also verifies) | one agent writes code then tests | ❌ none — correlated blind spots; this is exactly spec-kit's flaw | lowest | **Reject.** Defeats the purpose. |
| **(b) Same session, subagent** (current `/ivv`) | orchestrator spawns a fresh `verification-engineer` subagent in the same session | ✅ strong *if* the spawn prompt withholds source (it does — "Do NOT paste or reference the implementation source"); the subagent has a fresh context window | low–medium | **Good default.** Independence is enforced by prompt discipline + a post-run "files I read" audit. |
| **(c) Separate cloud sessions / context windows** (true process isolation) | the VE runs as a wholly separate Claude session/agent with no shared transcript, fed only the contract + spec files | ✅✅ strongest — structural, not just prompt-enforced; impossible to accidentally leak the transcript | highest — needs an external relay for the Designer⇄VE dialogue, the PLAN-gate hand-off, and promotion | **Reserve for P0 money modules / publishable evidence runs.** |

**Why independence degrades in (b):** the subagent shares the *session*, so there's a (small) risk the orchestrator leaks implementation details into the spawn prompt, or that tool-result caching exposes source. The current charter mitigates this with the inviolable no-read rule + the mandatory "Files I read" audit that voids the run on contamination. That mitigation is *behavioral*; (c) makes it *structural*.

**Why (c) costs more:** the harness has no `SendMessage` to a separate session (the IV&V SKILL notes "The harness has no `SendMessage` to continue a subagent"), so the Designer⇄VE dialogue, the PLAN-gate escalation, and test promotion must all be marshaled through files + a relay process. That's real engineering, and for most modules the marginal independence gain over (b) doesn't justify it.

**Recommendation (reasoned):**
- **Default to (b)** — fresh `verification-engineer` subagent in-session, source withheld by prompt + audited. It is the right cost/independence balance for P1 and non-trivial P2 logic, and it's what's already built and *validated* (the bug-injection study used effectively this isolation and scored 4/4).
- **Escalate to (c)** for **P0 money-truth modules** and for **any run that becomes published evidence**, where structural independence is worth the orchestration cost. Use the file-based hand-off VeriKit already has (`<module>.contract.md` in, `tests/ivv/` + report out) as the cross-session interface — those artifacts are *designed* to be the only channel, so (c) is mostly a matter of running the VE in a different session and relaying via those files.
- **Never (a).** It is the exact failure mode VeriKit exists to eliminate.

The persisted artifacts from Part B make (c) cheap to reach later: if the contract, vplan, and verification-tasks all live on disk in a known format, swapping the in-session subagent for a separate session is "point a different runner at the same files." **Build for (b) now, architect the file interface so (c) is a config flag, not a rewrite.**

### D.3 Data-flow of the integrated pipeline

```
/speckit-specify → spec.md  ─────────────────────────────┐ (shared spec = single point of failure;
/speckit-plan    → plan.md + contracts/                   │  only the human resolves ambiguity)
/speckit-tasks   → tasks.md (incl. Phase Z verify tasks)  │
/speckit-implement → code  ──(after_implement hook)──►  /verikit-verify
                                                          │
            Designer hat writes  <module>.contract.md  ◄──┘ (implementation-FREE)
                       │
            spawn VE (mode PLAN) → <module>.vplan.md + ambiguity list   [tick verification-tasks.md]
                       │
            PLAN GATE: genuine ambiguity → escalate to HUMAN (patches spec.md ↑)
                       │
            spawn fresh VE (mode EXECUTE) → tests/ivv/<module>.ivv.test.ts
                       │  drives coverage to closure  [tick verification-plan.md cover points]
                       │  mutation + self-mutation sign-off
                       ▼
            promote → tests/unit/independent/   +   reports/ivv/<date>.md
```

The crucial loop: **spec ambiguity discovered by verification flows *back* into spec.md** (the spec-kit artifact). That's the integration's highest value — VeriKit makes spec-kit's specs *better* by stress-testing them, and the fix lands in the spec-kit-owned file. The human is the only one allowed to edit the spec on an ambiguity (both flows agree on this).

---

## Part E — Concrete file/dir layout VeriKit should ship

Mirroring spec-kit's `.specify/` + `.claude/` + scripts + templates. Two trees: the **VeriKit source package** (what we build/publish) and **what the installer drops into a target repo**.

### E.1 VeriKit source package (this is what the overnight build produces)

```
verikit/
├── README.md                         # what/why/install/use + the validation evidence headline
├── STATUS.md                         # (exists) build status
├── docs/
│   ├── speckit-study-and-comparison.md   # THIS FILE
│   └── methodology.md                # IV&V/SWE-141, CDV/Doulos, Knight&Leveson, SQLite, Jepsen, bug-injection
├── agents/
│   └── verification-engineer.md      # generalized (de-money-fied) VE charter
├── skills/
│   └── verikit-verify/
│       └── SKILL.md                  # generalized plan-gate-then-execute orchestrator + resume logic
├── templates/
│   ├── verification-contract-template.md   # generalized (money/bigint moved to a language pack)
│   ├── vplan-template.md                   # NEW — ticking cover-point checklist (Part B.1)
│   └── verification-tasks-template.md       # NEW — 7-phase orchestration checklist (Part B.2)
├── framework/
│   └── typescript/                   # v1 language pack
│       ├── scoreboard.ts             # (from tests/_framework/) generalized — drop bigint-default assumption
│       ├── coverage-model.ts         # (from tests/_framework/) already generic
│       └── README.md                 # how to wire fast-check + vitest
│   # future: framework/python/ (Hypothesis), framework/java/ (jqwik)
├── scripts/
│   ├── powershell/
│   │   ├── vk-common.ps1             # Get-RepoRoot + verification-path resolver (clone common.ps1)
│   │   ├── vk-check-prerequisites.ps1 # "where are we?" JSON oracle (contract? vplan? closed CPs?)
│   │   └── vk-setup-verification.ps1  # copy templates, emit JSON paths
│   └── bash/
│       ├── vk-common.sh
│       ├── vk-check-prerequisites.sh
│       └── vk-setup-verification.sh  # POSIX parity (spec-kit ships both)
├── install.ps1                       # copy into target .claude/ + .specify/ ; write verikit.json manifest
├── install.sh
├── install.md
├── evidence/                         # the validation study results (detection/false-positive rates)
│   └── batch-1.md                    # from experiments/ve-validation/PROGRESS.md + results.json
└── experiments/                      # (exists as experiments/ve-validation/) the harness that produced evidence
```

### E.2 What `install.*` drops into a TARGET repo (the "installed" footprint)

```
<target-repo>/
├── .claude/
│   ├── agents/verification-engineer.md         # ← copied from verikit/agents/
│   └── skills/verikit-verify/SKILL.md          # ← copied from verikit/skills/
├── .specify/                                    # reuse spec-kit's dir if present; else create
│   ├── templates/
│   │   ├── verification-contract-template.md   # ← copied; project may override via overrides/
│   │   ├── vplan-template.md
│   │   └── verification-tasks-template.md
│   ├── scripts/{powershell,bash}/vk-*.{ps1,sh} # ← copied
│   ├── extensions.yml                          # ← installer ADDS the verikit after_implement hook
│   └── verikit.json                            # NEW manifest: version + file SHA-256s + verikit.config
├── verikit.config.json                          # per-project: testRunner, frameworkDir, quarantineDir,
│                                                #   mutationCmd, riskTiers→coverage/mutation floors
└── (per feature, created at run time)
    specs/<feature>/verification/
    ├── <module>.contract.md          # Designer-authored, implementation-free
    ├── <module>.vplan.md             # VE PLAN output — TICKING cover-point checklist
    ├── verification-tasks.md         # 7-phase orchestration checklist — TICKING
    └── (tests land in) tests/ivv/<module>.ivv.test.ts → promoted to tests/unit/independent/
    reports/ivv/YYYY-MM-DD-HHMM-<module>.md
```

`verikit.config.json` is the key portability artifact — it's where *this* project's specifics (the hard-coded `vitest.ivv.config.ts`, `tests/_framework/`, `C:\Program Files\nodejs`, mutation command, P0/P1 floors) move out of the SKILL prompt and into per-project config, exactly as spec-kit's `init-options.json` holds per-project install choices.

---

## Prioritized TODO list for the VeriKit build

Ordered by leverage. Items 1–4 are the spec-kit-mechanics adoption (highest value, lowest risk); 5–8 are packaging; 9–11 are the harder independence/evidence work.

1. **[P0] Ship the ticking `vplan-template.md` + make the VE write cover points as `- [ ]` lines and flip them `- [x]` on closure.** This is the single highest-value adoption — the persisted, compaction-surviving, resumable verification state spec-kit is loved for. Wire `CoverageModel` closure → markdown checkbox. (Part B.1)
2. **[P0] Add `verification-tasks.md` (7-phase orchestration checklist) and make `/ivv` resume from the first `- [ ]`.** Gives the expensive EXECUTE pass a "where are we?" story. (Part B.2)
3. **[P0] Extract all hard-coded paths from `ivv/SKILL.md` and `verification-engineer.md` into `vk-check-prerequisites.*` + `verikit.config.json`.** Mirrors `check-prerequisites.ps1` + `init-options.json`. Without this VeriKit cannot install into another repo. (Parts A.3, B.3, E.2)
4. **[P0] Author `vk-common.{ps1,sh}` + `vk-check-prerequisites.{ps1,sh}` + `vk-setup-verification.{ps1,sh}` (both shells).** Clone spec-kit's `common.ps1` path-resolution + template-override stack; resolve `verification/` artifacts. Ship ps AND sh for portability. (Part A.3, E.1)
5. **[P1] Generalize `verification-engineer.md` and `verification-contract-template.md` off the money domain.** Move bigint/checksum/Drive-sync specifics into the TypeScript language pack + an optional "money domain pack"; keep the core charter domain-agnostic. (Parts B.3, E.1)
6. **[P1] Move `tests/_framework/scoreboard.ts` + `coverage-model.ts` into `verikit/framework/typescript/`; drop the bigint-default assumption (make it a pluggable `eq`).** They're already nearly generic. (Part E.1)
7. **[P1] Write `install.ps1` / `install.sh` / `install.md` + the `verikit.json` SHA-256 manifest, and have the installer add the `after_implement` hook to the target `.specify/extensions.yml`.** Makes VeriKit `init`-able like spec-kit. (Parts B.3, D.1, E.2)
8. **[P1] Ship the dual integration seams: the `after_implement` hook (per-increment nudge, optional) AND the `Phase Z` task injection (feature-completion gate, mandatory for P0).** (Part D.1)
9. **[P2] Implement the "where-are-we?" resume command (`/verikit-verify --resume`) end-to-end** using items 1–4. (Part B.4)
10. **[P2] Architect the file-based VE interface so "separate cloud session" (option c) is a `verikit.config.json` flag, not a rewrite.** Default to in-session subagent (option b); gate option (c) behind P0/evidence runs. (Part D.2)
11. **[P2] Finish the validation study to ≥10 cases / ≥6 domains / ≥8 bug classes + a correct control, and publish `evidence/`.** This is VeriKit's differentiator vs spec-kit (which ships no evidence). Continue from `experiments/ve-validation/` (4/4 so far). (Part C.2, STATUS.md checklist)
12. **[P3] `docs/methodology.md`** — write up IV&V/CDV/Knight&Leveson/SQLite/Jepsen/bug-injection grounding for the README. (Part E.1)

**One-line summary:** VeriKit already has the *engine* spec-kit lacks (independent, coverage-driven, mutation-validated verification with shipped evidence); it must now borrow spec-kit's *skeleton* — a persisted, ticking, on-disk verification-plan + verification-tasks checklist, a path-resolving prerequisites script, a template-override stack, and a copy-the-engine installer — so it survives compaction, answers "where are we?", and drops into any repo the way `specify init` does.
