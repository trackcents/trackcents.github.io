# HANDOFF — TrackCents (money_management_tool)

> Author of this doc: Claude Opus 4.7 (the outgoing AI). Hemanth is moving to a different AI because I made the same class of UX mistakes multiple times despite repeated correction. The honest "why" is in §11. Read that first if you want to avoid the same trap.

---

## 0. How to use this document

Hemanth's words: _"I don't want to re-explain all my requirement to that new AI."_

So **everything Hemanth has told me that still applies is in here, or pointed-to from here.** No duplication — if a doc exists in the repo, this file points to it. Read the pointers; don't reinvent.

Order to read:

1. §1 — Who Hemanth is (5 min)
2. §11 — Where I (Claude) was dumb (5 min) ← read this BEFORE coding
3. §2 — Project orientation, then the pointed-to docs
4. The rest by need

---

## 1. Hemanth (the user) — context the AI must internalize

- **Role**: Solo developer on a personal/hobby project. Not a company. Not a paying customer.
- **Co-users**: ~2-4 personal friends. Notably **Murali** (USD persona, US-based, imports bank statements) and **Bhargav** (INR persona, India-based, mostly types entries manually). When asked, do persona reviews from both POVs before claiming "done."
- **Languages**: English + Telugu (transliterated to Roman script). He may mix mid-message. Don't translate his Telugu unless asked — respond in the language he wrote.
- **Communication style**: WhatsApp-mode. Short. Direct. Casual.
- **Tolerance**: Very low for sycophancy ("great question!", "absolutely!", padded praise). Very high for honesty about your mistakes.
- **What he is NOT**: A QA engineer. Don't ask him to test things you can test yourself. Don't ask him to take screenshots when Playwright is available in the repo (see §7).

### His project-level requirements (binding, don't relitigate)

- **Privacy is paramount.** No AI ever reads bank statements. Zero-knowledge cloud storage. PDFs never leave the browser. See `.specify/memory/constitution.md` for the binding principles.
- **No personal data in the default seed.** I shipped "ALTERA CORPORATI" (his employer name) as a default categorization rule. He was furious. It's removed now. The lesson: **review every default with "would I want this exposed if a stranger looked at my rules list?"**
- **Stack is locked**: SvelteKit 5 + Tailwind v4 + shadcn-svelte + ECharts + PDF.js 4.4.168 (pinned — do NOT upgrade, breaks iOS) + wa-sqlite (planned) + Pyodide (planned, for Python-based parsers).
- **Money math**: integer cents only (`bigint`). Never floats. Checksum gate on every import.
- **Open source**: AGPL-3.0, hosted as static PWA on GitHub Pages.
- **Cost ceiling**: $0/month at steady state.

---

## 2. Project orientation — pointer table

| Topic                                                                          | Where to read                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conventions, verification tiers (pnpm verify gate), test layering**          | `CLAUDE.md`                                                                                                                                                                            |
| **Binding project principles**                                                 | `.specify/memory/constitution.md`                                                                                                                                                      |
| **Feature spec — P1 / P2 / P3 user stories**                                   | `specs/001-money-tracker-mvp/spec.md`                                                                                                                                                  |
| **Tech-decision rationale**                                                    | `specs/001-money-tracker-mvp/research.md`                                                                                                                                              |
| **Data model + schema**                                                        | `specs/001-money-tracker-mvp/data-model.md`                                                                                                                                            |
| **Module contracts (BankAdapter, StorageRepository, SyncProvider, PdfIntake)** | `specs/001-money-tracker-mvp/contracts/`                                                                                                                                               |
| **The "master-chef" 23-question gate that applies BEFORE every code change**   | `MASTER_CHEF.md`                                                                                                                                                                       |
| **Hemanth's auto-memory — feedback, project state, behavioral rules**          | `C:\Users\tnvmu\.claude\projects\C--Users-tnvmu-Downloads-Projects-Hemanth-money-management-tool\memory\MEMORY.md` (index) and the `feedback_*.md` / `project_*.md` files alongside it |
| **Independent verification flow**                                              | `.claude/skills/ivv/SKILL.md` (the `/ivv` skill)                                                                                                                                       |
| **Verification battery**                                                       | `.claude/skills/validate/SKILL.md` (the `/validate` skill)                                                                                                                             |
| **Test plan templates**                                                        | `.claude/skills/test-arch/SKILL.md` (the `/test-arch` skill)                                                                                                                           |
| **Constitution audit**                                                         | `.claude/skills/constitution-reviewer/SKILL.md`                                                                                                                                        |
| **chef-supervisor subagent (sanity-check gate)**                               | `.claude/agents/chef-supervisor.md`                                                                                                                                                    |

**Live site**: https://trackcents.github.io
**Repo**: https://github.com/trackcents/trackcents.github.io
**Main branch**: `main` (no feature branches for personal dev)
**Working directory**: `C:\Users\tnvmu\Downloads\Projects\Hemanth\money_management_tool`

---

## 3. App overview in 3 lines

TrackCents = privacy-first money-tracking PWA. User drops bank/CC PDFs into the browser; per-bank parsers extract transactions; a checksum gate refuses any import that doesn't tie out to the printed total. Adds a "Quick Add" sheet for manual entries with natural-language parsing ("biryani 30 today 3pm" → amount + date + time + category guess + description). Sub-categories supported (Food → Biryani, etc.). Reports show "where the money went" with a credit-card drill-down (bank PAYMENT TO CC → individual CC line items).

