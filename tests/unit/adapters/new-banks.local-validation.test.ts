// Local-only validation of the three new adapters (BofA, Discover,
// Robinhood) against the user's actual anonymized PDFs.  Skipped in CI.

import { describe, test, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bofaCreditCardAdapter } from '../../../src/lib/adapters/bofa-credit-card/adapter';
import { discoverCreditCardAdapter } from '../../../src/lib/adapters/discover-credit-card/adapter';
import { robinhoodCreditCardAdapter } from '../../../src/lib/adapters/robinhood-credit-card/adapter';
import type {
  BankAdapter,
  PdfTextWithPositions,
  PdfTextItem
} from '../../../src/lib/adapters/types';

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

interface Case {
  filenamePattern: RegExp;
  adapter: BankAdapter;
  label: string;
}

const CASES: Case[] = [
  {
    filenamePattern: /^Bofa\s+Emailing\s+eStmt_.*\.anonymized\.json\.precleanup\.bak$/i,
    adapter: bofaCreditCardAdapter,
    label: 'BofA'
  },
  {
    filenamePattern: /^Emailing\s+(?:March|April)\s+2026\.anonymized\.json\.precleanup\.bak$/i,
    adapter: discoverCreditCardAdapter,
    label: 'Discover'
  },
  {
    filenamePattern:
      /^Credit\s+Statement\s+(?:March|April)\s+2026\.anonymized\.json\.precleanup\.bak$/i,
    adapter: robinhoodCreditCardAdapter,
    label: 'Robinhood'
  }
];

describeLocal('BofA / Discover / Robinhood adapters — local validation', () => {
  test('every observed statement is detected by its bank and parses without throwing', async () => {
    const all = await readdir(onedrive!);

    type Report = {
      file: string;
      label: string;
      detected: boolean;
      parsed_ok: boolean;
      parse_error: string | null;
      txn_count: number;
      sample_first: string | null;
    };
    const report: Report[] = [];

    for (const c of CASES) {
      const files = all.filter((f) => c.filenamePattern.test(f)).sort();
      expect(files.length, `${c.label} should have at least one fixture`).toBeGreaterThan(0);

      for (const fname of files) {
        const filepath = join(onedrive!, fname);
        const raw = await readFile(filepath, 'utf8');
        const json = JSON.parse(raw) as JsonStatement;
        const pdf = toPdfText(json);
        const textSample = pdf.pages[0]!.items.map((i) => i.text)
          .join(' ')
          .slice(0, 4096);

        const detected = c.adapter.detect(textSample);
        let parsed_ok = false;
        let parse_error: string | null = null;
        let txn_count = 0;
        let sample_first: string | null = null;
        if (detected) {
          try {
            const r = await c.adapter.parse(pdf);
            parsed_ok = true;
            txn_count = r.transactions.length;
            sample_first = r.transactions[0]?.description.slice(0, 70) ?? null;
          } catch (err) {
            parse_error = err instanceof Error ? err.message : String(err);
          }
        }

        report.push({
          file: fname,
          label: c.label,
          detected,
          parsed_ok,
          parse_error,
          txn_count,
          sample_first
        });
      }
    }

    console.log('\n=== New-banks local-validation report ===');
    for (const r of report) {
      console.log(
        `[${r.label.padEnd(9)}] ${r.file.padEnd(60)} detected=${r.detected} parsed_ok=${r.parsed_ok} txns=${String(r.txn_count).padStart(3)}`
      );
      if (r.sample_first) console.log(`    first: ${r.sample_first}`);
      if (r.parse_error) console.log(`    error: ${r.parse_error}`);
    }
    console.log('=========================================\n');

    for (const r of report) {
      expect(r.detected, `${r.file} should be detected by ${r.label}`).toBe(true);
      expect(r.parsed_ok, `${r.file} should parse without throwing: ${r.parse_error}`).toBe(true);
      // BofA / Robinhood real statements have transactions; Discover March's
      // fixture might have only 4 (small month).  Just assert ≥ 1.
      expect(r.txn_count, `${r.file} should have at least 1 transaction`).toBeGreaterThan(0);
    }
  });
});
