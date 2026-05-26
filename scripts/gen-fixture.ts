#!/usr/bin/env tsx
// gen:fixture — regenerate the expected.json for a bank fixture.
//
// Usage:  pnpm gen:fixture <bank-slug>
//
// Reads tests/fixtures/<bank-slug>/sample.pdf, runs the matching adapter,
// and writes tests/fixtures/<bank-slug>/expected.json with the exact
// ParseResult.  CI then asserts that snapshot never drifts (Principle VIII).
//
// This script intentionally throws if:
//   - The bank slug doesn't exist as a fixture directory
//   - sample.pdf doesn't exist
//   - No registered adapter detects the PDF
//   - The adapter throws or the checksum gate fails
// All "loud failure" per Principle II.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import '../src/lib/adapters/index';
import { detectAdapter } from '../src/lib/adapters/detector';
import { extractPdfTextWithPositions } from '../src/lib/pdf/extract';

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: pnpm gen:fixture <bank-slug>');
    console.error('Example: pnpm gen:fixture chase');
    process.exit(1);
  }

  const fixtureDir = resolve('tests/fixtures', slug);
  const samplePdf = resolve(fixtureDir, 'sample.pdf');
  const expectedPath = resolve(fixtureDir, 'expected.json');

  if (!existsSync(samplePdf)) {
    console.error(`gen:fixture: ${samplePdf} not found.`);
    console.error('Create the directory and drop an anonymized real statement first.');
    process.exit(1);
  }

  console.log(`Reading ${samplePdf}...`);
  const bytes = new Uint8Array(await readFile(samplePdf));

  console.log('Extracting text with PDF.js...');
  const pdfText = await extractPdfTextWithPositions(bytes);
  console.log(
    `  ${pdfText.total_pages} pages, ${pdfText.pages.reduce((n, p) => n + p.items.length, 0)} text items`
  );

  // First page text (4KB cap) for detection.
  const sample =
    pdfText.pages[0]?.items
      .map((i) => i.text)
      .join(' ')
      .slice(0, 4096) ?? '';
  const detection = detectAdapter(sample);
  if (!detection) {
    console.error(`gen:fixture: no registered adapter recognized this PDF.`);
    console.error(`Add an adapter at src/lib/adapters/${slug}/adapter.ts and re-run.`);
    process.exit(1);
  }
  console.log(`Detected adapter: ${detection.adapter.name} v${detection.adapter.version}`);

  console.log('Parsing...');
  const result = await detection.adapter.parse(pdfText);
  console.log(`  ${result.transactions.length} transactions`);
  console.log(`  Checksum levels populated: ${result.statement.parser_provides.join(', ')}`);

  // Serialize: BigInt values aren't JSON-native; convert to string with a "$bigint:" prefix.
  const serialized = JSON.stringify(
    result,
    (_key, value) => (typeof value === 'bigint' ? `$bigint:${value.toString()}` : value),
    2
  );
  await writeFile(expectedPath, serialized + '\n', 'utf8');
  console.log(`\n✓ Wrote ${expectedPath}`);
}

main().catch((err) => {
  console.error('gen:fixture failed:');
  console.error(err);
  process.exit(1);
});
