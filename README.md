# Money Tracker

A private, offline-first personal finance tool. Drop bank and credit card PDF statements; see exactly where the money went; drill from a bank "payment to credit card" line into the actual transactions on that credit card statement.

Built for individual use and a small group of friends, not as a commercial product.

## Status

**Pre-release. Phase 1 (Setup) scaffolding in progress.** See [specs/001-money-tracker-mvp/](specs/001-money-tracker-mvp/) for the full implementation plan.

## What makes this different

- **All processing is on your device.** PDFs are parsed in your browser. No bank statement ever leaves your machine in unencrypted form.
- **Zero-knowledge cloud sync.** Optional sync to your own Google Drive folder, encrypted with a passphrase only you know. We can't decrypt your data. Google can't decrypt your data. Even with a full account compromise, the encrypted blob is gibberish without your passphrase.
- **No AI reads your statements.** Parsing is deterministic per-bank code. A checksum gate refuses any import where parsed totals don't reconcile to the printed statement totals — silent parser errors are impossible by design.
- **Open source, AGPL-3.0.** Every privacy claim is verifiable by reading the source.
- **Zero infrastructure cost.** Hosted as static files on GitHub Pages. Your sync uses your own cloud storage. No servers we operate.

## Governing documents

Decisions are made by spec, not by feel. See:

- **[Constitution](.specify/memory/constitution.md)** — 15 binding rules. Every PR is reviewed against these.
- **[Feature spec](specs/001-money-tracker-mvp/spec.md)** — what we're building in v1.
- **[Implementation plan](specs/001-money-tracker-mvp/plan.md)** — architecture, phasing, tech stack.
- **[Research](specs/001-money-tracker-mvp/research.md)** — why we picked each technology.
- **[Data model](specs/001-money-tracker-mvp/data-model.md)** — concrete SQL schema.
- **[Contracts](specs/001-money-tracker-mvp/contracts/)** — interface boundaries.
- **[Tasks](specs/001-money-tracker-mvp/tasks.md)** — actionable build steps.
- **[Quickstart](specs/001-money-tracker-mvp/quickstart.md)** — developer setup + smoke test.

## Tech stack (locked by constitution)

- **Frontend**: Svelte 5 + SvelteKit (SPA mode via `adapter-static`), Tailwind CSS 4, shadcn-svelte primitives.
- **PDF parsing**: PDF.js (Mozilla) with custom TypeScript layout-aware extraction + per-bank regex.
- **Local storage**: SQLite via wa-sqlite + Origin Private File System (OPFS), with IndexedDB fallback.
- **Encryption**: AES-256-GCM + PBKDF2-SHA-256 (600k iterations) via the browser's Web Crypto API.
- **Sync**: User's own Google Drive folder (scope `drive.file` only), encrypted blob.
- **Charts**: ECharts (lazy-loaded).
- **Hosting**: GitHub Pages, free, static.

## Quickstart

See [specs/001-money-tracker-mvp/quickstart.md](specs/001-money-tracker-mvp/quickstart.md) for the full developer setup. Short version:

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173.

## Supported banks

To be populated as bank-specific parsers ship. Each supported bank requires one anonymized real statement as a regression test fixture (per [constitution Principle VIII](.specify/memory/constitution.md#viii-one-statement-validation-per-bank)).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).

## Security

If you discover a privacy or security issue, please refer to [SECURITY.md](SECURITY.md) (to be added) for the disclosure process. Do not open a public issue.
