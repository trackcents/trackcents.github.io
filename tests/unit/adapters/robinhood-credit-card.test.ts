// Regression tests for the Robinhood Credit card adapter.
//
// Coverage motivation (2026-05-23): robinhood-credit-card/adapter.ts was at
// 21.49% line coverage before this file existed.  Only env-gated local
// validation tests touched it, and those don't run in CI.  This file gives
// the adapter direct unit-test coverage using a synthetic fixture that
// mirrors the real Robinhood Credit statement layout.
//
// Layout quirks tested:
//   - Account number printed with SPACES between groups: "XXXX XXXX XXXX 9024".
//   - Statement period derived from "Statement Closing Date <Month D, YYYY>"
//     plus "Days in Billing Cycle: N" (no explicit start date printed).
//   - Account Summary uses OPERATOR-PREFIXED labels:
//     "- Payments & Credits", "+ Purchases & Other Charges",
//     "+ FEE CHARGED", "+ INTEREST CHARGED", "= New Balance".
//   - TRAILING-MINUS sign convention on payments: "344.92-" (NOT "-344.92").
//     The adapter's normalizeAmount() rewrites these before parseMoney.
//   - Brand keyword "Robinhood" only appears on page 3 (page 1 logo is image).
//     The page-1 detect fingerprint relies on the operator labels.
//   - Each transaction row has Tran Date + Post Date columns; the parser
//     skips the second date.

import { describe, test, expect } from 'vitest';
import { robinhoodCreditCardAdapter } from '../../../src/lib/adapters/robinhood-credit-card/adapter';
import type { PdfTextItem, PdfTextWithPositions } from '../../../src/lib/adapters/types';

// ── Fixture builder ──────────────────────────────────────────────────────────

function mkItem(text: string, x: number, y: number): PdfTextItem {
  return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
}

// Robinhood transaction row: Tran date, Post date, description, amount.
// Amount uses trailing-minus for credits.
function txnRow(
  y: number,
  tranDate: string,
  postDate: string,
  desc: string,
  amount: string
): PdfTextItem[] {
  return [
    mkItem(tranDate, 38, y),
    mkItem(postDate, 80, y),
    mkItem(desc, 130, y),
    mkItem(amount, 530, y)
  ];
}

function buildRealLayoutFixture(): PdfTextWithPositions {
  // Page 1: Account Summary + detect fingerprint markers.  Note: brand
  // keyword "Robinhood" is NOT on page 1 in the real PDF (it's a logo image).
  // Detect relies on the operator-prefixed labels.
  const page1: PdfTextItem[] = [
    mkItem('ACCOUNT HOLDER', 36, 760),
    mkItem('Account Number: XXXX XXXX XXXX 9024', 36, 740),

    // Statement metadata
    mkItem('Statement Closing Date', 36, 700),
    mkItem('March 29, 2026', 200, 700),
    mkItem('Days in Billing Cycle', 36, 680),
    mkItem('30', 200, 680),

    // Payment Due Date + Minimum Payment
    mkItem('Payment Due Date', 36, 660),
    mkItem('April 24, 2026', 200, 660),
    mkItem('Minimum Payment Due', 36, 640),
    mkItem('$25.00', 200, 640),

    mkItem('Credit Limit', 36, 600),
    mkItem('$5,000.00', 250, 600),
    mkItem('Credit Available', 36, 580),
    mkItem('$4,816.20', 250, 580),

    // ── Account Summary box (operator-prefixed labels) ──
    mkItem('Previous Balance', 36, 540),
    mkItem('$0.00', 250, 540),
    mkItem('- Payments & Credits', 36, 520),
    mkItem('$0.00', 250, 520),
    mkItem('+ Purchases & Other Charges', 36, 500),
    mkItem('$183.80', 250, 500),
    mkItem('+ Balance Transfer', 36, 480),
    mkItem('$0.00', 250, 480),
    mkItem('+ Cash Advances', 36, 460),
    mkItem('$0.00', 250, 460),
    mkItem('+ FEE CHARGED', 36, 440),
    mkItem('$0.00', 250, 440),
    mkItem('+ INTEREST CHARGED', 36, 420),
    mkItem('$0.00', 250, 420),
    mkItem('= New Balance', 36, 400),
    mkItem('$183.80', 250, 400)
  ];

  // Page 2: TRANSACTIONS section
  const page2: PdfTextItem[] = [
    mkItem('TRANSACTIONS', 36, 760),

    // Tran/Post Date column headers
    mkItem('Tran Date', 38, 740),
    mkItem('Post Date', 80, 740),
    mkItem('Description', 130, 740),
    mkItem('Amount', 530, 740),

    // 3 purchases — Robinhood uses "$" prefix for positive amounts in
    // transaction rows AND has both Tran Date and Post Date columns.
    ...txnRow(720, '03/25', '03/26', 'F583800F4000MX084 GOLD ANNUAL SUBSCRIPTIO', '$50.00'),
    ...txnRow(
      700,
      '03/26',
      '03/27',
      '2471705F6GWYZG1LD FRONTIER AI PLZEFK 720-3744390 CO',
      '$108.80'
    ),
    ...txnRow(680, '03/26', '03/27', '2479338F502531Z0H Frontier Airlines Boston MA', '$25.00'),

    // End-of-section marker
    mkItem('INTEREST CHARGE CALCULATION', 36, 200)
  ];

  // Page 3: brand keyword that page 1 lacks (real layout has it in legal text)
  const page3: PdfTextItem[] = [
    mkItem('Robinhood Credit, Inc.', 36, 760),
    mkItem('Member FDIC', 36, 740)
  ];

  return {
    pages: [
      { page_number: 1, items: page1 },
      { page_number: 2, items: page2 },
      { page_number: 3, items: page3 }
    ],
    total_pages: 3
  };
}

