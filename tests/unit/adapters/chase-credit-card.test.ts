// Chase Credit Card adapter — fixture-driven test.
//
// Validates that the adapter:
//   1. Detects the Chase sample PDF.
//   2. Extracts the Account Summary fields (Level C reconciliation data).
//   3. Satisfies Level C: previous_balance + charges - credits = new_balance.
//
// The current fixture (Chase's official paperless-statement sample) contains
// no transactions — the adapter returns an empty transactions array.  When
// a transaction-bearing fixture lands, this test will be extended.

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chaseCreditCardAdapter } from '../../../src/lib/adapters/chase-credit-card/adapter';
import {
  syntheticChaseCC_v1,
  expectedChaseCC_v1
} from '../../fixtures/chase-credit-card/synthetic-v1';

// Use the legacy build of PDF.js for Node-side test execution.
// The production browser code uses the modern build via src/lib/pdf/extract.ts.
// In tests we inline a minimal extractor to avoid pulling browser globals.

async function loadFixturePdfText(relPath: string) {
  const bytes = new Uint8Array(await readFile(resolve(relPath)));
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: bytes, useSystemFonts: false }).promise;
  type Item = {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    font_size: number;
  };
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent({ disableNormalization: true });
    const items: Item[] = [];
    for (const raw of content.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    }>) {
      if (typeof raw.str !== 'string' || !Array.isArray(raw.transform)) continue;
      items.push({
        text: raw.str,
        x: raw.transform[4]!,
        y: raw.transform[5]!,
        width: raw.width ?? 0,
        height: raw.height ?? 0,
        font_size: Math.abs(raw.transform[0]!)
      });
    }
    pages.push({ page_number: p, items });
  }
  await doc.destroy();
  return { pages, total_pages: doc.numPages };
}

describe('Chase Credit Card adapter — sample fixture', () => {
  const FIXTURE = 'tests/fixtures/chase-credit-card/sample.pdf';

  test('detects the Chase sample PDF', async () => {
    const pdf = await loadFixturePdfText(FIXTURE);
    const sample = pdf.pages[0]!.items.map((i) => i.text)
      .join(' ')
      .slice(0, 4096);
    expect(chaseCreditCardAdapter.detect(sample)).toBe(true);
  });

  test('extracts Account Summary fields populating Level C', async () => {
    const pdf = await loadFixturePdfText(FIXTURE);
    const result = await chaseCreditCardAdapter.parse(pdf);

    expect(result.statement.account_type).toBe('credit_card');
    expect(result.statement.currency).toBe('USD');
    expect(result.statement.period_start).toBe('2018-12-03');
    expect(result.statement.period_end).toBe('2019-01-01');
    expect(result.statement.parser_provides).toEqual(['C']);

    // Chase sample shows:
    //   Previous Balance:        $1,270.00
    //   Payment, Credits:        - $25.00
    //   Purchases:               $0.00
    //   Cash Advances:           $0.00
    //   Balance Transfers:       $0.00
    //   Fees Charged:            $0.00
    //   Interest Charged:        $0.00
    //   New Balance:             $1,245.00
    expect(result.statement.previous_balance_minor).toBe(127000n);
    expect(result.statement.statement_balance_minor).toBe(124500n);

    // Sample contains no transactions (it's a summary/marketing piece).
    expect(result.transactions).toHaveLength(0);
  });

  test('Level C checksum equation holds on the sample', async () => {
    const pdf = await loadFixturePdfText(FIXTURE);
    const result = await chaseCreditCardAdapter.parse(pdf);

    // Level C: previous + (purchases + cash + transfers + fees + interest) - payments_credits = new_balance
    // From the sample: 127000 + (0+0+0+0+0) - 2500 = 124500
    // The adapter doesn't run the gate itself; it populates the fields and the
    // app-side checksum gate verifies.  Here we just verify the math the gate
    // would do.
    const prev = result.statement.previous_balance_minor!;
    const newBal = result.statement.statement_balance_minor!;
    // Sample's other fields are all $0; we don't extract them as bigints in the
    // current adapter version, so this test asserts only the available fields.
    expect(prev).toBe(127000n);
    expect(newBal).toBe(124500n);
    // Sanity: the equation 127000 + 0 - 2500 = 124500 holds.
    const expected_new = prev - 2500n; // payments only; no charges in sample
    expect(expected_new).toBe(newBal);
  });
});

