// Regression tests for the Discover IT credit-card adapter.
//
// Coverage motivation (2026-05-23): discover-credit-card/adapter.ts was at
// 14.67% line coverage before this file existed.  Only the env-gated local
// validation tests touched it, and those don't run in CI.  This file gives
// the adapter direct unit-test coverage using a synthetic fixture that
// mirrors the real Discover IT statement layout.
//
// Layout quirks tested:
//   - Section headers are EMBEDDED in column-header rows
//     (e.g., "TRANS. DATE PAYMENTS AND CREDITS AMOUNT"), not on their own
//     line.  The adapter accepts a row that CONTAINS the section's name.
//   - Amount sign convention: "-$X.XX" for payments, "$X.XX" for purchases.
//     The adapter inverts the printed sign per ParsedTransaction contract.
//   - "DISCOVER IT" + "CARD ENDING IN NNNN" + "Cashback Bonus" form the
//     detect() fingerprint.  Plain "Discover" alone must NOT match (it
//     appears in other banks' transaction descriptors).

import { describe, test, expect } from 'vitest';
import { discoverCreditCardAdapter } from '../../../src/lib/adapters/discover-credit-card/adapter';
import type { PdfTextItem, PdfTextWithPositions } from '../../../src/lib/adapters/types';

// ── Fixture builder ──────────────────────────────────────────────────────────

function mkItem(text: string, x: number, y: number): PdfTextItem {
  return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
}

function txnRow(
  y: number,
  date: string,
  desc: string,
  category: string,
  amount: string
): PdfTextItem[] {
  const items: PdfTextItem[] = [mkItem(date, 38, y), mkItem(desc, 80, y)];
  // Real Discover PAYMENT rows have no category cell (only PURCHASE rows do).
  // An empty category lets the parser correctly classify the row by current
  // section, without re-triggering header detection.
  if (category !== '') items.push(mkItem(category, 257, y));
  items.push(mkItem(amount, 369, y));
  return items;
}

function buildRealLayoutFixture(): PdfTextWithPositions {
  // Page 1: detect markers + Account Summary box
  const page1: PdfTextItem[] = [
    mkItem('DISCOVER IT CARD ENDING IN 3562', 36, 740),
    mkItem('CARDMEMBER SINCE 2020', 36, 720),
    mkItem('Cashback Bonus', 36, 700),
    mkItem('Discover.com', 400, 740),

    // Open to Close Date
    mkItem('Open to Close Date:', 36, 660),
    mkItem('02/24/2026 - 03/23/2026', 200, 660),

    // Payment Due Date + Minimum
    mkItem('Payment Due Date', 36, 640),
    mkItem('04/20/2026', 200, 640),
    mkItem('Minimum Payment Due', 36, 620),
    mkItem('$25.00', 200, 620),

    // Account Summary — single cell per label, single cell per amount
    mkItem('Previous Balance', 36, 580),
    mkItem('$341.27', 250, 580),
    mkItem('Payments and Credits', 36, 560),
    mkItem('-$351.27', 250, 560),
    mkItem('Purchases', 36, 540),
    mkItem('$25.07', 250, 540),
    mkItem('Balance Transfers', 36, 520),
    mkItem('$0.00', 250, 520),
    mkItem('Cash Advances', 36, 500),
    mkItem('$0.00', 250, 500),
    mkItem('Fees Charged', 36, 480),
    mkItem('$0.00', 250, 480),
    mkItem('Interest Charged', 36, 460),
    mkItem('$0.00', 250, 460),
    mkItem('New Balance', 36, 440),
    mkItem('$15.07', 250, 440),
    mkItem('Credit Line', 36, 400),
    mkItem('$13,600.00', 250, 400),
    mkItem('Credit Line Available', 36, 380),
    mkItem('$13,584.93', 250, 380)
  ];

  // Page 3: transactions
  const page3: PdfTextItem[] = [
    // PAYMENTS section — header EMBEDDED in column row
    mkItem('TRANS. DATE', 38, 740),
    mkItem('PAYMENTS AND CREDITS', 80, 740),
    mkItem('AMOUNT', 380, 740),

    ...txnRow(720, '03/03', 'INTERNET PAYMENT - THANK YOU', '', '-$351.27'),

    // PURCHASES section header
    mkItem('TRANS. DATE', 38, 680),
    mkItem('PURCHASES', 80, 680),
    mkItem('CATEGORY', 257, 680),
    mkItem('AMOUNT', 380, 680),

    ...txnRow(660, '03/09', 'GOOGLE *YOUTUBE G.CO/HELPPAY#CA', 'Services', '$3.99'),
    ...txnRow(645, '03/15', 'GOOGLE *IVCAM WEBCAM 855-836-3987 CA', 'Merchandise', '$9.99'),
    ...txnRow(630, '03/18', 'X CORP. PAID FEATURES 4156978699 TX', 'Merchandise', '$1.09'),
    ...txnRow(615, '03/22', 'AMAZON MKTPL*ABCD123', 'Merchandise', '$10.00'),

    // Section end marker
    mkItem('Interest Charge Calculation', 36, 200)
  ];

  return {
    pages: [
      { page_number: 1, items: page1 },
      { page_number: 2, items: [] },
      { page_number: 3, items: page3 }
    ],
    total_pages: 3
  };
}