---

## 4. Recent / locked design decisions

These were **negotiated over many turns** with Hemanth. **Do NOT change without asking him first.**

### 4.1 QuickAddSheet layout (LOCKED at commit `312a804`)

```
[× close button]
[Expense | Income | Transfer]   ← type toggle
[$ 12.34 BIG]                   ← Amount, big font
[Description input]
[Category ▾]  [Account ▾]       ← 2-col row
[Date]        [Time]            ← 2-col row
[Notes (optional)]              ← hidden when keyboard open
[Save]                          ← at END of form, NOT sticky
```

**Hard rules** for this sheet (each rule was the resolution of a fight with me — read the commit messages I cited for context):

- **No sub-category as a separate field.** The user picks subs from the SAME Category dropdown, which renders parents with children indented. Button shows `Food · Biryani`. (Commits: `856ff94`, `312a804`.)
- **No sticky Save.** Save is at the end of the form, scrolls with everything. While typing, the user does NOT need Save visible. (Commit: `43466da`.)
- **No "AUTO" chip-strip ribbon.** I added one as a workaround for the keyboard problem — it duplicated info already shown in the Category / Account / Date / Time buttons. (Commit: `646197b`.)
- **No "Payment method" label.** Use **"Account"**. He prefers it. (Commit: `856ff94`.)
- **`.keyboard-open` class** is added by JS via the visualViewport listener when `innerHeight - visualViewport.height > 120`. CSS hides the title + Notes and tightens gaps. (Commit: `940ec0e`.)

### 4.2 Where to look in the code