// ── Detect ───────────────────────────────────────────────────────────────────

describe('Robinhood adapter — detect', () => {
  test('matches when at least 2 operator-prefixed labels appear (page-1 fingerprint)', () => {
    const sample =
      'ACCOUNT SUMMARY Days in Billing Cycle + FEE CHARGED + INTEREST CHARGED = New Balance';
    expect(robinhoodCreditCardAdapter.detect(sample)).toBe(true);
  });

  test('matches the explicit "Robinhood Credit" brand banner WHEN paired with an operator label or address', () => {
    // After 2026-05-23 tightening: the brand string "Robinhood Credit" alone
    // is NOT sufficient (it appears in other banks' transaction descriptors).
    // It needs to be paired with another Robinhood-specific marker.  In real
    // statements this is automatic — the page-3 brand legal text lands in the
    // same flatText as the page-1 operator labels.
    expect(
      robinhoodCreditCardAdapter.detect(
        'Robinhood Credit Member FDIC = New Balance Days in Billing Cycle'
      )
    ).toBe(true);
  });

  test('the brand "Robinhood Credit" or "Robinhood Card" ALONE is NOT enough', () => {
    // Bare brand strings appear in other banks' transaction descriptors.
    // They must not by themselves trigger Robinhood detection.
    expect(robinhoodCreditCardAdapter.detect('Robinhood Credit')).toBe(false);
    expect(robinhoodCreditCardAdapter.detect('Robinhood Card')).toBe(false);
  });

  test('matches "Robinhood" + address fingerprint', () => {
    expect(
      robinhoodCreditCardAdapter.detect(
        'Robinhood 85 Willow Road Menlo Park, CA 94025 something else'
      )
    ).toBe(true);
  });

  test('does NOT match a single operator label in isolation', () => {
    // "Days in Billing Cycle" alone is a generic banking phrase.  Detect
    // requires AT LEAST TWO Robinhood-style markers to fire.
    expect(robinhoodCreditCardAdapter.detect('Days in Billing Cycle 30 only')).toBe(false);
  });

  test('does NOT false-positive on a non-Robinhood statement that happens to say "Robinhood"', () => {
    // E.g., a Chase Checking statement with a transaction descriptor like
    // "Robinhood Card Payment".  Must not claim such a file.
    expect(
      robinhoodCreditCardAdapter.detect(
        'Chase Checking — 03/15 Robinhood Card Payment PPD ID: 6823032815'
      )
    ).toBe(false);
  });
});

// ── Parse — Account Summary ─────────────────────────────────────────────────