describe('Chase Credit Card adapter — synthetic v0.2.0 transaction fixture', () => {
  test('detects the synthetic fixture as a Chase statement', async () => {
    const sample = syntheticChaseCC_v1.pages[0]!.items.map((i) => i.text)
      .join(' ')
      .slice(0, 4096);
    expect(chaseCreditCardAdapter.detect(sample)).toBe(true);
  });

  test('extracts account_last_4, period, and Account Summary', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    expect(r.statement.account_last_4).toBe(expectedChaseCC_v1.account_last_4);
    expect(r.statement.period_start).toBe(expectedChaseCC_v1.period_start);
    expect(r.statement.period_end).toBe(expectedChaseCC_v1.period_end);
    expect(r.statement.previous_balance_minor).toBe(expectedChaseCC_v1.previous_balance_minor);
    expect(r.statement.statement_balance_minor).toBe(expectedChaseCC_v1.new_balance_minor);
  });

  test('parses 6 transactions across PAYMENTS and PURCHASE sections', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    expect(r.transactions).toHaveLength(expectedChaseCC_v1.transactions.length);
  });

  test('inverts sign correctly: purchases negative, payment positive', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    for (const [i, expected] of expectedChaseCC_v1.transactions.entries()) {
      const actual = r.transactions[i]!;
      expect(actual.posted_date).toBe(expected.posted_date);
      expect(actual.transaction_type).toBe(expected.transaction_type);
      expect(actual.amount_minor).toBe(expected.amount_minor);
      expect(actual.description).toContain(expected.descriptionContains);
    }
  });

  test('merges Amazon-style continuation row into previous transaction description', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    const amazonTxn = r.transactions.find((t) => t.description.includes('Amazon.com'));
    expect(amazonTxn).toBeDefined();
    expect(amazonTxn!.description).toContain('Order Number 113-1111111-2222222');
  });

  test('declares Level B + C (+ D supplementary) in parser_provides', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    expect(r.statement.parser_provides).toContain('B');
    expect(r.statement.parser_provides).toContain('C');
    expect(r.statement.parser_provides).toContain('D');
  });

  test('populates Level B totals from Account Summary aggregates', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    // Debits = purchases + cash advances + balance transfers + fees + interest
    expect(r.statement.total_debits_minor).toBe(expectedChaseCC_v1.purchases_total_minor);
    expect(r.statement.total_credits_minor).toBe(expectedChaseCC_v1.payments_credits_minor);
  });

  test('Level B agreement: sum of transactions matches printed totals', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);

    // Sum the outflows (negative amounts) — should equal -total_debits_minor.
    let debits = 0n;
    let credits = 0n;
    for (const t of r.transactions) {
      if (t.amount_minor < 0n) debits += -t.amount_minor;
      else credits += t.amount_minor;
    }
    expect(debits).toBe(r.statement.total_debits_minor);
    expect(credits).toBe(r.statement.total_credits_minor);
  });

  test('Level C math: previous + debits - credits = new', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    const prev = r.statement.previous_balance_minor!;
    const newBal = r.statement.statement_balance_minor!;
    const debits = r.statement.total_debits_minor!;
    const credits = r.statement.total_credits_minor!;
    expect(prev + debits - credits).toBe(newBal);
  });

  test('Level D count matches transactions array length', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    expect(r.statement.printed_transaction_count).toBe(r.transactions.length);
  });

  test('preserves the full Account Summary box as summary_lines', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    expect(r.statement.summary_lines).toEqual(expectedChaseCC_v1.summary_lines);
  });

  test('extracts Payment Due Date and Minimum Payment Due', async () => {
    const r = await chaseCreditCardAdapter.parse(syntheticChaseCC_v1);
    expect(r.statement.payment_due_date).toBe(expectedChaseCC_v1.payment_due_date);
    expect(r.statement.minimum_payment_due_minor).toBe(
      expectedChaseCC_v1.minimum_payment_due_minor
    );
  });
});

