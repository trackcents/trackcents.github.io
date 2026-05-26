// Cross-adapter exclusivity: every real PDF in the user's OneDrive must be
// claimed by EXACTLY ONE adapter.  Ambiguous detection (multiple adapters
// matching the same file) is a parser bug that causes the orchestrator's
// detectAdapter() to throw, which historically surfaced as "silently
// dropped" imports in the UI.
//
// This test was added in response to a real bug on 2026-05-23: the April
// Chase Checking 9535 statement was being claimed by chase-checking, BofA,
// AND Discover simultaneously because the latter two adapters had detect
// regexes that matched transaction-description text (`Bk of Amer Visa Online
// Pmt` and `Chase Card Ending IN 1797`) instead of statement-header-only
// text.  Tightened detect() functions plus this test now prevent
// regressions.
//
// Per the constitution-reviewer thoroughness audit (added gate G8 below),
// every new bank adapter MUST be verified against this test.

import { describe, test, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chaseCreditCardAdapter } from '../../../src/lib/adapters/chase-credit-card/adapter';
import { chaseCheckingAdapter } from '../../../src/lib/adapters/chase-checking/adapter';
import { amexAdapter } from '../../../src/lib/adapters/amex/adapter';
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

const ALL_ADAPTERS: BankAdapter[] = [
  chaseCreditCardAdapter,
  chaseCheckingAdapter,
  amexAdapter,
  bofaCreditCardAdapter,
  discoverCreditCardAdapter,
  robinhoodCreditCardAdapter
];

// Each entry names a fixture filename pattern AND the adapter name that
// SHOULD claim it.  Add a new entry per bank when a new adapter is added.
const EXPECTED_OWNERSHIP: Array<{ filePattern: RegExp; expectedAdapterName: string }> = [
  // Chase credit cards (Sapphire Preferred 1797 + Amazon Prime Visa 7137)
  {
    filePattern: /^\d{8}-statements-(?:1797|7137)-\.anonymized\.json\.precleanup\.bak$/,
    expectedAdapterName: 'layout-chase-credit-card'
  },
  // Chase College Checking (9535)
  {
    filePattern: /^\d{8}-statements-9535-\.anonymized\.json\.precleanup\.bak$/,
    expectedAdapterName: 'layout-chase-checking'
  },
  // Amex Blue Cash Everyday
  {
    filePattern: /^Amex\s+.*\.anonymized\.json\.precleanup\.bak$/i,
    expectedAdapterName: 'layout-amex'
  },
  // Bank of America Visa Signature
  {
    filePattern: /^Bofa\s+Emailing\s+eStmt_.*\.anonymized\.json\.precleanup\.bak$/i,
    expectedAdapterName: 'layout-bofa-credit-card'
  },
  // Discover IT
  {
    filePattern: /^Emailing\s+(?:March|April)\s+2026\.anonymized\.json\.precleanup\.bak$/i,
    expectedAdapterName: 'layout-discover-credit-card'
  },
  // Robinhood Credit
  {
    filePattern:
      /^Credit\s+Statement\s+(?:March|April)\s+2026\.anonymized\.json\.precleanup\.bak$/i,
    expectedAdapterName: 'layout-robinhood-credit-card'
  }
];

describeLocal('Cross-adapter exclusivity — every real PDF must match EXACTLY one adapter', () => {
  test('no PDF is claimed by zero or by multiple adapters', async () => {
    const all = await readdir(onedrive!);
    const fixtures = all.filter((f) => f.endsWith('.anonymized.json.precleanup.bak')).sort();
    expect(fixtures.length).toBeGreaterThan(0);

    type Row = {
      file: string;
      claimedBy: string[];
      expectedAdapter: string | null;
    };
    const report: Row[] = [];

    for (const fname of fixtures) {
      const filepath = join(onedrive!, fname);
      const raw = await readFile(filepath, 'utf8');
      const json = JSON.parse(raw) as JsonStatement;
      const pdf = toPdfText(json);
      const textSample = pdf.pages[0]!.items.map((i) => i.text)
        .join(' ')
        .slice(0, 4096);

      const claimedBy = ALL_ADAPTERS.filter((a) => a.detect(textSample)).map((a) => a.name);

      const expected = EXPECTED_OWNERSHIP.find((e) => e.filePattern.test(fname));

      report.push({
        file: fname,
        claimedBy,
        expectedAdapter: expected?.expectedAdapterName ?? null
      });
    }

    console.log('\n=== Cross-adapter exclusivity report ===');
    for (const r of report) {
      const marker = r.claimedBy.length === 1 ? '✓' : '✗';
      console.log(`${marker} ${r.file.padEnd(60)} → [${r.claimedBy.join(', ')}]`);
    }
    console.log('========================================\n');

    for (const r of report) {
      expect(
        r.claimedBy.length,
        `${r.file} should be claimed by exactly 1 adapter, got ${r.claimedBy.length}: [${r.claimedBy.join(', ')}]`
      ).toBe(1);
      if (r.expectedAdapter !== null) {
        expect(r.claimedBy[0], `${r.file} should be claimed by ${r.expectedAdapter}`).toBe(
          r.expectedAdapter
        );
      }
    }
  });
});