describe('Robinhood adapter — Account Summary extraction', () => {
  test('extracts Previous Balance + New Balance from operator-prefixed labels', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await robinhoodCreditCardAdapter.parse(pdf);
    expect(result.statement.previous_balance_minor).toBe(0n);
    expect(result.statement.statement_balance_minor).toBe(18380n);
  });

  test('extracts account_last_4 from space-separated account number', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await robinhoodCreditCardAdapter.parse(pdf);
    expect(result.statement.account_last_4).toBe('9024');
  });

  test('derives period from Statement Closing Date + Days in Billing Cycle', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await robinhoodCreditCardAdapter.parse(pdf);
    expect(result.statement.period_end).toBe('2026-03-29');
    // 30 days back from closing → period_start = 2026-02-28
    expect(result.statement.period_start).toBe('2026-02-28');
  });

  test('extracts Payment Due Date + Minimum Payment', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await robinhoodCreditCardAdapter.parse(pdf);
    expect(result.statement.payment_due_date).toBe('2026-04-24');
    expect(result.statement.minimum_payment_due_minor).toBe(2500n);
  });
});

// ── Parse — Transactions ─────────────────────────────────────────────────────

describe('Robinhood adapter — Transactions extraction', () => {
  test('parses purchases with correct sign (debits → negative amount_minor)', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await robinhoodCreditCardAdapter.parse(pdf);
    const purchases = result.transactions.filter((t) => t.transaction_type === 'purchase');
    expect(purchases.length).toBe(3);
    // Robinhood prints $50.00 / $108.80 / $25.00 as positive purchase amounts
    // → adapter inverts to negative per ParsedTransaction contract.
    expect(purchases.map((p) => p.amount_minor)).toEqual([-5000n, -10880n, -2500n]);
    expect(purchases[0]!.description).toContain('GOLD ANNUAL SUBSCRIPTIO');
  });

  test('skips the Post Date column when building description', async () => {
    const pdf = buildRealLayoutFixture();
    const result = await robinhoodCreditCardAdapter.parse(pdf);
    // Description should NOT contain the post date "03/26"
    for (const t of result.transactions) {
      expect(t.description).not.toMatch(/^\d{2}\/\d{2}\b/);
    }
  });
});

// ── Trailing-minus normalization ─────────────────────────────────────────────

describe('Robinhood adapter — trailing-minus sign convention', () => {
  test('payment row with trailing-minus amount classifies as payment_to_card with correct sign', async () => {
    // Build a fixture WITH a payment row.  Real Robinhood prints payment
    // amounts with TRAILING minus: "344.92-".  The adapter must normalize
    // this to -344.92 before parseMoney, then invert sign per contract → +344.92.
    const pdf = buildRealLayoutFixture();
    // Re-issue page 2 with a payment row added.
    pdf.pages[1]!.items = [
      mkItem('TRANSACTIONS', 36, 760),
      mkItem('Tran Date', 38, 740),
      mkItem('Post Date', 80, 740),
      mkItem('Description', 130, 740),
      mkItem('Amount', 530, 740),
      // Payment row — trailing minus
      ...txnRow(720, '03/15', '03/16', 'PAYMENT - THANK YOU', '344.92-'),
      // Purchase rows
      ...txnRow(700, '03/26', '03/27', 'Frontier Airlines', '$25.00'),
      mkItem('INTEREST CHARGE CALCULATION', 36, 200)
    ];

    const result = await robinhoodCreditCardAdapter.parse(pdf);
    const payments = result.transactions.filter((t) => t.transaction_type === 'payment_to_card');
    expect(payments.length).toBe(1);
    // Adapter normalized "344.92-" → -344.92, then inverted sign for contract
    // (payment is positive amount in our convention).  So we expect +34492n.
    expect(payments[0]!.amount_minor).toBe(34492n);
  });
});

// ── Defensive: missing data ──────────────────────────────────────────────────

describe('Robinhood adapter — defensive error handling', () => {
  test('throws ParseError when Statement Closing Date is missing', async () => {
    const pdf = buildRealLayoutFixture();
    pdf.pages[0]!.items = pdf.pages[0]!.items.filter(
      (it) => !/Statement Closing Date|March 29, 2026/.test(it.text)
    );
    await expect(robinhoodCreditCardAdapter.parse(pdf)).rejects.toThrow(/Statement Closing Date/i);
  });

  test('throws ParseError when Previous Balance + New Balance both missing', async () => {
    const pdf = buildRealLayoutFixture();
    pdf.pages[0]!.items = pdf.pages[0]!.items.filter(
      (it) =>
        !/Previous Balance|= New Balance/.test(it.text) &&
        it.text !== '$0.00' &&
        it.text !== '$183.80'
    );
    await expect(robinhoodCreditCardAdapter.parse(pdf)).rejects.toThrow(
      /Previous Balance or New Balance/i
    );
  });
});
