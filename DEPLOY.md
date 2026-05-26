# Deploying Money Tracker to GitHub Pages

The app is a static SvelteKit PWA (adapter-static). Hosting is free GitHub Pages; there is no
server. A workflow at `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

Pick **one** of the two options below. **Option A is recommended** (zero extra work).

---

## Option A — user/org site repo `<your-username>.github.io` (recommended)

Serves at `https://<your-username>.github.io/` (the domain root). Because it's the root,
`BASE_PATH` auto-resolves to `""` and **every internal link works as-is** — nothing else to do.

1. Create a GitHub repo named **exactly** `<your-username>.github.io` (e.g. `chitti-learns-ai.github.io`).
2. Push this project to it:
   ```bash
   git remote add origin git@github.com:<your-username>/<your-username>.github.io.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages → Build and deployment → Source = GitHub Actions**.
4. The push (or "Run workflow" on the Actions tab) builds + publishes. Live in ~2 min.

That's it. The app runs **fully local-only** (PDF import, all features) without any further setup.

## Option B — project repo (subpath, like your cousin's `…/pricewatch`)

Serves at `https://<you>.github.io/<repo-name>/`. The workflow auto-sets `BASE_PATH=/<repo-name>`.

⚠️ **Not fully wired yet.** The app's internal navigation uses root-absolute links (`/today`,
`/transactions`, …). Under a subpath those need a `$app/paths` `base`-prefix pass across the nav +
routes (~30 min) — deliberately NOT done overnight because it can't be click-tested unattended
without risking broken navigation (see `reports/overnight-build/BLOCKERS.md`). **If you want Option B,
say so and I'll do the base-prefix pass + verify it before you deploy.** Until then, use Option A.

---

## Optional — Google Drive sync on the live site

The app works local-only with no setup. To enable cross-device sync via your own Drive:

1. Repo → **Settings → Secrets and variables → Actions → Variables → New variable**:
   `PUBLIC_GOOGLE_OAUTH_CLIENT_ID` = your OAuth client id (public/non-secret; baked at build time).
2. In Google Cloud Console, add your live origin to the OAuth client's **Authorized JavaScript
   origins**: `https://<your-username>.github.io` (Option A) or the project URL (Option B).
3. Re-run the workflow.

Without this, sync is simply disabled; everything else works.

## Before you push — sanity check locally

```bash
pnpm verify        # format + lint + typecheck + 1133 tests + build  (must be GREEN)
pnpm exec vite preview --port 4173   # then open http://localhost:4173 and click around
```

## Notes / troubleshooting

- **Custom domain (CNAME) on a project repo**: it then serves at root, so `BASE_PATH` should be `""`.
  An _empty_ repo Variable reads as "unset" (auto-detect kicks in and would use `/<repo>`), so set the
  `BASE_PATH` Variable to `/` for a root-served custom domain, or use Option A.
- **iOS Safari**: the onboarding nudges "Add to Home Screen" before passphrase setup (survives the
  7-day storage eviction) — expected, not a bug.
- **Privacy**: never commit real bank statements, your real name/address, or the `.env` with secrets.
  PDF parsing is 100% on-device; the synced blob (if you enable Drive) is client-side encrypted.
- **Data is local per browser.** To move devices, use Settings → Export backup (JSON), then Restore on
  the other device (it carries imports + categories + budgets + goals).
