// Requirements traceability matrix scanner.
//
// Reads specs/**/spec.md, extracts FR-### identifiers, scans tests/** for
// "@covers FR-###" annotations, and reports gaps in BOTH directions:
//   - Requirements with ZERO covering tests
//   - Annotations referencing FRs that don't exist in the spec
//
// Run: `pnpm trace`
// Exit code: 0 if everything is traceable, 1 if there are gaps.
//
// Annotation convention in test files:
//   // @covers FR-001 FR-014
//   describe('US-P1-B happy path', () => { ... })
//
// Annotations can appear anywhere in the file (typically the file header or
// the describe block).

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.cwd();

async function walk(dir, predicate) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // Skip generated / vendored dirs.
      if (
        ['node_modules', '.svelte-kit', 'build', 'dist', '.stryker-tmp', 'coverage'].includes(
          e.name
        )
      )
        continue;
      out.push(...(await walk(full, predicate)));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

const FR_REGEX = /\bFR-(\d{3,4})\b/g;

async function findRequirementsInSpecs() {
  const specFiles = await walk(join(ROOT, 'specs'), (p) => p.endsWith('spec.md'));
  const requirements = new Set();
  for (const file of specFiles) {
    const content = await readFile(file, 'utf8');
    for (const match of content.matchAll(FR_REGEX)) {
      requirements.add(`FR-${match[1]}`);
    }
  }
  return requirements;
}

async function findCoveringAnnotationsInTests() {
  const testFiles = await walk(join(ROOT, 'tests'), (p) => {
    const ext = extname(p);
    return ext === '.ts' || ext === '.js';
  });
  const coverage = new Map(); // FR-### → [filenames]
  const referenced = new Set();
  for (const file of testFiles) {
    const content = await readFile(file, 'utf8');
    // Match "@covers FR-001 FR-014" anywhere in the file
    const annotationRegex = /@covers\s+((?:FR-\d{3,4}\s*)+)/g;
    for (const annotation of content.matchAll(annotationRegex)) {
      const list = annotation[1] ?? '';
      for (const fr of list.matchAll(FR_REGEX)) {
        const id = `FR-${fr[1]}`;
        referenced.add(id);
        if (!coverage.has(id)) coverage.set(id, []);
        coverage.get(id).push(file.replace(ROOT, '').replace(/\\/g, '/'));
      }
    }
  }
  return { coverage, referenced };
}

const requirements = await findRequirementsInSpecs();
const { coverage, referenced } = await findCoveringAnnotationsInTests();

const uncovered = [...requirements].filter((r) => !coverage.has(r)).sort();
const orphaned = [...referenced].filter((r) => !requirements.has(r)).sort();
const covered = [...requirements].filter((r) => coverage.has(r)).sort();

console.log('\n=== Requirements traceability matrix ===');
console.log(`Total requirements in spec:   ${requirements.size}`);
console.log(`Covered by at least one test: ${covered.length}`);
console.log(`Uncovered:                    ${uncovered.length}`);
console.log(`Orphaned annotations:         ${orphaned.length}`);
console.log('');

if (covered.length > 0) {
  console.log('Covered requirements:');
  for (const fr of covered) {
    const files = coverage.get(fr);
    console.log(`  ✓ ${fr} (${files.length} test file${files.length === 1 ? '' : 's'})`);
  }
}

if (uncovered.length > 0) {
  console.log('');
  console.log('UNCOVERED requirements (add "@covers FR-###" to a test):');
  for (const fr of uncovered) console.log(`  ✗ ${fr}`);
}

if (orphaned.length > 0) {
  console.log('');
  console.log('Orphaned @covers annotations (FR not found in spec.md):');
  for (const fr of orphaned) console.log(`  ⚠ ${fr}`);
}

console.log('');

// Exit code: success if every FR in spec has at least one covering test
// AND no orphan annotations reference FRs that don't exist.
const ok = uncovered.length === 0 && orphaned.length === 0;
process.exit(ok ? 0 : 1);
