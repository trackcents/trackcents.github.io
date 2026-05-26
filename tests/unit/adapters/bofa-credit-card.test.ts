// Regression tests for the BofA credit card adapter.
//
// IMPORTANT — why these fixtures look funny:
//   Real BofA PDFs emit Account Summary rows as MULTI-CELL rows.  The label
//   ("Previous Balance") is at x≈36 and the amount is split into TWO further
//   cells: "$" at x≈252 and "1,234.56" at x≈257.  The Y of the amount cells
//   is often 1pt different from the Y of the label cell, but our row grouper
//   tolerates ±3pt so they collapse into one row.
//
//   The bug we are guarding against (observed 2026-05-23): the local
//   anonymizer used to produce statements concatenates the label and amount
//   into a SINGLE cell (" Previous Balance   $X.XX"), which hid the real
//   layout from synthetic tests for 4 months.  The April + May 2026
//   statements both silently failed to import with "could not find Previous
//   Balance or New Balance Total in Account Summary".
//
//   Every fixture in this file uses the REAL split-cell layout so that the
//   bug cannot regress unnoticed.

import { describe, test, expect } from 'vitest';
import { bofaCreditCardAdapter } from '../../../src/lib/adapters/bofa-credit-card/adapter';
import type { PdfTextItem, PdfTextWithPositions } from '../../../src/lib/adapters/types';

// Helper — build a row at the given Y, with the label at xLabel and the
// amount split into "$" at xDollar and digits at xDigits.  This mirrors the
// real BofA Account Summary layout.
function summaryRow(
  y: number,
  label: string,
  xLabel: number,
  amountText: string,
  xDollar = 252,
  xDigits = 257
): PdfTextItem[] {
  const items: PdfTextItem[] = [{ text: label, x: xLabel, y, width: 80, height: 10, font_size: 9 }];
  // amountText is the FULL amount as printed in the PDF, e.g. "$1,234.56" or "-$72.40".
  // Split it the way BofA actually emits it: dollar/minus prefix in one cell, digits in another.
  const m = /^(-?\$)(.+)$/.exec(amountText);
  if (m) {
    items.push({ text: m[1]!, x: xDollar, y: y - 1, width: 10, height: 10, font_size: 9 });
    items.push({ text: m[2]!, x: xDigits, y: y - 1, width: 40, height: 10, font_size: 9 });
  } else {
    items.push({ text: amountText, x: xDigits, y: y - 1, width: 40, height: 10, font_size: 9 });
  }
  return items;
}

