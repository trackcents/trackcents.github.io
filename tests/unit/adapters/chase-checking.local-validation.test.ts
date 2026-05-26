// Local-only validation of the chase-checking adapter against the user's
// actual anonymized 9535 statements.  Runs only when ONEDRIVE_CHASE_DIR is
// set (CI never sets it; CI skips silently).
//
// To run locally (PowerShell):
//     $env:ONEDRIVE_CHASE_DIR = "C:\Users\tnvmu\OneDrive\Documents\Hemanth\Bank_statements\output"
//     pnpm vitest run tests/unit/adapters/chase-checking.local-validation.test.ts

import { describe, test, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chaseCheckingAdapter,
  extractTransactions
} from '../../../src/lib/adapters/chase-checking/adapter';
import { chaseCreditCardAdapter } from '../../../src/lib/adapters/chase-credit-card/adapter';
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
  // Replace strict-anonymized placeholders with valid-but-fake values so the
  // strict parser can still count rows and exercise its code paths.
  return text
    .replace(/-\s*\$X\.XX/g, '-$0.01')
    .replace(/\$X\.XX/g, '$0.01')
    .replace(/(?<![\w.])-?X\.XX-?(?![\w.])/g, '0.01')
    .replace(/MM\/DD\/YYYY/g, '01/01/2026')
    .replace(/(?<![\w/])MM\/DD(?![\w/])/g, '01/01');
}

async function listCheckingBackups(dir: string): Promise<string[]> {
  const all = await readdir(dir);
  // 9535 is the checking account on the user's machine; pattern matches
  // any same-shaped Chase deposit-account file name.
  return all
    .filter((f) => /^\d{8}-statements-9535-\.anonymized\.json\.precleanup\.bak$/.test(f))
    .map((f) => join(dir, f))
    .sort();
}

describeLocal('Chase Checking adapter — local validation against OneDrive anonymized JSONs', () => {
  test('every 9535 file is detected, parses without throwing, and yields the expected rows', async () => {
    const files = await listCheckingBackups(onedrive!);
    expect(files.length).toBeGreaterThan(0);

    type Row = {
      file: string;
      detected_as_checking: boolean;
      false_positive_on_cc: boolean;
      txn_count: number;
      payment_to_card_count: number;
      sample_first: string | null;
      sample_last: string | null;
    };
    const report: Row[] = [];

    for (const filepath of files) {
      const raw = await readFile(filepath, 'utf8');
      const json = JSON.parse(raw) as JsonStatement;
      const pdf = toPdfText(json);

      const textSample = pdf.pages[0]!.items.map((i) => i.text)
        .join(' ')
        .slice(0, 4096);

      const detected_as_checking = chaseCheckingAdapter.detect(textSample);
      const false_positive_on_cc = chaseCreditCardAdapter.detect(textSample);

      const rows = groupAllRows(pdf.pages, 3);
      const { transactions } = extractTransactions(rows, null);
      const payment_to_card_count = transactions.filter(
        (t) => t.transaction_type === 'payment_to_card'
      ).length;

      report.push({
        file: filepath.split(/[\\/]/).pop()!,
        detected_as_checking,
        false_positive_on_cc,
        txn_count: transactions.length,
        payment_to_card_count,
        sample_first: transactions[0]?.description.slice(0, 70) ?? null,
        sample_last: transactions[transactions.length - 1]?.description.slice(0, 70) ?? null
      });
    }

    console.log('\n=== Chase Checking local-validation report ===');
    for (const r of report) {
      console.log(
        `${r.file.padEnd(60)} checking=${r.detected_as_checking} cc=${
          r.false_positive_on_cc
        } txns=${String(r.txn_count).padStart(3)} pay->card=${r.payment_to_card_count}`
      );
      if (r.sample_first) {
        console.log(`    first: ${r.sample_first}`);
        console.log(`    last:  ${r.sample_last}`);
      }
    }
    console.log('==============================================\n');

    for (const r of report) {
      expect(r.detected_as_checking, `${r.file} should be detected as Chase Checking`).toBe(true);
      expect(r.false_positive_on_cc, `${r.file} must NOT also match the CC adapter`).toBe(false);
      expect(r.txn_count, `${r.file} should have at least 1 transaction`).toBeGreaterThan(0);
      // Every 9535 statement in the user's data has payment-to-Chase-Card rows
      // (that's the whole point of the reconciliation use case).
      expect(
        r.payment_to_card_count,
        `${r.file} should have at least 1 Payment To Chase Card row`
      ).toBeGreaterThan(0);
    }
  });
});
