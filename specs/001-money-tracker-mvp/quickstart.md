# Quickstart — Money Tracker v1 Foundation

**Branch**: `001-money-tracker-mvp` | **Date**: 2026-05-23 | **Plan**: [plan.md](./plan.md)

This is the developer-facing setup guide for a fresh clone. By the end of the Phase 0 instructions you should be able to drop a PDF on a local web page and see parsed transactions in your browser.

---

## Prerequisites (one-time, per machine)

- **Node.js 22+** (check with `node --version`).
- **pnpm 9+** (`npm install -g pnpm` once if you don't have it).
- **Python 3.11+** + **uv** (already installed during spec-kit setup; only needed for the spec-kit CLI itself, NOT for the runtime app).
- **Git 2.40+**.
- **A modern browser**: Chrome / Edge / Firefox / Safari latest.
- (Recommended) **VS Code** with the Svelte for VS Code extension.

---

## Clone and install (once)

```powershell
git clone https://github.com/<your-org>/money-management-tool.git
cd money-management-tool
git checkout 001-money-tracker-mvp
pnpm install
```

After install completes you should see `node_modules/` populated and no errors.

---

## Phase 0 — Parser proof-of-concept

The goal of Phase 0 is to validate that we can parse one of your real bank statements end-to-end. There is no UI polish, no database, no encryption, no sync. Just: drop a PDF, see the transactions, check that the totals add up.

### Step 1 — Place a real statement

Drop your anonymized real PDF (see "How to anonymize" below) at:

```
tests/fixtures/<bank-slug>/sample.pdf
```

Where `<bank-slug>` is a kebab-case version of the bank name (e.g. `chase`, `bofa`, `capital-one`). Create the directory if needed.

### Step 2 — Run the dev server

```powershell
pnpm run dev
```

This starts Vite with hot reload on `http://localhost:5173`.

### Step 3 — Open the page and drop the PDF

1. Open `http://localhost:5173` in any modern browser.
2. The Phase 0 page is intentionally bare: a single drop zone.
3. Drag your `sample.pdf` into the drop zone.
4. Wait a second.

### Step 4 — Verify the output

You should see:

- A table with one row per transaction: `Date`, `Description`, `Amount`.
- At the top of the table, a status banner reading:
  - **GREEN**: "✓ Checksum verified: parsed sum matches printed totals." → Phase 0 is succeeding for this bank.
  - **RED**: "✗ Checksum mismatch: parsed sum is $X, statement says $Y." → Parser drift; do NOT use this bank in production until the diff is investigated.
  - **YELLOW**: "Bank not supported yet." → Adapter detection failed; we need to add an adapter for this bank.

Open the browser console; the parsed JSON output is also logged there for inspection.

### Step 5 — Add the fixture to the test suite

If Step 4 was GREEN, save the parsed output as a regression fixture:

```powershell
pnpm run gen:fixture <bank-slug>
```

This reads `tests/fixtures/<bank-slug>/sample.pdf`, runs the parser, and writes `tests/fixtures/<bank-slug>/expected.json`. From now on, CI will run the parser against `sample.pdf` and assert byte-equality with `expected.json`. Any future parser change that breaks this fixture fails CI.

---

## How to anonymize a real statement before sharing it

Per constitution: real bank statements MUST be anonymized before any are committed to the repo or shared with anyone (including the AI agent during design work).

The simplest method:

1. Open the PDF in your usual reader.
2. Press Ctrl+A to select all text, Ctrl+C to copy.
3. Open Notepad / VS Code. Paste.
4. Find-and-replace:
   - Your full name → `ACCOUNT HOLDER`
   - Home address → `ADDRESS REDACTED`
   - Phone / email → `CONTACT REDACTED`
   - Full account numbers → keep just last 4 digits, e.g. `XXXX-XXXX-XXXX-1234`
   - Any name appearing inside transaction descriptions
   - SSN / tax ID if present
5. Save as `sample.txt`.

For Phase 0 we work with the .txt version. For Phase 1+ we need the actual PDF, but you keep YOUR unmodified PDFs locally on YOUR machine — never commit them.

The repo's `.gitignore` already excludes `*.pdf` except those under `tests/fixtures/`. Anonymized PDFs under `tests/fixtures/<bank>/` ARE committed (with the user's explicit consent).

