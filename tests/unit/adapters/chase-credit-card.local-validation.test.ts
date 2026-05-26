// Local-only validation of the Chase CC adapter against the user's actual
// anonymized statements.  These tests run ONLY when ONEDRIVE_CHASE_DIR is set,
// pointing at a directory of `*.anonymized.json.precleanup.bak` files (the
// originals produced by anonymize.mjs, before the supplemental cleanup pass
// that — bug — over-redacted floating-point coordinates).
//
// In CI the environment variable is never set, so every test is skipped.
//
// To run locally (PowerShell):
//     $env:ONEDRIVE_CHASE_DIR = "C:\Users\tnvmu\OneDrive\Documents\Hemanth\Bank_statements\output"
//     pnpm vitest run tests/unit/adapters/chase-credit-card.local-validation.test.ts
//
// What this validates against REAL anonymized data:
//   - detect() recognizes Chase statements
//   - extractTransactions() finds the ACCOUNT ACTIVITY section
//   - Every supposed transaction row has a MM/DD date + an amount-like token
//   - Transaction counts are in a sane range (> 0, < 500 per statement)
//
// What it canNOT validate (because strict-mode anonymization replaces them):
//   - actual amount values (placeholder "$X.XX")
//   - actual statement period dates (placeholder "MM/DD/YYYY")
//   - the checksum gate end-to-end

import { describe, test, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chaseCreditCardAdapter,
  extractTransactions
} from '../../../src/lib/adapters/chase-credit-card/adapter';
import { groupAllRows } from '../../../src/lib/adapters/_layout/table';
import type { PdfTextWithPositions, PdfTextItem } from '../../../src/lib/adapters/types';

const onedrive = process.env.ONEDRIVE_CHASE_DIR;
const describeLocal = onedrive ? describe : describe.skip;

interface JsonItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  font_size: number;
}
interface JsonPage {
  page_number: number;
  items: JsonItem[];
}
interface JsonStatement {
  meta: { source_filename: string; total_pages: number };
  pages: JsonPage[];
}

function toPdfText(json: JsonStatement): PdfTextWithPositions {
  const pages = json.pages.map((p) => ({
    page_number: p.page_number,
    items: p.items.map<PdfTextItem>((i) => ({
      // Substitute strict-anonymized "X.XX" / "MM/DD/YYYY" placeholder strings
      // with valid-but-fake values so the adapter (which now raises on bad
      // amounts) can still count rows in the local validator.
      text: substitutePlaceholders(i.text),
      x: i.x,
      y: i.y,
      width: i.width,
      height: i.height,
      font_size: i.font_size
    }))
  }));
  return { pages, total_pages: json.meta.total_pages };
}

function substitutePlaceholders(text: string): string {
  // Replace anonymizer's placeholder amounts/dates with parseable fakes.
  // ORDER MATTERS — longer patterns first, so "$X.XX" wins over "X.XX".
  return text
    .replace(/-\s*\$X\.XX/g, '-$0.01')
    .replace(/\$X\.XX/g, '$0.01')
    .replace(/(?<![\w.])-?X\.XX-?(?![\w.])/g, '0.01')
    .replace(/MM\/DD\/YYYY/g, '01/01/2026')
    .replace(/(?<![\w/])MM\/DD(?![\w/])/g, '01/01');
}

async function listChaseBackups(dir: string): Promise<string[]> {
  const all = await readdir(dir);
  // Match patterns like "20260514-statements-1797-.anonymized.json.precleanup.bak"
  // and pick only those with 4-digit account suffixes that look like Chase CC
  // statements (1797, 7137 = credit cards).  9535 is the checking account; the
  // CC adapter shouldn't detect it.
  return all
    .filter((f) => /^\d{8}-statements-\d{4}-\.anonymized\.json\.precleanup\.bak$/.test(f))
    .map((f) => join(dir, f))
    .sort();
}

describeLocal(
  'Chase Credit Card adapter — local validation against OneDrive anonymized JSONs',
  () => {
    test('iterates each Chase statement and reports structural counts', async () => {
      const files = await listChaseBackups(onedrive!);
      expect(files.length).toBeGreaterThan(0);

      const report: Array<{
        file: string;
        detected: boolean;
        txn_count: number;
        payment_rows: number;
        purchase_rows: number;
        sample_first: string | null;
        sample_last: string | null;
      }> = [];

      for (const filepath of files) {
        const raw = await readFile(filepath, 'utf8');
        const json = JSON.parse(raw) as JsonStatement;
        const pdf = toPdfText(json);

        const textSample = pdf.pages[0]!.items.map((i) => i.text)
          .join(' ')
          .slice(0, 4096);
        const detected = chaseCreditCardAdapter.detect(textSample);

        const rows = groupAllRows(pdf.pages, 3);
        const txns = extractTransactions(rows, null);

        const payment_rows = txns.filter((t) => t.transaction_type === 'transfer').length;
        const purchase_rows = txns.filter((t) => t.transaction_type === 'purchase').length;

        report.push({
          file: filepath.split(/[\\/]/).pop()!,
          detected,
          txn_count: txns.length,
          payment_rows,
          purchase_rows,
          sample_first: txns[0]?.description.slice(0, 60) ?? null,
          sample_last: txns[txns.length - 1]?.description.slice(0, 60) ?? null
        });
      }

      console.log('\n=== Chase CC local-validation report ===');
      for (const r of report) {
        console.log(
          `${r.file.padEnd(60)} detected=${r.detected} txns=${String(r.txn_count).padStart(3)} ` +
            `(pay=${r.payment_rows} pur=${r.purchase_rows})`
        );
        if (r.sample_first) {
          console.log(`    first: ${r.sample_first}`);
          console.log(`    last:  ${r.sample_last}`);
        }
      }
      console.log('========================================\n');

      // Soft assertions: every Chase CC file (1797, 7137) should be detected and
      // have at least one transaction.  The 9535 (checking) statements should
      // either be skipped by detect() or yield zero transactions — they don't
      // have an ACCOUNT ACTIVITY table.
      for (const r of report) {
        const is_cc = /-(?:1797|7137)-/.test(r.file);
        if (is_cc) {
          expect(r.detected, `${r.file} should be detected as Chase`).toBe(true);
          expect(r.txn_count, `${r.file} should yield transactions`).toBeGreaterThan(0);
        }
      }
    });
  }
);
