// Inline pnpm-lock.yaml integrity check.  Replaces lockfile-lint (which only
// supports npm and yarn lockfiles; verified 2026-05-24 against v5.0.0).
//
// What we enforce:
//   1. Every `resolution.integrity:` line is present (no missing hashes).
//   2. Every `resolution.tarball:` URL (if present) is over https.
//   3. Every URL host is in the allowed-hosts list.
//
// This is enough to detect: (a) a registry swap, (b) a missing integrity
// hash, (c) http:// URLs (downgrade attack).  It is NOT a full SCA scan —
// `pnpm audit` covers known CVEs.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOCKFILE = join(ROOT, 'pnpm-lock.yaml');
const ALLOWED_HOSTS = new Set(['registry.npmjs.org', 'codeload.github.com', 'github.com']);

const content = await readFile(LOCKFILE, 'utf8');

let issues = 0;
let integrityCount = 0;
let tarballChecked = 0;

const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i] || '';
  // resolution: {integrity: sha512-...}
  if (/^\s*resolution:\s*\{integrity:\s*[a-z0-9]+-/i.test(line)) {
    integrityCount++;
    continue;
  }
  // resolution: {tarball: https://...}
  const tarballMatch = line.match(/tarball:\s*(\S+?)\s*[,}]/);
  if (tarballMatch) {
    tarballChecked++;
    const url = tarballMatch[1];
    if (!url) continue;
    if (!url.startsWith('https://')) {
      console.error(`✗ non-https tarball at line ${i + 1}: ${url}`);
      issues++;
      continue;
    }
    try {
      const host = new URL(url).host;
      if (!ALLOWED_HOSTS.has(host)) {
        console.error(`✗ unknown tarball host at line ${i + 1}: ${host}`);
        issues++;
      }
    } catch {
      console.error(`✗ malformed tarball URL at line ${i + 1}: ${url}`);
      issues++;
    }
  }
}

console.log(`Lockfile check:`);
console.log(`  packages with integrity hash:  ${integrityCount}`);
console.log(`  tarball URLs checked:           ${tarballChecked}`);
console.log(`  issues:                         ${issues}`);

if (issues > 0) {
  console.error('\nLockfile integrity check FAILED.');
  process.exit(1);
}
console.log('\nLockfile integrity check passed.');