// Regression test: a statement where Previous Balance is NEGATIVE (the user
// had a credit balance going in — e.g. after a refund overpaid the prior bill).
// The v0.2.0 adapter initially took absolute value of every Account Summary
// field, which flipped the sign of Previous Balance and broke Level C by
// 2 × |previous|.  See smoke-test failure on user's 20260422-statements-7137-.pdf.
describe('Chase Credit Card adapter — credit-balance scenario regression', () => {
  function makeItem(text: string, x: number, y: number) {
    return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
  }

  const creditBalanceFixture = {
    pages: [
      {
        page_number: 1,
        items: [
          makeItem('Chase Card Services', 18, 740),
          makeItem('www.chase.com/cardhelp', 189, 720),
          makeItem('ACCOUNT', 18, 609),
          makeItem('SUMMARY', 91, 609),
          makeItem('Account Number: XXXX XXXX XXXX 7137', 18, 595),
          makeItem('Previous Balance', 18, 581),
          makeItem('-$116.38', 217, 581),
          makeItem('Payment, Credits', 18, 569),
          makeItem('-$0.00', 222, 569),
          makeItem('Purchases', 18, 558),
          makeItem('+$1,047.39', 216, 558),
          makeItem('Cash Advances', 18, 546),
          makeItem('$0.00', 229, 546),
          makeItem('Balance Transfers', 18, 534),
          makeItem('$0.00', 229, 534),
          makeItem('Fees Charged', 18, 522),
          makeItem('$0.00', 229, 522),
          makeItem('Interest Charged', 18, 510),
          makeItem('$0.00', 229, 510),
          makeItem('New Balance', 18, 496),
          makeItem('$931.01', 224, 496),
          makeItem('Opening/Closing Date', 18, 484),
          makeItem('03/23/2026 - 04/22/2026', 181, 484),
          makeItem('Credit Access Line', 18, 472),
          makeItem('$5,000.00', 220, 472)
        ]
      },
      {
        page_number: 3,
        items: [
          makeItem('ACCOUNT', 26, 920),
          makeItem('ACTIVITY', 99, 920),
          makeItem('PURCHASE', 26, 845),
          // Single purchase that sums to $1,047.39 — simplifies the math.
          makeItem('04/15', 27, 825),
          makeItem('FAKE PURCHASE', 112, 825),
          makeItem('1,047.39', 460, 825),
          makeItem('2026 Totals Year-to-Date', 222, 528)
        ]
      }
    ],
    total_pages: 3
  };

  test('Previous Balance is stored signed when statement begins with credit', async () => {
    const r = await chaseCreditCardAdapter.parse(creditBalanceFixture);
    // -$116.38 in cents = -11638
    expect(r.statement.previous_balance_minor).toBe(-11638n);
  });

  test('New Balance keeps its (positive) sign when statement ends with debt', async () => {
    const r = await chaseCreditCardAdapter.parse(creditBalanceFixture);
    // $931.01 in cents = 93101
    expect(r.statement.statement_balance_minor).toBe(93101n);
  });

  test('Level C balance equation reconciles with signed previous_balance', async () => {
    const r = await chaseCreditCardAdapter.parse(creditBalanceFixture);
    const prev = r.statement.previous_balance_minor!;
    const newBal = r.statement.statement_balance_minor!;
    // 30 purchases sum to $1,047.39 → all stored as -104739 after inversion.
    // sum_charges (absolute) = 104739, sum_payments = 0
    // expected = -11638 + 104739 - 0 = 93101 = newBal ✓
    let charges = 0n;
    let payments = 0n;
    for (const t of r.transactions) {
      if (t.amount_minor < 0n) charges += -t.amount_minor;
      else payments += t.amount_minor;
    }
    expect(prev + charges - payments).toBe(newBal);
  });

  test('runs full checksum gate without refusal', async () => {
    const r = await chaseCreditCardAdapter.parse(creditBalanceFixture);
    const { runChecksumGate } = await import('../../../src/lib/app/checksum');
    const gate = runChecksumGate(r.statement, r.transactions);
    expect(gate.ok, gate.ok ? '' : gate.reason).toBe(true);
  });
});
