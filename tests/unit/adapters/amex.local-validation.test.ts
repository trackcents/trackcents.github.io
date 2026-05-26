// Local-only validation against the user's real anonymized Amex PDFs.
// Skipped in CI; runs when ONEDRIVE_CHASE_DIR env var is set (same env var
// the Chase validators use — user keeps all bank statements in one folder).

import { describe, test, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { amexAdapter, extractTransactions } from '../../../src/lib/adapters/amex/adapter';
import { chaseCreditCardAdapter } from '../../../src/lib/adapters/chase-credit-card/adapter';
import { chaseCheckingAdapter } from '../../../src/lib/adapters/chase-checking/adapter';
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
interface JsonStatement {
  meta: { source_filename: string; total_pages: number };
  pages: { page_number: number; items: JsonItem[] }[];
}

function substitutePlaceholders(text: string): string {
  return text
    .replace(/-\s*\$X\.XX/g, '-$0.01')
    .replace(/\$X\.XX/g, '$0.01')
    .replace(/(?<![\w.])-?X\.XX-?(?![\w.])/g, '0.01')
    .replace(/MM\/DD\/YYYY/g, '01/01/2026')
    .replace(/(?<![\w/])MM\/DD(?![\w/])/g, '01/01');
}

function toPdfText(json: JsonStatement): PdfTextWithPositions {
  return {
    pages: json.pages.map((p) => ({
      page_number: p.page_number,
      items: p.items.map<PdfTextItem>((i) => ({
        text: substitutePlaceholders(i.text),
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
        font_size: i.font_size
      }))
    })),
    total_pages: json.meta.total_pages
  };
}

async function listAmexBackups(dir: string): Promise<string[]> {
  const all = await readdir(dir);
  return all
    .filter((f) => /^Amex\s+.*\.anonymized\.json\.precleanup\.bak$/i.test(f))
    .map((f) => join(dir, f))
    .sort();
}

describeLocal('Amex adapter — local validation against OneDrive anonymized PDFs', () => {
  test('every Amex file is detected, parses without throwing, and yields plausible row counts', async () => {
    const files = await listAmexBackups(onedrive!);
    expect(files.length).toBeGreaterThan(0);

    type Row = {
      file: string;
      detected_as_amex: boolean;
      false_positive_on_chase_cc: boolean;
      false_positive_on_chase_checking: boolean;
      txn_count: number;
      payment_count: number;
      charge_count: number;
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
      const detected_as_amex = amexAdapter.detect(textSample);
      const false_positive_on_chase_cc = chaseCreditCardAdapter.detect(textSample);
      const false_positive_on_chase_checking = chaseCheckingAdapter.detect(textSample);

      const rows = groupAllRows(pdf.pages, 3);
      const txns = extractTransactions(rows);
      const payment_count = txns.filter(
        (t) => t.transaction_type === 'payment_to_card' || t.transaction_type === 'refund'
      ).length;
      const charge_count = txns.filter((t) => t.transaction_type === 'purchase').length;

      report.push({
        file: filepath.split(/[\\/]/).pop()!,
        detected_as_amex,
        false_positive_on_chase_cc,
        false_positive_on_chase_checking,
        txn_count: txns.length,
        payment_count,
        charge_count,
        sample_first: txns[0]?.description.slice(0, 70) ?? null,
        sample_last: txns[txns.length - 1]?.description.slice(0, 70) ?? null
      });
    }

    console.log('\n=== Amex local-validation report ===');
    for (const r of report) {
      console.log(
        `${r.file.padEnd(60)} amex=${r.detected_as_amex} cc=${r.false_positive_on_chase_cc} chk=${r.false_positive_on_chase_checking} txns=${String(r.txn_count).padStart(3)} pay=${r.payment_count} chg=${r.charge_count}`
      );
      if (r.sample_first) {
        console.log(`    first: ${r.sample_first}`);
        console.log(`    last:  ${r.sample_last}`);
      }
    }
    console.log('====================================\n');

    for (const r of report) {
      expect(r.detected_as_amex, `${r.file} must be detected as Amex`).toBe(true);
      expect(r.false_positive_on_chase_cc, `${r.file} must NOT match chase-credit-card`).toBe(
        false
      );
      expect(r.false_positive_on_chase_checking, `${r.file} must NOT match chase-checking`).toBe(
        false
      );
      expect(r.txn_count, `${r.file} should yield transactions`).toBeGreaterThan(0);
    }
  });
});