function buildRealLayoutFixture(): PdfTextWithPositions {
  // Page-1 Account Summary box on the LEFT side, with split-cell amounts.
  // Plus the brand markers we need for detect(), the period string, and the
  // account number in the "Account# #### #### #### 2050" space-separated form
  // that real BofA uses.
  const page1Items: PdfTextItem[] = [
    // Header / brand markers (detect)
    { text: 'Bank of America', x: 36, y: 740, width: 100, height: 14, font_size: 12 },
    { text: 'www.bankofamerica.com', x: 36, y: 720, width: 130, height: 9, font_size: 9 },
    { text: 'Visa Signature', x: 36, y: 700, width: 90, height: 11, font_size: 10 },

    // Account number (real BofA format: spaces between four 4-digit groups,
    // no space before #).  Synthetic digits — real statements have real ones.
    { text: 'Account# 4147 0010 0020 2050', x: 467, y: 571, width: 180, height: 9, font_size: 9 },

    // Statement period
    { text: 'March 13 - April 12, 2026', x: 36, y: 600, width: 150, height: 10, font_size: 9 },

    // Payment Due Date + Min Payment (just metadata, not under test)
    { text: 'Payment Due Date', x: 292, y: 488, width: 110, height: 9, font_size: 9 },
    { text: '05/09/2026', x: 535, y: 489, width: 70, height: 9, font_size: 9 },
    { text: 'Total Minimum Payment Due', x: 292, y: 498, width: 180, height: 9, font_size: 9 },
    { text: '$', x: 550, y: 499, width: 8, height: 9, font_size: 9 },
    { text: '15.00', x: 556, y: 499, width: 30, height: 9, font_size: 9 },

    // Account Summary header
    {
      text: 'Account Summary/Payment Information',
      x: 36,
      y: 521,
      width: 240,
      height: 10,
      font_size: 9
    },

    // ── Real split-cell summary rows ──
    ...summaryRow(506, 'Previous Balance', 36, '$200.00'),
    ...summaryRow(495, 'Payments and Other Credits', 36, '-$200.00', 247, 257),
    ...summaryRow(484, 'Purchases and Adjustments', 36, '$315.00'),
    ...summaryRow(472, 'Fees Charged', 36, '$0.00', 258, 264),
    ...summaryRow(461, 'Interest Charged', 36, '$0.00', 258, 264),
    ...summaryRow(441, 'New Balance Total', 36, '$315.00', 256, 262),

    // Right-side payment box also shows the New Balance Total (don't let it
    // overwrite the Account Summary value; the test below asserts both end up
    // with the same number anyway).
    { text: 'New Balance Total', x: 292, y: 524, width: 130, height: 10, font_size: 9 },
    { text: '$', x: 550, y: 525, width: 8, height: 9, font_size: 9 },
    { text: '315.00', x: 555, y: 525, width: 30, height: 9, font_size: 9 }
  ];

  // Page 2 — transactions (BofA prints "Transactions" as a section header).
  const page2Items: PdfTextItem[] = [
    { text: 'Transactions', x: 36, y: 740, width: 100, height: 12, font_size: 11 },

    // Column headers (we ignore these except to trigger section state)
    { text: 'Transaction', x: 36, y: 692, width: 70, height: 9, font_size: 9 },
    { text: 'Date', x: 36, y: 682, width: 30, height: 9, font_size: 9 },
    { text: 'Posting', x: 82, y: 692, width: 50, height: 9, font_size: 9 },
    { text: 'Date', x: 82, y: 682, width: 30, height: 9, font_size: 9 },
    { text: 'Description', x: 117, y: 682, width: 80, height: 9, font_size: 9 },
    { text: 'Reference', x: 358, y: 692, width: 60, height: 9, font_size: 9 },
    { text: 'Number', x: 358, y: 682, width: 50, height: 9, font_size: 9 },
    { text: 'Account', x: 417, y: 692, width: 50, height: 9, font_size: 9 },
    { text: 'Number', x: 417, y: 682, width: 50, height: 9, font_size: 9 },
    { text: 'Amount', x: 497, y: 682, width: 50, height: 9, font_size: 9 },
    { text: 'Total', x: 559, y: 682, width: 30, height: 9, font_size: 9 },

    // Payments and Other Credits section
    { text: 'Payments and Other Credits', x: 117, y: 666, width: 180, height: 9, font_size: 9 },
    // Row 1 — BofA emits "-" sign at one cell and digits at another
    { text: '04/02', x: 36, y: 657, width: 30, height: 9, font_size: 9 },
    { text: '04/02', x: 82, y: 657, width: 30, height: 9, font_size: 9 },
    { text: 'ONLINE PAYMENT THANK YOU', x: 117, y: 657, width: 180, height: 9, font_size: 9 },
    { text: '12345', x: 365, y: 657, width: 30, height: 9, font_size: 9 },
    { text: '2050', x: 423, y: 657, width: 30, height: 9, font_size: 9 },
    { text: '-', x: 498, y: 657, width: 6, height: 9, font_size: 9 },
    { text: '200.00', x: 503, y: 657, width: 40, height: 9, font_size: 9 },
    // Subtotal row — should be skipped
    {
      text: 'TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD',
      x: 132,
      y: 633,
      width: 280,
      height: 9,
      font_size: 9
    },
    { text: '-', x: 541, y: 633, width: 6, height: 9, font_size: 9 },
    { text: '$200.00', x: 546, y: 633, width: 50, height: 9, font_size: 9 },

    // Purchases and Adjustments section
    { text: 'Purchases and Adjustments', x: 117, y: 611, width: 180, height: 9, font_size: 9 },
    { text: '03/15', x: 36, y: 602, width: 30, height: 9, font_size: 9 },
    { text: '03/16', x: 82, y: 602, width: 30, height: 9, font_size: 9 },
    { text: 'AMAZON MARKETPLACE', x: 117, y: 602, width: 180, height: 9, font_size: 9 },
    { text: '6705', x: 365, y: 602, width: 30, height: 9, font_size: 9 },
    { text: '2050', x: 423, y: 602, width: 30, height: 9, font_size: 9 },
    { text: '125.50', x: 504, y: 602, width: 40, height: 9, font_size: 9 },

    { text: '03/22', x: 36, y: 592, width: 30, height: 9, font_size: 9 },
    { text: '03/23', x: 82, y: 592, width: 30, height: 9, font_size: 9 },
    { text: 'COSTCO WHOLESALE', x: 117, y: 592, width: 180, height: 9, font_size: 9 },
    { text: '4046', x: 365, y: 592, width: 30, height: 9, font_size: 9 },
    { text: '2050', x: 423, y: 592, width: 30, height: 9, font_size: 9 },
    { text: '189.50', x: 504, y: 592, width: 40, height: 9, font_size: 9 }
  ];

  return {
    pages: [
      { page_number: 1, items: page1Items },
      { page_number: 2, items: page2Items }
    ],
    total_pages: 2
  };
}

