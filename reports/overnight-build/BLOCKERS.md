# Overnight build — blockers & morning to-dos (need YOU)

> Things I could not do autonomously (need a human decision, a live account, or an
> asset). I skipped these and kept building everything else. Review in the morning.

## Needs you (carried over + new)
1. **Live two-device Google Drive sync test** — code written, only verifiable in a browser with your account.
2. **Add the production origin to your Google OAuth client** — required before the deployed (GitHub Pages) URL can do Google sign-in. I'll put the exact origin in the deploy notes once the Pages URL is known (likely `https://<your-gh-username>.github.io`).
3. **Recovery code (T115)** — needs the envelope-encryption crypto redesign + its own IV&V; deferred by decision.
4. **Real app icon / logo** — placeholders in use.
5. **A checksum-valid anonymized real statement** — needed for a true green-path import E2E (committed samples are vendor marketing PDFs that don't reconcile).

## To confirm in the morning (I made a reasoned call; see DECISIONS.md)
- Recurring detection heuristic (D1), ignore/split/tags modeling (D2–D4), Home-as-default (D5).
- Any Rocket-Money feature I judged out-of-scope for a PDF/manual app (e.g., bill negotiation, credit-score monitoring, bank-link auto-sync) — these are intentionally NOT built.

## ⭐ Deploy: see the new root **DEPLOY.md** (copy-paste runbook for both options)
A clean step-by-step is now at `DEPLOY.md` (repo root). Also FIXED a latent bug in
`.github/workflows/deploy.yml`: its `BASE_PATH` auto-detect tested `name != owner`, which is TRUE for
a user-site repo (`<owner>.github.io`) too — so the recommended Option A would have wrongly built with
`BASE_PATH=/<owner>.github.io` and broken the deployed app. Now tests `name != "<owner>.github.io"`, so
a user-site repo correctly gets base `""` and a project repo gets `/<repo>`. (Project-subpath still
needs the `{base}` link pass before its nav works — Option B in DEPLOY.md; say the word and I'll do it.)

## Deploy steps for tomorrow (T-D1/T-D2 done — workflow ready; DEPLOY.md is the runbook)
The GitHub Pages workflow is at `.github/workflows/deploy.yml` and `svelte.config.js` now honors
`BASE_PATH`. To deploy:
1. Push this repo to GitHub. **Recommended: name the repo `<your-username>.github.io` (a user
   site).** Then it serves at the root, `BASE_PATH` auto-resolves to `""`, and every internal link
   works as-is — zero extra work.
2. Repo → Settings → Pages → Source = **GitHub Actions**.
3. (Optional, for Drive sync on the live site) Repo → Settings → Secrets and variables → Actions →
   Variables → add `PUBLIC_GOOGLE_OAUTH_CLIENT_ID` = your client id. And in Google Cloud Console add
   the live origin (`https://<your-username>.github.io`) to the OAuth client's Authorized JavaScript
   origins. Without this the deployed app still works **local-only**.
4. Push to `main` (or run the workflow manually) → it builds + publishes.

**⚠ Decision needed if you want a PROJECT repo instead** (e.g. `username.github.io/money_management_tool`,
like your cousin's `bhargavsammeta.github.io/pricewatch`): the app currently uses root-absolute internal
links (`/today`, `/transactions`…), which break under a subpath. I did NOT do the base-prefix link pass
overnight because it can't be click-tested unattended without risking broken navigation. If you want the
project-subpath deploy, tell me in the morning and I'll do the `$app/paths` base-prefix pass across the
nav + routes (≈30 min) and verify it. The user-site option above avoids this entirely.

## Contract-tightening notes from IV&V (no bugs; tighten the spec when convenient)
The two fresh-context verifiers signed off but flagged spec wording to pin so future re-verification
has an unambiguous oracle (the DUT behavior is already the desired behavior — these are doc edits):
- **csv-import D1** — `parseCsvRows('   ')` (a spaces-only line) returns `[['   ']]`, not `[]`. R4 has
  two clauses that conflict for a non-empty-but-whitespace cell; the parser follows the RFC-faithful
  reading. Decide whether a whitespace-only line should be skipped.
- **csv-import D2** — CSV import TRIMS leading/trailing whitespace from descriptions (embedded
  whitespace preserved). Confirm R9 should say "descriptions are trimmed".
- **csv-import D3** — negative amounts with a half-cent round half-AWAY-from-zero (sign-symmetric with
  the positive example). Confirm R5 should state the negative rounding direction.
- **refund-resolution A1** — `categorizableFromImports` is a public export with no written contract
  requirement. Behavior is verified black-box (one {key, description} per txn). Add an explicit R0 if
  you want it pinned. (No bug.)
- **refund-resolution A2** — "description = custom_name if set else parsed" — the empty-string
  custom_name case is unstated; current behavior treats `''` as not-set → falls back to the parsed
  description (matches pruneAnnotation). Confirm that's intended. (No bug.)
- **merchant-trends A1** — RESOLVED autonomously (DECISIONS D13): same-day charges to one merchant now
  use a deterministic tiebreak (amount asc, then description) so trends are import-order-independent.
  Confirm you're happy with that resolution (the alternative was to leave same-day order unspecified).

## A real bug the overnight IV&V caught (FYI — already fixed)
merchant-trends sorted same-day charges by input order, so the "biggest price jump" could differ
depending on the order statements were imported. Fixed with a deterministic tiebreak (D13). This is
exactly why the independent metamorphic verification exists — the example-based tests + the VE's own
scoreboard both passed; only the oracle-free permutation-invariance relation exposed it.

(appended as the night proceeds)