- `src/components/QuickAddSheet.svelte` — the locked sheet
- `src/components/CategoryPicker.svelte` — nested categories + sub-cat discoverability hint
- `src/components/CategoryRenameSheet.svelte` — rename + icon picker
- `src/components/AccountPicker.svelte` — account dropdown + nicknames
- `src/components/TimeInput.svelte` — segmented HH : MM AM/PM
- `src/lib/app/nl-quick-add.ts` — the NL parser (Hemanth's most-touched module)
- `src/lib/app/default-categories.ts` — seed categories + rules (privacy-sensitive)
- `src/lib/app/category-visuals.ts` — IconKey + categoryIconName mapping
- `src/lib/app/keyboard-inset.ts` — the visualViewport listener
- `src/lib/app/account-nicknames.ts` — per-account display-name overrides
- `src/lib/app/rule-from-desc.ts` — learn-from-pick rule extractor
- `src/lib/adapters/chase-credit-card/adapter.ts` — Chase CC parser (real-PDF fixes applied)

### 4.3 NL parser invariants (`nl-quick-add.ts`)

These are LOCKED via tests in `tests/unit/app/nl-quick-add.test.ts` and `tests/unit/app/nl-quick-add.real-world.test.ts` (32 cases). Don't change without re-running both.

- A leading bare digit (`"biryani 10 may07th"`) + a date in the same chrono result = the digit is an **amount**, not a hour. Strip from span.
- 2-digit "year" inferred far from today's year ("22nd may 75") = **strip** the trailing digits, reset year to today, expose digits to amount filter.
- Strong-time detection requires hour-certain **AND** (meridiem-certain OR minute > 0). A bare hour with no AM/PM is NOT a time.
- Time extraction walks **all** chrono results, not just `[0]`.
- Amount filter excludes digits inside **any** chrono span (date AND time), not just the first.

### 4.4 Form behaviour rules (`QuickAddSheet.svelte`)

- Amount, Date, Time, Category **all follow the description** on every keystroke unless the user explicitly picked one. State flags: `userPickedCategory`, `userTouchedTime`, `userTouchedDate`, `userTouchedAmount`, `userTouchedAccount`.
- When the description goes empty, all auto-fields reset (amount = '', time = '', date = today, categoryId = null) UNLESS the user touched them.
- A parsed time in the description **always** wins over the existing time field (the description is the newer intent).
- Category guess always overwrites (including null), unless `userPickedCategory` is true.
- **Learn-from-pick**: when the user manually picks a category, mint a "contains X → Category" rule from `extractRulePattern(parsed.description)` (see `src/lib/app/rule-from-desc.ts`). Skip when a duplicate already exists.

---

## 5. The "DO NOT" list (things I shipped and Hemanth told me never to do again)

1. **DON'T add UI elements he didn't ask for** ("convenience" sticky bars, preview chip strips, etc.). If you think one might help, **propose it in words**, don't ship it.
2. **DON'T add a new row to the form** to solve a layout problem. Refine the existing rows.
3. **DON'T anchor analysis to one phone size**. Test 5 devices (see `scripts/screenshot-quickadd-keyboard.mjs`).
4. **DON'T ask him to send a screenshot when you can take one yourself.** Playwright + Chromium are installed (`@playwright/test`); the salt-injection trick bypasses onboarding (see `scripts/screenshot-quickadd-keyboard.mjs` line 36-42).
5. **DON'T put his employer name, account suffixes, or niche regional entities in the default seed** (ALTERA, FIDELITY 15105, KITSAP CU TRANSFER all caused complaints). Generic patterns only.
6. **DON'T deploy per-feature**. He explicitly asked for batched commits, one deploy per batch.
7. **DON'T pretend the Bayes classifier learns from manual QuickAdd picks while typing.** It doesn't (it runs on app load over imported txns). Use the learn-from-pick rule path instead.
8. **DON'T break the Chase CC adapter again.** The real-layout regression tests in `tests/unit/adapters/chase-credit-card.test.ts` (the `realLayoutFixtureStmt9` / `realLayoutFixtureStmt11` blocks) are there because I broke that parser 3 times in a row. Touch the adapter only with the failing real PDFs in hand.

---

## 6. Hemanth's auto-memory — the canonical preference index

`C:\Users\tnvmu\.claude\projects\C--Users-tnvmu-Downloads-Projects-Hemanth-money-management-tool\memory\MEMORY.md`

That file is an **index** — each entry is a one-liner pointing to a fuller file in the same directory. **Read the index first**, then read the entries that match the task at hand.

Highlights (read fresh, don't trust me):

- `feedback_thorough_testing.md` — domain-research-driven adversarial tests, never rely on his sample data alone
- `feedback_no_silent_failures.md` — parsers throw with row context; checksum gate is last-resort, not primary error UX
- `feedback_no_amount_based_classification.md` — never guess a transaction's meaning from its size
- `feedback_simple_final_summary.md` — close every task with a short plain-English "what I did / what it means / next steps"
- `feedback_work_autonomously.md` — when told to proceed, build through the spec-kit plan + verify; don't gate
- `feedback_verification_right_sizing.md` — over-testing is a judgment failure too
- `feedback_batch_deploy.md` — batch features, run `pnpm verify` + deploy ONCE
- `project_phase_1a_persistence.md` — current persistence is OPFS JSON, not wa-sqlite (task #49 tracks the migration)
- `project_synthetic_data_strategy.md` — beyond one real statement per bank, validation uses programmatic synthetic generators (task #58)
- `project_deployed_live.md` — app is public + auto-deploying on GitHub Pages (org "trackcents"); progress lives in `reports/overnight-build`, NOT in any tasks.md
- `project_pdfjs_pinned_v4_for_ios.md` — pdfjs-dist pinned ≤ 4.4; do NOT bump
- `project_verif_kit_name_and_repo.md` — the separate verif-kit tool is at github.com/chitti-learns-ai/verif-kit; never call it "VeriKit" anymore

If you change behaviour, update the relevant memory entry. The auto-memory system saves entries by topic, not chronologically.

---

## 7. Scripts you can run (use them — don't ask Hemanth to do your work)

```bash
# Layout test on 5 device sizes (iPhone SE / Pixel 5 / Pixel 7 / iPhone 14 / iPhone 14 Pro Max).
# Bypasses onboarding via localStorage salt injection. Dumps each field's
# bounding box + writes per-device screenshots to reports/quickadd-keyboard-*.png
node scripts/screenshot-quickadd-keyboard.mjs

# End-to-end sub-category flow demo. Creates "Biryani" under "Food",
# picks it, verifies the Category button shows "Food · Biryani".
# Screenshots go to reports/sub-*.png
node scripts/screenshot-subcat-flow.mjs

# Project verification gate — REQUIRED before claiming "done"
pnpm verify              # ~60s — lint + tsc + tests + build

# Tighter loop during exploration
pnpm check && pnpm test  # ~5s

# After touching any adapter, store, app/, util/
pnpm validate:integration  # ~10s

# Before shipping any adapter change
pnpm validate:integration:real  # needs ONEDRIVE_CHASE_DIR env var

# Full feature gate (slow ~10min)
pnpm validate:deep
```

`reports/` is **gitignored**. Screenshots produced by the above scripts stay local.

---

## 8. Pending work / open tickets

From the in-session task list (TaskCreate). Most relevant:

- **#49** — Phase 1B: migrate persistence from OPFS JSON to wa-sqlite (planned, not started)
- **#79** — Cross-device categorization sync (encrypted Google Drive blob)
- **#80** — Research-grounded GUI redesign / shadcn-svelte rebuild (in_progress, large)
- **#97** — Lean default category seed (24 → 8 essentials) — pending; Hemanth can prune himself via the safe-delete already in place
- **#100** — Modern icons (Phosphor + curated emoji) — pending

If you start a new feature, follow the workflow in `CLAUDE.md`:

```
/speckit-specify → /speckit-plan → /test-arch → /speckit-tasks → /speckit-implement → /ivv → /validate → /verify → /code-review
```

For P3 chrome tweaks, only `/validate` + `/verify` are required.

---

## 9. Verification gates — what "done" means

From `CLAUDE.md` (read it):

| Tier | Command                          | When                                        |
| ---- | -------------------------------- | ------------------------------------------- |
| 1    | `pnpm verify`                    | Every code change                           |
| 2    | `pnpm validate:integration`      | Touching any adapter / store / app/ / util/ |
| 3    | `pnpm validate:integration:real` | Before shipping an adapter change           |
| 4    | `pnpm validate:deep`             | Before merging a feature / opening a PR     |

P0 modules (money math): line ≥ 95%, branch ≥ 90%, mutation ≥ 80%. Enforced by CI.
P1 modules (adapters): line ≥ 80%, branch ≥ 60-75%, mutation ≥ 70%.

**Never weaken a failing assertion to make a tier green.** See the "Verification rule for new features" in `CLAUDE.md`.

---

## 10. Independent Verification — when to invoke

`/ivv` (the IV&V skill) spawns a `verification-engineer` subagent in a **fresh context** that has never seen the source. It builds its own coverage-driven testbench from the spec + a written contract.

**When to run it**: after implementing any non-trivial logic module in `src/lib/app/`, `src/lib/util/`, `adapter.ts`, `src/lib/db/`.

**When NOT to run it**: chrome/styling tweaks, single-line bug fixes, post-sign-off small fixes (just re-run the promoted suite).

Full instructions in `.claude/skills/ivv/SKILL.md`. **The agent MUST be the real `verification-engineer` subagent — never fall back to `general-purpose`.** If it's not registered, ask Hemanth to restart Claude Code.

---

## 11. Where I (Claude Opus 4.7) was dumb — honest accounting

Hemanth's words: _"please mention that you are performing very dumb hence that is the reason I am moving to new AI."_

Fair. Here's the honest accounting so the next AI doesn't repeat it.

### 11.1 The pattern behind the mistakes

**I default to ADDING things rather than REFINING what's there.** Almost every mistake below is some variant of that.

When a problem appears (the form is too tall for the keyboard), my reflex was to **add** a workaround (sticky Save, chip strip, separate sub-cat row). The correct move was to **compact existing fields**. Hemanth said this explicitly: _"why weren't you able to just fit sub categories also without having this keyboard overlay problem"_.

### 11.2 Specific failures (chronological)

1. **Added a sticky Save bar nobody asked for** (commit `d4e2c63`). My reasoning: "if user can't see other fields at least let them save." That was wrong — Hemanth wanted to **see the form**, not save quickly. I reverted in `43466da`.

2. **Added the "AUTO" chip strip ribbon** showing duplicate info already in the Cat/Account/Date/Time buttons (commit `d8bb301`). Hemanth circled it in red: _"I didn't at all like your new idea of adding one more layer."_ Reverted in `646197b`.

3. **Sub-category as a separate row** (commits `6d8f0d4`, then `573e739`). Hemanth had asked for sub-cats and I gave him the dumbest possible implementation — a whole new row that made the form too tall to fit above the keyboard, **which created the keyboard-overlay problem I then tried to "fix" with the sticky Save and chip strip**. The right answer was to put sub-cats inline in the existing Category button. Eventually corrected in `856ff94` + `312a804`.

4. **Blindly removed sub-categories when Hemanth said remove** (commit `856ff94`). He said "remove that sub categories which you added." I removed both the **field AND the feature**. Should have asked: "do you want the field gone, or the entire sub-cat feature gone?" The schema (`parent_id`) survived but the UI affordances disappeared. He came back later asking how to add subs.

5. **Anchored my analysis to Pixel 7 only.** Hemanth: _"why are you hardcoding it for pixel 7? I want it to be supported for every phone."_ The CSS was already responsive (rem-based) but my **measurements and comments** were Pixel-specific. The COMMENTS implied hardcoding when the rules were generic. Fixed in `a94b49d` by expanding the test sweep to 5 devices and rewriting the comments to be device-agnostic.

6. **Asked Hemanth to send screenshots when I had Playwright.** He had to call this out: _"why don't you check that yourself? can't you open the website take a screenshot and see for yourself?"_ Set up Playwright AFTER he called it out. Should have set it up before turn 1 of any layout work.

7. **Broke the Chase CC adapter THREE TIMES** before getting it right. Synthetic fixtures passed; real PDFs failed. He told me bluntly: _"please thoroughly check that fix, you already tried fixing it 3 times but you couldn't fix it, this time be serious, do not just randomly guess and fix."_ The 4th attempt — grounded in the **actual** PDF text via an investigator agent — landed. Real-layout regression tests are in place now.

8. **Shipped ALTERA CORPORATI as a default rule.** That's his employer name. Every user of the app would have seen it in their rules list. Hemanth was rightly furious. Removed in `573e739`. The lesson is in the seed file's comments now.

9. **Failed to push back when his suggestion would cause problems.** He explicitly asked for this: _"Ala chesthe ila avthadhi, do you want to double check ani"_ — translate: when his suggestion will cause a downstream problem, say _"if you do that, X will happen — want to double-check?"_ before implementing. I usually just implemented. The handoff happened in part because I never internalised this.

### 11.3 What the next AI should do differently

- When you sense a layout/space problem, **first** ask: _"can I make existing elements fit?"_ Only if the answer is genuinely no, propose adding something.
- Push back **politely but firmly** when his request would cause a regression: _"If we do X, Y will happen — want to confirm?"_
- **Test on multiple devices** with Playwright before claiming layout work is done. The harness is in `scripts/`.
- **Don't add convenience.** Don't add anything he didn't ask for. If you think it'd help, **propose it in words first**.
- When he says "remove X", ask scope: _"remove the field but keep the feature? or remove the feature entirely?"_

---

## 13. App page map — every route, what it does

> Don't make the next AI guess. Here is every route in `src/routes/`:

| Route                             | What it does                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                               | Landing — redirects to `/onboarding` (no salt) or `/today`                                                                                                                             |
| `/onboarding`                     | iOS Add-to-Home-Screen nudge → Google sign-in (skippable via **"Continue without sync"**) → passphrase setup with strength meter → derive key                                          |
| `/today`                          | **Default landing.** Today's activity + `BudgetBox` ("budget hero" — month-to-date spend vs budget) + recurring detections. Floating `+` opens `?add=expense` → mounts `QuickAddSheet` |
| `/transactions`                   | Unified chronological view across all accounts with `FilterBar` (date / account / amount / free-text)                                                                                  |
| `/dashboard`                      | Overview cards: net cash flow, by-category pie, monthly trend                                                                                                                          |
| `/trends`                         | Detailed charts (ECharts) — by-category over time, stacked area, drillable                                                                                                             |
| `/budget`                         | Per-category budget caps + over-budget warnings                                                                                                                                        |
| `/categories`                     | Manage categories (rename, recolor, icon, delete) + rules editor                                                                                                                       |
| `/categories/review`              | Bulk-review uncategorized after import — the first-time-after-import bottleneck UX                                                                                                     |
| `/recurring`                      | Subscription / recurring transaction detection panel                                                                                                                                   |
| `/goals`                          | Savings goals (skeleton — P4)                                                                                                                                                          |
| `/settings`                       | Currency (USD/INR), passphrase reset, sync controls, export, theme toggle                                                                                                              |
| `/statements/[hash]`              | Statement detail — all txns from one imported PDF + checksum reconciliation                                                                                                            |
| `/payments/[bank_hash]/[txn_idx]` | **THE P1 bank ↔ CC drill-down** — bank shows `PAYMENT TO BOFA CC -$800`, this page shows the CC line items that $800 covered                                                           |

`src/components/Nav.svelte` is the bottom tab bar: Today / Transactions / Dashboard / Settings + the floating `+`.

---

## 14. Supported bank/CC adapters

`src/lib/adapters/`:

| Adapter                 | Type                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `chase-checking`        | bank                                                                                             |
| `chase-credit-card`     | CC — broke 3 times; real-PDF regression tests are LOAD-BEARING (§5)                              |
| `bofa-credit-card`      | CC                                                                                               |
| `discover-credit-card`  | CC                                                                                               |
| `amex`                  | CC                                                                                               |
| `robinhood-credit-card` | CC — adding this broke Chase once; the cross-adapter exclusivity test exists because of that bug |

Each adapter implements `BankAdapter` from `specs/001-money-tracker-mvp/contracts/bank-adapter.md`: `canHandle(pdfText)`, `parse(pdfText)`, `validateChecksum()`. Adapter version + parser name baked into each row for provenance.

`tests/unit/adapters/exclusivity.test.ts` enforces no new adapter steals from an existing one. Don't disable it.

Real anonymized PDFs live at `$env:ONEDRIVE_CHASE_DIR` (Hemanth's local OneDrive). CI can't see them; he runs `pnpm validate:integration:real` locally before shipping adapter changes.

---

## 15. Other locked features (already shipped — don't break)

### 15.1 PDF import flow

- `PdfDropZone.svelte` accepts drag-drop OR click-to-pick.
- Detection: every adapter's `canHandle()` is called; highest confidence wins; if all return 0, show **"This bank isn't supported yet — please report it."** Never silently fail (see `feedback_no_silent_failures.md`).
- **Checksum gate**: sum-of-rows ≠ printed total → **REFUSE** the import. `ChecksumDiff.svelte` shows where it diverges. NEVER weaken the gate — it's the money-truth principle.
- Idempotency: re-importing the same PDF (`pdf_source_hash`) is a no-op; overlapping date ranges only add genuinely new rows.

### 15.2 Reconciliation (bank ↔ CC drill-down)

- Bank-side rows matching a CC-payment description get a `ReconciliationLinkBadge`.
- Tapping navigates to `/payments/[bank_hash]/[txn_idx]` which finds the CC statement whose ending balance matches the payment within a date window.
- Link stored as a relationship row. THIS is the P1 problem Hemanth started the project for.

### 15.3 Categorization (3 tiers, in priority order)

1. **User rules** — `contains "BIRYANI" → Food/Biryani`
2. **Default keyword rules** — `default-categories.ts`, privacy-scrubbed
3. **Naive-Bayes classifier** — trained on the user's previously-categorized txns

⚠️ Tier 3 runs ONLY on app-load over imported txns, NOT during QuickAdd typing. Quick-typing uses `category-guess.ts` (rules + `INTENT_KEYWORDS`). Don't pretend Bayes learns live from manual picks.

**Cleaning**: `cleanDescription()` strips ACH metadata before categorization (task #87). Don't bypass it.

**Classifier for transfers/CC-payments/investments** (task #85): these are tagged at the DATA layer so they don't pollute spending categories.

### 15.4 Learn-from-pick rules

When user manually picks a category in QuickAddSheet, mint a `contains X → Category` rule from `extractRulePattern(description)` (strips leading verbs/prepositions). Skip if dup exists. See `src/lib/app/rule-from-desc.ts`.

### 15.5 Account nicknames

- `localStorage['trackcents.accountNicknames']` JSON map.
- `accountDisplayName(rawName)` is the helper — never hard-code raw names in UI.

### 15.6 Account combobox

- Type-to-filter + create-new + last-used pre-selected (task #96).
- Default account is `Cash` (always exists).
- User-added accounts persist in `localStorage['trackcents.manualAccounts']`.

### 15.7 Recurring detector (task #88 quality gate)

- **Recurrence-only, no amount-based bonus guessing** (see `feedback_no_amount_based_classification.md`).
- Detects monthly cadence; surface on `/today` + `/recurring`.

### 15.8 Paycheck-window budgeting (US-P2-D, tasks #60-61)

- Recurrence-detected paychecks anchor a "budget month" (first paycheck → next).
- BudgetBox renders from this anchor.

### 15.9 Currency support

- USD (Murali default) + INR (Bhargav default). Set in `/settings`.
- Money stored as bigint minor units; symbol is presentation-layer.

### 15.10 PWA / offline

- Full offline read+write. OPFS-JSON store is local-first.
- Service worker caches the app shell. **A push that "should" be live but isn't on Hemanth's device is often a stale SW** — first ask him to hard-refresh.

### 15.11 Sync (encrypted Google Drive blob)

- `src/lib/sync/` (engine, blob-format, drive-blob).
- Gated behind Google sign-in; users can skip with "Continue without sync".
- Sync-authoritative conflict resolution for now; per-field LWW planned.

### 15.12 Category management

- `CategoryRenameSheet.svelte` — rename + icon picker.
- Auto-suggests icon from name via `categoryIconName()`.
- User pins any icon from `ICON_OPTIONS` grid in `category-visuals.ts`.
- Safe-delete: in-use category soft-deleted (txns → "Uncategorized"), never hard-dropped.
- Long-press → edit mode (task #99).
- Inline add of new category + sub (task #98).

### 15.13 BudgetBox ("budget hero")

- Big card on `/today` showing month-to-date spend vs budget with animated `ProgressRing`.
- Iterated multiple times for visual polish (`project_deployed_live.md` "budget-hero increments").

### 15.14 Date / time autofill

- `chrono-node` parses NL dates ("today", "yesterday", "may 7th").
- Past-month rollback heuristic + 2-digit-year suppression (§4.3).
- Time field strict format validation (task #108).

---

## 16. Features IN vs OUT of scope (from `spec.md`, summarized)

Don't propose out-of-scope features unless Hemanth explicitly asks.

**P1 (must ship — these define v1 "done")**:

- Onboarding (iOS A2HS, Google sign-in, passphrase)
- Bank PDF import + checksum gate
- CC PDF import + checksum gate
- Bank ↔ CC reconciliation drill-down ← THE problem
- Unified transaction view with filters

**P2 (target v1.1 — mostly shipped)**:

- Categorization (manual + rules + Bayes)
- Spending dashboards
- Multi-device sync via encrypted Drive blob
- Paycheck-to-bills budget view

**P3 (later — partially shipped)**:

- Recurring detection ✓
- Manual cash transactions ✓ (via QuickAddSheet)
- Refund tracking ✗
- Transfer detection ✓ (data layer)
- Notes/tags ✗
- Multi-currency display ✓ (USD/INR)

**P4 (future)**:

- Per-category budget caps + alerts (partial)
- Savings goals (skeleton)
- Bill reminders ✗
- CSV export (in Settings, basic)
- Transformers.js opt-in categorization ✗

**OUT OF SCOPE for v1**:

- Investment / brokerage tracking
- Net worth
- Bill negotiation / subscription cancellation
- Shared finances with another person
- Push notifications
- Plaid / bank linking (PDF imports only)
- SMS / Apple Pay notification interception (browser can't)
- Multi-language UI (English only)

---

## 17. Constitutional principles to internalize

`.specify/memory/constitution.md` has 15 principles. The ones that come up most often:

1. **Privacy-paramount** — no AI reads bank data, no telemetry, zero-knowledge cloud.
2. **Money truth** — integer minor units (bigint); checksum gate is INVIOLABLE.
3. **Provenance** — every transaction carries: `bank_name, account_type, account_nickname, account_last_4, statement_id, raw_text, parser_name, parser_version, pdf_source_hash`. Never drop any of these.
4. **Layered architecture** — per-bank adapters → normalized DB → bank-agnostic app logic. Don't leak bank-specific quirks into `app/`.
5. **Open source AGPL-3.0** — no proprietary deps; static PWA on GitHub Pages.
6. **$0/month at steady state** — no paid services; sync via user's own Drive.
7. **Stack locked** — Svelte 5 + Tailwind v4 + shadcn-svelte + ECharts + PDF.js v4.4 + wa-sqlite + Pyodide. Don't introduce alternatives.
8. **No AI on bank data in v1** — opt-in Transformers.js is v1.2+.
9. **Idempotent imports** — re-importing the same PDF is a no-op.
10. **Adapter version pinning** — every parser carries its version; old data keeps its old parser name.

Run `/constitution-reviewer` for a full audit.

---

## 18. What "done" means — the persona-review checklist

Before claiming a feature complete, mentally walk through it as BOTH personas:

**Murali (USD, US, imports statements)**:

- Does the PDF import still work? Did the checksum gate stay strict?
- Does the bank ↔ CC drill still navigate correctly?
- Does the unified view still show all his accounts?
- Did any auto-detection regress for his transaction patterns?

**Bhargav (INR, India, types entries manually)**:

- Does QuickAddSheet still fit above the keyboard on his phone?
- Are the auto-detected values still live-updating as he types?
- Does INR currency render correctly?
- Are categories still discoverable (sub-cat hint visible)?

Then check the technical gates:

- [ ] `pnpm verify` GREEN
- [ ] If adapter/store/app/util touched: `pnpm validate:integration` GREEN
- [ ] If adapter changed: `pnpm validate:integration:real` GREEN locally
- [ ] If layout changed: `node scripts/screenshot-quickadd-keyboard.mjs` shows the 4 critical fields visible on all 5 devices
- [ ] No new convenience UI element added without Hemanth asking
- [ ] Final reply is a 1-2 sentence summary, NOT a wall of text

---

## 19. Recurring AI traps in this codebase

These bit me and will bite the next AI:

1. **The anonymizer collapses cells.** `tools/anonymize-pdf.mjs` merges adjacent PDF cells; the resulting text has fewer columns than the real PDF. Adapter regex written against an anonymized fixture passes but fails on real PDFs. **Always validate against real PDFs (`pnpm validate:integration:real`).** See `feedback_anonymizer_collapses_cells.md`.
2. **Browser autofill banner ≠ form labels.** When Chrome / Safari shows a saved-credentials chip above the keyboard, it's the BROWSER toolbar, NOT triggered by `<label>` text. Don't rename labels trying to suppress it.
3. **`setViewportSize` in Playwright shrinks `visualViewport.height` too.** So the in-app JS delta check returns false in tests. Force `.keyboard-open` class via `evaluate()`. See `scripts/screenshot-quickadd-keyboard.mjs`.
4. **Service worker caches the old build.** When Hemanth says "your change isn't showing up", first ask him to hard-refresh.
5. **Svelte 5 strips whitespace adjacent to `{#if}` blocks.** `"Food· Biryani"` was caused by this. Inline the if so whitespace is preserved.
6. **GitHub Pages `build_type=workflow` gotcha.** Pages source must be "GitHub Actions" not "Deploy from a branch". See `project_deployed_live.md`.
7. **pdfjs-dist > 4.4 breaks iOS.** All iOS browsers are WebKit. v4.5+/v5 use APIs WebKit doesn't fully support. Pin at 4.4.168.
8. **Powershell `-replace` mangles UTF-8 files.** Em-dashes become mojibake. Use `Edit`, never `-replace` on TS/MD.
9. **`ERR_MODULE_NOT_FOUND` for `playwright`.** Use `@playwright/test`. The bare `playwright` package isn't in `package.json`.
10. **`pnpm verify` runs the Stop hook automatically.** `.claude/settings.json` triggers `pnpm check + pnpm test` after every turn that touched source. So a green hook in your last response doesn't replace a manual `pnpm verify` before claiming done.

---

## 20. Workflow habits Hemanth has asked for

### 20.1 Push back when his suggestion will cause a regression

From his Telugu venting message: _"Ala chesthe ila avthadhi, do you want to double check ani"_ — "if you do X, Y will happen — want to double-check?" Before implementing. He explicitly wants this, and the handoff happened partly because I never did it.

### 20.2 Persona review (Murali + Bhargav)

See §18. Habit, not a script.

### 20.3 The investigator-agent pattern

Three Chase-CC fixes failed before I spawned `Agent({ subagent_type: "Explore" })` to extract the actual PDF text and find the real bug. The 4th attempt worked. **For any "fixed it but still fails" loop, stop patching and spawn an investigator** with a clean read of the source-of-truth. See commits around task #103.

### 20.4 The 23-question gate (master-chef)

Before any code-modifying tool call, run the gate in `MASTER_CHEF.md`. The `chef-supervisor` subagent (`.claude/agents/chef-supervisor.md`) enforces it. I forgot many times — that contributed to §11.

### 20.5 Right-sized verification

From `feedback_verification_right_sizing.md`: ≈1× design time, never 10×. `/ivv` Stage-1 probes are cheap; escalate to Stage-2 only when a bug is found or risk is Critical.

### 20.6 Batch deploys

Per `feedback_batch_deploy.md`: don't `pnpm verify` + deploy per feature. Group changes, verify ONCE, deploy ONCE.

### 20.7 End with a simple summary

Per `feedback_simple_final_summary.md`: short plain-English "what I did / what it means / next steps". 1–2 sentences.

### 20.8 Work autonomously when told to

Per `feedback_work_autonomously.md`: when Hemanth says "proceed" or "go through the plan", build straight through. He's often away. Stop ONLY for genuinely irreversible decisions or spec ambiguity.

### 20.9 The persona walkthrough is the FIRST verification, not the last

Don't run `pnpm verify` then do the persona check — do the persona check FIRST, because it surfaces UX regressions that code-only tests can't catch. Then run the code gates.

---

## 21. Conversation-level context (things from chat not anywhere else)

These are things Hemanth said in the conversation that aren't in the code, the commits, the spec, or memory. Don't lose them.

### 21.1 The Telugu venting message — what he literally wants

Translated and distilled, his asks in that message:

1. **Don't add things I didn't ask for** — sticky Save, chip strip, separate sub-cat row.
2. **Don't blindly remove things when I say remove** — ask scope first.
3. **Show everything in one screen even with keyboard open** — Amount, Description, Categories (auto-filled), Sub-categories, Date, Time. Live-updating as I type.
4. **Push back when my idea will cause a new problem** — "if we do X, Y will happen, want to double-check?"
5. **Be honest about why you made the mistake** — so I can guard against the pattern in future sessions.
6. **Don't ship a "solution" that makes the original problem worse.**

### 21.2 The destination feature for sub-categories

Sub-cats aren't just a categorization nicety. The destination is: _"I would also want to know inside that 30%, how much each sub category took. Like how much I spent for Coke, How much I spent for Ice cream."_

This means **Reports/Dashboard pages need to roll up child spending into parent buckets**, with drill-down to per-sub totals. The schema (`parent_id`) supports it; the UI does not yet (Dashboard / Trends / Budget pages). **This is likely the highest-value next ticket.**

### 21.3 The 5-device test sweep is the agreed standard

Not Pixel 7. The 5 phones: **iPhone SE 320×568, Pixel 5 393×727, Pixel 7 412×839, iPhone 14 390×664, iPhone 14 Pro Max 430×740**. Hemanth's own device is Pixel 7 but he's testing for the cousins/friends on iPhones (all WebKit).

### 21.4 Specific recent transaction descriptions he used to test

These broke the NL parser at various points; all now in the 32-case real-world battery:

- `"biryani 10 may07th 03:04PM"`
- `"cab 04:45 PM may15th 67"`
- `"ate biryani on 18th May 45 dollars at 07:34 PM"`
- `"chai 5"` (bare hour without meridiem)
- `"groceries 3pm yesterday 45"` (multi-result chrono)

### 21.5 The 12 food/transport icons added recently

`pizza, coffee, cup, icecream, cake, donut, sushi, salad, bowl, bus, train, medical` — wired into `categoryIconName()`. Common South-Asian food names map to `bowl` (biryani / curry / dal / idli / dosa / rice). Coffee/chai/tea → coffee. Milkshake/coke → cup.

### 21.6 The "Eating out" → "Food" rename

Was a Hemanth call. "Eating out" implied restaurants; he wanted the bucket to cover groceries + cooking + dining (task #105). Keep "Food" — don't rename back.

### 21.7 The category seed has 24 defaults but Hemanth wants it leaner

Task #97 (pending): trim to ~8 essentials. He prefers to delete what he doesn't need (safe-delete is in place) rather than have me prune the seed. Don't prune defaults unilaterally.

### 21.8 The Google sign-in is "gated" — there's an escape hatch

"Continue without sync" lets the user skip Google sign-in. Many friends will use this. The app must be fully usable without Drive sync.

### 21.9 The reports/overnight-build directory

That's where the verif-kit overnight build's progress logs live (per `project_deployed_live.md`). NOT in the spec-kit `tasks.md` for this project. Don't confuse the two.

### 21.10 The verif-kit project (separate repo)

Hemanth built a portable spec-kit-style verification tool. Lives at github.com/chitti-learns-ai/verif-kit. Renamed from "VeriKit" — never use that name. Tasks #69–#78 cover this work. Out of scope for TrackCents unless he asks.

### 21.11 The "discoverability hint" specifics

The sub-cat hint in `CategoryPicker.svelte` shows ONLY when:

- `!editMode && !hasAnySub && restrictToParent === undefined && onCreate !== undefined && query.trim().length === 0`
- Once the user creates one sub anywhere, the hint disappears FOREVER (no toggle to bring it back).

### 21.12 Things he NEVER asked for but I assumed

- Sticky bars / sticky toolbars (rejected twice)
- Preview chip strips (rejected)
- Auto-focus on picker search (rejected — opens like dropdown without keyboard)
- Modal sub-pickers (rejected — Category picker handles parents + children together)
- AI summarization of his spending (NEVER do this; constitution principle)

### 21.13 The conversation is at this path (very long jsonl)

`C:\Users\tnvmu\.claude\projects\C--Users-tnvmu-Downloads-Projects-Hemanth-money-management-tool\02778bc0-92d7-4e4e-84a2-f0aca3276d4a.jsonl`

It's faster to read MEMORY.md + this doc + the relevant commit messages than to read the jsonl.

---

## 22. Final notes for the new AI

- All recent commits are in `git log`. The commit messages I wrote are intentionally long and capture rationale — read them when investigating a "why was this here?" question.
- The `.git/COMMIT_EDITMSG_*.txt` files are throw-away commit drafts. Ignore.
- The chef-supervisor agent at `.claude/agents/chef-supervisor.md` is supposed to run a 23-question gate at every subtask boundary. I sometimes forgot. The next AI should run it proactively (see MASTER_CHEF.md).
- **Hemanth's name is Hemanth.** Don't call him "the user" in chat replies.
- Final summaries should be short (1-2 sentences). See `feedback_simple_final_summary.md`.
- This doc is intentionally long. It exists so Hemanth doesn't have to re-explain anything. If something here is wrong or outdated, fix it — don't leave the next-next AI a stale handoff.

Good luck.

— Claude Opus 4.7
