// Stop hook — runs after every Claude Code turn.
//
// Two jobs, both INFORM-only (never block; exit 0 always):
//
//   1. If the turn edited source, run a fast check (`pnpm check && pnpm test`)
//      and report pass/fail.  Output flows into the next prompt so failures
//      cannot be silently shipped.  (Full `pnpm verify` is for pre-commit.)
//
//   2. IV&V reminder: if a non-trivial LOGIC module changed but has no
//      independent test in `tests/unit/independent/`, remind Claude to run
//      `/ivv` on it.  This makes Independent Verification effectively
//      automatic — the nag repeats every turn until the module has been
//      independently verified (see .claude/skills/ivv/SKILL.md).
//
// Hook output appears in the next prompt's system reminder, so Claude sees
// "verify FAILED" / "GREEN" and the IV&V reminder automatically.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ── DISABLED 2026-05-26 at the user's request ──────────────────────────────
// This Stop hook auto-ran `pnpm check && pnpm test` after every Claude turn —
// the ~2-minute "Verifying (pnpm check + tests)…" spinner. The hook was also
// removed from .claude/settings.json (so it won't load in new sessions); this
// early exit neutralizes it in the CURRENT session too, since hook config is
// loaded at session start and the in-memory hook keeps calling this script.
// TO RESTORE: delete the `process.exit(0)` line below AND re-add the Stop hook
// block to .claude/settings.json (the exact JSON is in that file's _comment).
process.exit(0);
// ───────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

// 1. Detect whether the turn touched any source code or tests.
let changedFiles = '';
try {
  changedFiles = execSync('git status --porcelain', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
} catch {
  process.exit(0); // not a git repo / git unavailable
}

const changedPaths = changedFiles
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => l.slice(3).trim().replace(/^"|"$/g, '')); // strip " M " prefix + any quotes

const SOURCE_PATTERNS = [
  /\bsrc\/.*\.(ts|svelte|js|css)$/,
  /\btests\/.*\.(ts|js)$/,
  /\bscripts\/.*\.(ts|mjs|js)$/,
  /\b(package\.json|pnpm-lock\.yaml|vitest\.config\.ts|vite\.config\.ts|tsconfig\.json|eslint\.config\.js)$/
];

const touchedSource = changedPaths.some((path) => SOURCE_PATTERNS.some((re) => re.test(path)));

if (!touchedSource) {
  process.exit(0); // no code change → nothing to verify → silent exit
}

// ── IV&V reminder computation (cheap; just filesystem existence checks) ──
//
// A "logic module" is real computation we want independently verified:
//   src/lib/{app,util,db}/<name>.ts  (excluding type/glue files)
//   src/lib/adapters/<bank>/adapter.ts
// The independent suite for module <name> lives at
//   tests/unit/independent/<name>.ivv.test.ts
const GLUE = /\/(types|index|schema-sql|load-store|import)\.ts$/;
function moduleName(p) {
  const parts = p.split('/');
  const base = parts[parts.length - 1].replace(/\.ts$/, '');
  return base === 'adapter' ? parts[parts.length - 2] : base; // adapter.ts → bank dir name
}
const changedLogic = changedPaths.filter(
  (p) =>
    (/^src\/lib\/(app|util|db)\/[^/]+\.ts$/.test(p) ||
      /^src\/lib\/adapters\/[^/]+\/adapter\.ts$/.test(p)) &&
    !/\.(test|spec)\.ts$/.test(p) &&
    !GLUE.test(p)
);
const needsIvv = changedLogic.filter(
  (p) => !existsSync(join(ROOT, 'tests', 'unit', 'independent', `${moduleName(p)}.ivv.test.ts`))
);
const ivvReminder =
  needsIvv.length > 0
    ? `\n[stop-hook] ⓘ IV&V reminder: these logic modules changed but have NO independent test in tests/unit/independent/ — run \`/ivv\` on them before claiming the feature done (the verification of record):\n  ${needsIvv.slice(0, 8).join('\n  ')}`
    : '';

// 2. Run the FAST inner-loop check (not full verify).
const startTime = Date.now();
const result = spawnSync('pnpm', ['check'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

if (result.status !== 0) {
  const errSnippet = (result.stderr || result.stdout || '').slice(-800);
  console.log(
    `\n[stop-hook] ❌ pnpm check FAILED (${((Date.now() - startTime) / 1000).toFixed(1)}s).  Fix TypeScript errors before claiming done.\n` +
      `Tail of output:\n${errSnippet}${ivvReminder}`
  );
  process.exit(0);
}

const testResult = spawnSync('pnpm', ['test'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
if (testResult.status !== 0) {
  const errSnippet = (testResult.stderr || testResult.stdout || '').slice(-1200);
  console.log(
    `\n[stop-hook] ❌ tests FAILED (${elapsed}s).  Fix the failing tests before claiming done.  Run \`pnpm test\` to reproduce locally.\n` +
      `Tail of output:\n${errSnippet}${ivvReminder}`
  );
  process.exit(0);
}

console.log(
  `\n[stop-hook] ✓ check + tests GREEN (${elapsed}s).  Full verify chain (lint/format/build/coverage) NOT yet run — invoke /validate or \`pnpm verify\` before committing.${ivvReminder}`
);
process.exit(0);