---

## Phase 1 — Schema and persistence (after Phase 0 works)

```powershell
# Apply the initial schema
pnpm run db:migrate

# Run the full test suite
pnpm run test
```

This bootstraps a local SQLite file in OPFS (or IndexedDB on browsers without OPFS). The test suite includes parser snapshot tests + repository contract tests + checksum invariant tests.

To reset your local data (does NOT touch Drive):

```powershell
pnpm run db:reset
```

---

## Phase 2 — PWA + encryption (after Phase 1)

```powershell
# Generate a fresh dev passphrase + salt for local development
pnpm run dev:keygen

# Run with PWA mode enabled (service worker registered)
pnpm run dev -- --pwa
```

In the browser, you'll see:

- Onboarding flow on first run.
- iOS Safari users will see the Add to Home Screen guide.
- After passphrase setup, the local SQLite file is encrypted at rest with your derived key.

---

## Phase 3 — Google Drive sync (after Phase 2)

You need a Google Cloud Platform project with the Drive API enabled and an OAuth Client ID. See `docs/setup-google-drive.md` (written during Phase 3 implementation).

For local development, set the OAuth client ID in `.env.local`:

```
PUBLIC_GOOGLE_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
```

Then:

```powershell
pnpm run dev
```

Click "Sign in with Google" in the app, grant access to the `MoneyTracker/` folder, and your encrypted blob will start syncing.

---

## Running tests

```powershell
# Unit tests (parsers, crypto, schema, reconciliation)
pnpm run test

# Watch mode for development
pnpm run test:watch

# End-to-end tests (Playwright)
pnpm run test:e2e

# Coverage report
pnpm run test:cov
```

The CI runs `pnpm run test` and `pnpm run test:e2e` on every PR. Both must pass.

---

## Building for production (GitHub Pages)

```powershell
pnpm run build
```

This produces a static `build/` directory ready for GitHub Pages. The production build:

- Has all assets bundled (no external CDN fetches).
- Includes the service worker (PWA).
- Tree-shakes unused code.
- Generates source maps but does NOT include them in the deployed bundle (set `--sourcemaps=hidden` if you want them generated but not referenced).

CI deploys `build/` to GitHub Pages on every merge to `main`.

---

## Common issues

### "OPFS is not available in this browser"
You're on an older Safari (<17) or Firefox (<111). The app falls back to IndexedDB automatically; you should not need to do anything. If you want to force the fallback in dev, set `PUBLIC_FORCE_IDB=1` in `.env.local`.

### Parser detector picks the wrong bank
Add more discriminating tokens to the adapter's `detect()` implementation. Each adapter's `detect()` should look for at least one bank-specific phrase that no other supported bank prints.

### Checksum fails on a statement that "looks fine"
This is the parser drift case. Inspect the parsed JSON in the browser console. Compare against the printed statement totals. Usually the cause is one of:
- A line that's not actually a transaction (header, footer) being included.
- A multi-line description being split incorrectly.
- A new layout in the statement (e.g., a new "Pending" section) that we don't recognize.

Update the adapter to handle the case, then re-run the fixture. If the fixture `expected.json` should change, regenerate it explicitly with `pnpm run gen:fixture <bank>` and review the diff carefully before committing.

### Google Drive sync fails with `invalid_grant`
Your refresh token expired (the user revoked access, or 6 months passed without use). Sign out and sign back in.

---

## Smoke test for Phase 0 success

Before declaring Phase 0 "done" and proceeding to Phase 1, the following MUST be true:

- [ ] At least one anonymized real statement from YOUR most-used bank lives at `tests/fixtures/<bank>/sample.pdf`.
- [ ] Dropping that PDF on the Phase 0 dev page produces a GREEN checksum banner.
- [ ] Every parsed transaction's `amount_minor`, `description`, and `posted_date` matches the PDF when spot-checked manually.
- [ ] `pnpm run test` passes (the fixture snapshot test for this bank is green).
- [ ] No floating-point values appear anywhere in the parsed output (open the console JSON dump and search for `.` in any amount-looking field).

If all five hold, Phase 0 is shipped. Begin Phase 1.

If any of the five fail, do NOT proceed. Investigate and fix the parser; Phase 1 builds on top of Phase 0's accuracy.
