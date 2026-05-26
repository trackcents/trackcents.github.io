# Threat model — Money Management Tool

**Date**: 2026-05-24
**Approach**: STRIDE-lite. We are a client-side-only static PWA. Most categories don't apply. The ones that DO are tracked here with concrete mitigations and assigned to specific verification gates.

## Project shape (defines the attack surface)

| Property                     | Value                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Architecture                 | Single-page static app, served from GitHub Pages                                                  |
| Backend                      | **None.** No HTTP API, no server, no shared infrastructure                                        |
| Persistence                  | OPFS file in user's browser; future Phase 1B: wa-sqlite (still client-side)                       |
| Sync target (future Phase 8) | User's own Google Drive folder, AES-256-GCM encrypted blob (zero-knowledge)                       |
| Auth (future US-P1-A)        | Google OAuth (just for Drive scope); PBKDF2 passphrase for blob encryption                        |
| Third-party data ingest      | PDF files the user drops in (parsed entirely in-browser via PDF.js)                               |
| Inbound network at runtime   | None except OAuth + Drive API (future). No telemetry, no analytics (Constitution Principle XIII). |
| Outbound user data           | None pre-Phase 8. Post-Phase 8: only the encrypted blob to user's own Drive.                      |

## STRIDE assessment

| Category                       | Applicable? | Threats specific to this project                                                                             |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| **S — Spoofing**               | Partial     | Someone could host a malicious clone at a similar URL and trick the user into uploading PDFs to a fake site. |
| **T — Tampering**              | Yes         | A compromised npm dependency could exfiltrate PDF contents at parse time.                                    |
| **R — Repudiation**            | N/A         | Single-user app. No multi-actor logs.                                                                        |
| **I — Information disclosure** | Yes         | PII / financial data on disk; PII in committed test fixtures; secrets in source.                             |
| **D — Denial of service**      | Low         | Self-hosted PWA; attacker DoS-ing the user's own browser is largely self-inflicted.                          |
| **E — Elevation of privilege** | N/A         | No privilege boundaries inside the app.                                                                      |

## Threats and mitigations

### T1 — Compromised npm dependency exfiltrates PDF contents

**Likelihood**: Medium. The May 2026 npm worm proved this attack vector is alive.
**Impact**: High. PDFs contain account numbers, names, addresses, transaction-level PII.
**Mitigations in place**:

- `lockfile-lint` pins package source registry + integrity hash (catches a poisoned mirror).
- `pnpm audit --audit-level=high` in CI fails the build on a known-CVE dependency.
- Gitleaks pre-commit + CI (when installed) catches accidentally committed secrets.
- Constitution Principle XIII forbids analytics / telemetry SDKs (the most common exfil vector).
- Direct dependency tree audited: pdfjs-dist (Mozilla, Apache 2.0), wa-sqlite (Roy Hashimoto, MIT), bits-ui (Huntabyte, MIT). No "convenience" wrappers around HTTP or storage.

**Verification gate**: `pnpm security` runs lockfile-lint + audit. CI runs both.

### T2 — Accidentally committed PII or credentials

**Likelihood**: Medium. We work with anonymized real PDFs locally; one mis-handled file would leak.
**Impact**: High. Bank statement leak is hard to walk back.
**Mitigations in place**:

- `.gitignore` excludes `*.pdf` except `tests/fixtures/**/*.pdf` (only anonymized samples).
- `.gitignore` excludes `*.anonymized.json` and `*.anonymized.txt`.
- The anonymizer is local-only; outputs go to OneDrive (excluded by path).
- Memory note `feedback_anonymizer_collapses_cells.md` documents the synthetic-only commit rule.
- Gitleaks pre-commit hook (when installed locally per setup below) blocks pushes with secret-shaped strings.

**Action**: install Gitleaks locally — see "Setup" below. CI step added.

### T3 — Malicious PDF causes JavaScript engine exploit or DoS

**Likelihood**: Low. PDF.js is Mozilla-maintained; same engine ships in Firefox.
**Impact**: Bounded by browser sandbox.
**Mitigations in place**:

