// PreCompact hook — fires JUST before Claude's context is compacted.
//
// Purpose: write a one-page session-state snapshot to disk so the NEXT
// session (after compaction) can pick up where this one left off.
//
// What we capture:
//   - timestamp + reason for compaction (if available)
//   - git status (which files are dirty)
//   - the latest validation report filename (if any)
//   - any pending tasks from the task tracker (best-effort)
//
// Output: `reports/session-state.md` — overwrites each time so the file
// always reflects the LATEST compaction event.  Future Claude sessions
// can read this to reconstruct context cheaply.

import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const REPORTS_DIR = join(ROOT, 'reports');
const OUTFILE = join(REPORTS_DIR, 'session-state.md');

if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

const now = new Date().toISOString();

let gitStatus = '(git unavailable)';
let lastCommit = '(unknown)';
try {
  gitStatus = execSync('git status --short', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  lastCommit = execSync('git log -1 --pretty=format:"%h %s (%cr)"', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
} catch {
  /* not a git repo or git not available */
}

// Find the most recent validation report, if any.
const VALIDATION_DIR = join(ROOT, 'reports', 'validation');
let latestValidation = '(no validation report on disk)';
if (existsSync(VALIDATION_DIR)) {
  try {
    const files = readdirSync(VALIDATION_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort();
    if (files.length > 0) latestValidation = files[files.length - 1];
  } catch {
    /* directory listing failed */
  }
}

// Hook may receive JSON on stdin describing the compaction trigger.  Best
// effort to grab it; not fatal if absent.
let triggerReason = '(unknown trigger)';
try {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (stdin += chunk));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(stdin);
      if (payload?.trigger) triggerReason = String(payload.trigger);
    } catch {
      /* not JSON; ignore */
    }
    writeSnapshot();
  });
  // If stdin is not a pipe, on('end') may never fire.  Fallback after 500ms.
  setTimeout(writeSnapshot, 500);
} catch {
  writeSnapshot();
}

let written = false;
function writeSnapshot() {
  if (written) return;
  written = true;

  const body = `# Session state snapshot

Written by \`scripts/hook-precompact.mjs\` at **${now}** just before Claude's context was compacted.

The NEXT Claude session can read this file to reconstruct what was in flight.

## Compaction trigger
${triggerReason}

## Git state at compaction
\`\`\`
${gitStatus || '(working tree clean)'}
\`\`\`

Last commit: ${lastCommit}

## Latest validation report
${latestValidation}

(See \`reports/validation/\` for the full file. If validation hasn't been run recently, run \`pnpm verify\` or invoke /validate first.)

## How to use this file

When a new Claude session starts and the user asks "where are we" or anything similar:
1. Read this file first.
2. Read \`specs/<latest>/tasks.md\` to see implementation progress.
3. Read the latest validation report (named above) for test/coverage state.
4. Then answer the user with a synthesis.

This file is OVERWRITTEN at every compaction — only the most recent state is preserved.  Pre-compaction state from older sessions is in git history if needed.
`;

  writeFileSync(OUTFILE, body, 'utf8');
  process.exit(0);
}