describe('BofA credit card adapter — real-layout split-cell summary', () => {
  test('detects BofA from a real-format header band', () => {
    const sampleHeaderText =
      'Bank of America www.bankofamerica.com Visa Signature Account# 4147 0010 0020 2050 Account Summary/Payment Information Previous Balance $200.00 New Balance Total';
    expect(bofaCreditCardAdapter.detect(sampleHeaderText)).toBe(true);
  });

  test('detect also accepts the anonymizer-collapsed hyphenated form', () => {
    const fixtureHeader =
      'Bank of America www.bankofamerica.com Visa Signature Account # XXXX-XXXX-XXXX-2050 New Balance Total $0.01';
    expect(bofaCreditCardAdapter.detect(fixtureHeader)).toBe(true);
  });

  test('extracts Account Summary from split-cell layout (the real BofA layout)', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await bofaCreditCardAdapter.parse(pdf);

    // The core regression case — both Previous Balance and New Balance Total
    // MUST be extracted from the split-cell layout.
    expect(result.statement.previous_balance_minor).toBe(20000n);
    expect(result.statement.statement_balance_minor).toBe(31500n);
    expect(result.statement.account_last_4).toBe('2050');
    expect(result.statement.period_start).toBe('2026-03-13');
    expect(result.statement.period_end).toBe('2026-04-12');
  });

  test('extracts transactions and checksum closes to the cent', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await bofaCreditCardAdapter.parse(pdf);

    // 1 payment + 2 purchases (subtotal row should be excluded).
    expect(result.transactions.length).toBe(3);

    // Find them by type.
    const payments = result.transactions.filter((t) => t.transaction_type === 'payment_to_card');
    const purchases = result.transactions.filter((t) => t.transaction_type === 'purchase');
    expect(payments.length).toBe(1);
    expect(purchases.length).toBe(2);

    // ParsedTransaction contract: inflows positive, outflows negative.
    // CC payment is an inflow to the credit account → positive.
    // CC purchase is an outflow on the credit account → negative.
    expect(payments[0]!.amount_minor).toBe(20000n);
    expect(purchases[0]!.amount_minor).toBe(-12550n);
    expect(purchases[1]!.amount_minor).toBe(-18950n);

    // Checksum: previous + (debits) - (credits) == new balance.
    const prev = result.statement.previous_balance_minor!;
    const nb = result.statement.statement_balance_minor!;
    const td = result.statement.total_debits_minor!;
    const tc = result.statement.total_credits_minor!;
    expect(prev + td - tc).toBe(nb);
  });

  test('handles "Account#" without space before # (real BofA spelling)', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await bofaCreditCardAdapter.parse(pdf);
    expect(result.statement.account_last_4).toBe('2050');
  });

  test('throws ParseError with a helpful message when summary cells are missing', async () => {
    const pdf = buildRealLayoutFixture();
    // Remove every Previous Balance / New Balance Total item to simulate a
    // future format change.
    for (const page of pdf.pages) {
      page.items = page.items.filter(
        (it) => !/Previous\s+Balance|New\s+Balance\s+Total/.test(it.text)
      );
    }
    await expect(bofaCreditCardAdapter.parse(pdf)).rejects.toThrow(
      /Previous Balance or New Balance Total/i
    );
  });
});