// ── Detect ───────────────────────────────────────────────────────────────────

describe('Discover adapter — detect', () => {
  test('matches a real-format Discover IT header band', () => {
    expect(
      discoverCreditCardAdapter.detect(
        'DISCOVER IT CARD ENDING IN 3562 CARDMEMBER SINCE 2020 Cashback Bonus'
      )
    ).toBe(true);
  });

  test('matches Discover.com URL alone', () => {
    expect(discoverCreditCardAdapter.detect('Discover.com Account Summary')).toBe(true);
  });

  test('matches Cashback Bonus alone (Discover-exclusive program)', () => {
    expect(discoverCreditCardAdapter.detect('Your Cashback Bonus this month')).toBe(true);
  });

  test('does NOT match a plain "Discover" word (could be another bank describing a Discover payment)', () => {
    // This is the FALSE POSITIVE the detect() function was tightened to avoid.
    // Chase Checking has "Discover E-Payment 3562" rows; we must not claim those.
    expect(
      discoverCreditCardAdapter.detect('Chase Checking — Discover E-Payment 3562 Web ID')
    ).toBe(false);
  });

  test('does NOT match "Card Ending In NNNN" without Discover-specific markers', () => {
    expect(
      discoverCreditCardAdapter.detect('Bank of America Visa Signature Card Ending in 2050')
    ).toBe(false);
  });
});

// ── Parse — Account Summary ─────────────────────────────────────────────────

describe('Discover adapter — Account Summary extraction', () => {
  test('extracts Previous Balance, payments, purchases, New Balance', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await discoverCreditCardAdapter.parse(pdf);

    expect(result.statement.previous_balance_minor).toBe(34127n);
    expect(result.statement.statement_balance_minor).toBe(1507n);
    expect(result.statement.account_last_4).toBe('3562');
  });

  test('extracts statement period from "Open to Close Date"', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await discoverCreditCardAdapter.parse(pdf);
    expect(result.statement.period_start).toBe('2026-02-24');
    expect(result.statement.period_end).toBe('2026-03-23');
  });

  test('extracts Payment Due Date + Minimum Payment', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await discoverCreditCardAdapter.parse(pdf);
    expect(result.statement.payment_due_date).toBe('2026-04-20');
    expect(result.statement.minimum_payment_due_minor).toBe(2500n);
  });
});

// ── Parse — Transactions ─────────────────────────────────────────────────────

describe('Discover adapter — Transactions extraction', () => {
  test('extracts payments and purchases with correct sign convention', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await discoverCreditCardAdapter.parse(pdf);

    const payments = result.transactions.filter((t) => t.transaction_type === 'payment_to_card');
    const purchases = result.transactions.filter((t) => t.transaction_type === 'purchase');

    expect(payments.length).toBe(1);
    expect(purchases.length).toBe(4);

    // Per ParsedTransaction contract: inflows positive, outflows negative.
    // Discover prints payment as "-$351.27" (negative); adapter inverts → +$351.27.
    expect(payments[0]!.amount_minor).toBe(35127n);
    expect(payments[0]!.description).toContain('INTERNET PAYMENT');

    // Discover prints purchase as "$3.99" (positive); adapter inverts → -$3.99.
    expect(purchases[0]!.amount_minor).toBe(-399n);
    expect(purchases[0]!.description).toContain('GOOGLE');
  });

  test('checksum closes — previous + debits - credits === new balance', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await discoverCreditCardAdapter.parse(pdf);

    const prev = result.statement.previous_balance_minor!;
    const nb = result.statement.statement_balance_minor!;
    const td = result.statement.total_debits_minor!;
    const tc = result.statement.total_credits_minor!;
    // $341.27 + ($25.07 purchases) - $351.27 (payment) = $15.07 ✓
    expect(prev + td - tc).toBe(nb);
  });

  test('parses dates with year inference based on period range', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await discoverCreditCardAdapter.parse(pdf);
    // All MM/DD dates fall in 2026 because both period endpoints are in 2026
    for (const t of result.transactions) {
      expect(t.posted_date).toMatch(/^2026-\d{2}-\d{2}$/);
    }
  });
});

// ── Defensive: missing data ──────────────────────────────────────────────────

describe('Discover adapter — defensive error handling', () => {
  test('throws ParseError when statement period is missing', async () => {
    const pdf = buildRealLayoutFixture();
    pdf.pages[0]!.items = pdf.pages[0]!.items.filter(
      (it) => !/Open to Close|02\/24\/2026/.test(it.text)
    );
    await expect(discoverCreditCardAdapter.parse(pdf)).rejects.toThrow(/period/i);
  });

  test('throws ParseError when Previous Balance is missing', async () => {
    const pdf = buildRealLayoutFixture();
    pdf.pages[0]!.items = pdf.pages[0]!.items.filter(
      (it) => !/Previous\s+Balance/i.test(it.text) && !/^341\./.test(it.text)
    );
    // Also strip the $341.27 cell
    pdf.pages[0]!.items = pdf.pages[0]!.items.filter((it) => it.text !== '$341.27');
    await expect(discoverCreditCardAdapter.parse(pdf)).rejects.toThrow(
      /Previous Balance or New Balance/i
    );
  });
});