- PDF.js sandboxes JavaScript inside PDFs by default.
- `disableFontFace: true` + `useSystemFonts: false` in our extractPdfTextWithPositions reduce font-related attack surface.
- Worst case: a malicious PDF crashes the parser → our orchestrator surfaces "extract_failed" → no state change → user re-tries with a different file.

**Verification gate**: existing extract_failed branch in `import.ts`, covered by E2E "non-PDF rejected" test.

### T4 — Persisted-state corruption (T at REST, after data is in OPFS)

**Likelihood**: Low.
**Impact**: Medium. A corrupted blob with money values as floats could silently cascade into wrong balances.
**Mitigations in place**:

- Zod schema (`src/lib/db/schema.ts`) validates EVERY load — money MUST be bigint, dates MUST be ISO. Failure throws loudly rather than displaying wrong data.
- Schema check runs at every `loadState()` call.

**Verification gate**: `tests/unit/db/schema.test.ts` (13 tests).

### T5 — Phishing clone hosted at typo-squat URL

**Likelihood**: Low for now (we have no distribution).
**Impact**: High if it ever happens.
**Mitigations** (deferred to v1 launch):

- Custom domain on GitHub Pages with HTTPS-only.
- HSTS preload list submission.
- Document the canonical URL in README, in-app help, and the constitution.
- Subresource Integrity if we add any third-party JS (currently we don't).

**Verification gate**: not enforced today; revisit on v1 release.

### T6 — Future Drive sync data exfiltration

**Likelihood**: Low.
**Impact**: Critical — but constitution mandates zero-knowledge.
**Mitigations** (will be enforced when Phase 8 lands):

- AES-256-GCM via Web Crypto API with PBKDF2-SHA-256 (600k iterations) for key derivation.
- Per-user random salt (non-secret) stored alongside blob.
- Encrypted blob is opaque to Google.
- OAuth scope restricted to one dedicated folder (`drive.file`).
- No recovery path by default — user must opt-in to a recovery code.

**Verification gate**: not yet — Phase 8 work. Will need unit tests for KDF, AES round-trip, blob framing.

## Items intentionally OUT of scope

- **SQL injection** — no SQL in scope yet; deferred to Phase 1B with wa-sqlite (will need careful prepared-statement discipline).
- **CSRF / SSRF** — no server endpoints to attack.
- **DDoS** — no server.
- **PCI-DSS** — we never see card numbers in the cleartext sense (only statement summaries from PDFs the user already has).
- **HIPAA** — not applicable.
- **GDPR** — user is the data controller; we never collect or transmit. Consider when distribution / sync ship.

## Setup — Gitleaks (run once per machine)

Gitleaks scans for committed secrets. We rely on it pre-commit and in CI.

### Windows (your machine)

```powershell
# Download latest release from https://github.com/gitleaks/gitleaks/releases
# Extract gitleaks.exe to a PATH directory, e.g. C:\Users\<you>\bin\
gitleaks version  # confirm install
```

### Pre-commit hook (optional but recommended)

```bash
gitleaks protect --staged --redact
```

Place that line in `.git/hooks/pre-commit` to block commits containing secret-shaped strings.

### CI

A GitHub Actions step is configured in `.github/workflows/ci.yml` to run on every PR — no local install needed for CI.

## Setup — Semgrep (CI only)

Semgrep CE is free, runs in CI, no local install required. Custom rules live in `.semgrep/` (created next session if any need to be added beyond defaults).

## Audit cadence

| What                  | Frequency                                                                      |
| --------------------- | ------------------------------------------------------------------------------ |
| `pnpm audit`          | Every commit (CI); manually on dependency update                               |
| `pnpm lint:lockfile`  | Every commit (CI)                                                              |
| Gitleaks              | Every commit (CI + pre-commit if installed)                                    |
| Manual STRIDE re-walk | When a new external interface is added (sync, OAuth, etc.)                     |
| OWASP Top 10 review   | Annually or when distribution changes (e.g., publishing to a package registry) |