// ── Synthetic cross-exclusivity ───────────────────────────────────────────
// The local test above only runs when ONEDRIVE_CHASE_DIR is set.  This
// synthetic one runs in CI: tiny header-text samples from each bank, asserted
// against every adapter.  Catches the same class of bug without needing the
// real PDFs.

describe('Cross-adapter exclusivity — synthetic header text samples', () => {
  const HEADER_SAMPLES: Array<{ name: string; sample: string; expectedAdapter: string }> = [
    {
      name: 'Chase Sapphire CC',
      sample:
        'www.chase.com/cardhelp ACCOUNT SUMMARY Credit Access Line Account Number: XXXX XXXX XXXX 1797 Opening/Closing Date 03/14/2026 - 04/13/2026',
      expectedAdapter: 'layout-chase-credit-card'
    },
    {
      name: 'Chase Checking 9535',
      sample:
        // The "Robinhood Card Payment" descriptor at the end is here on purpose:
        // it appears in real Chase Checking statements and used to false-positive
        // the Robinhood adapter (the detect regex /\bRobinhood\s+Card\b/ matched
        // it).  Detect was tightened on 2026-05-23; this sample now guards the
        // fix.
        'JPMorgan Chase Bank, N.A. CHECKING SUMMARY *start*summary Chase College Checking Beginning Balance Deposits and Additions Electronic Withdrawals Ending Balance Account Number: 000000533089535 February 26, 2026 through March 24, 2026 Bk of Amer Visa Online Pmt Discover E-Payment 3562 Chase Card Ending IN 1797 Robinhood Card Payment PPD ID: 6823032815',
      expectedAdapter: 'layout-chase-checking'
    },
    {
      name: 'Amex Blue Cash Everyday',
      sample:
        'Blue Cash Everyday® from American Express Account Ending 2-03004 Closing Date 03/17/2026 Payment Summary New Balance Account Summary Previous Balance Less Payments/Credits Plus New Charges Equals New Balance',
      expectedAdapter: 'layout-amex'
    },
    {
      // NOTE: real BofA PDFs use SPACES between the four account-number groups
      // ("Account# #### #### #### 2050"), not hyphens.  Earlier samples here
      // used the hyphenated form because the local anonymizer rewrites it
      // that way; that mismatch let a real-data parse failure slip past CI
      // (April 9535-adjacent bug, 2026-05-23).  Test the REAL header band.
      name: 'BofA Visa Signature',
      sample:
        'Bank of America www.bankofamerica.com Visa Signature® Account# #### #### #### 2050 Account Summary/Payment Information Previous Balance Purchases and Adjustments New Balance Total March 13 - April 12, 2026',
      expectedAdapter: 'layout-bofa-credit-card'
    },
    {
      name: 'Discover IT',
      sample:
        'DISCOVER IT CARD ENDING IN 3562 CARDMEMBER SINCE 2020 Account Summary Previous Balance Payments and Credits Purchases Cashback Bonus Discover.com',
      expectedAdapter: 'layout-discover-credit-card'
    },
    {
      name: 'Robinhood Credit',
      sample:
        'ACCOUNT HOLDER Account Number: XXXX XXXX XXXX 9024 ACCOUNT SUMMARY PAYMENT INFORMATION Credit Limit Credit Available Statement Closing Date Days in Billing Cycle Previous Balance - Payments & Credits + Purchases & Other Charges + FEE CHARGED + INTEREST CHARGED = New Balance',
      expectedAdapter: 'layout-robinhood-credit-card'
    }
  ];

  for (const sample of HEADER_SAMPLES) {
    test(`${sample.name} → claimed by exactly one adapter (${sample.expectedAdapter})`, () => {
      const claimedBy = ALL_ADAPTERS.filter((a) => a.detect(sample.sample)).map((a) => a.name);
      expect(
        claimedBy.length,
        `${sample.name} should be claimed by exactly 1 adapter; got [${claimedBy.join(', ')}]`
      ).toBe(1);
      expect(claimedBy[0]).toBe(sample.expectedAdapter);
    });
  }
});
