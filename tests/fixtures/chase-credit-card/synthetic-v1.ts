// Synthetic Chase Credit Card statement — hand-authored test data.
//
// This is NOT a real statement.  All names, amounts, dates, and account
// numbers are invented by the test author to exercise the adapter's parser
// without committing any real user data to the public repo.
//
// Layout mirrors the modern Chase Sapphire / Amazon Prime Visa statement:
//   Page 1 — Account Summary box (top of page) and payment coupon stub
//   Page 3 — ACCOUNT ACTIVITY table with PAYMENTS / PURCHASE / INTEREST sections
//
// Numbers chosen so the Level A/B/C checksums all reconcile.

import type { PdfTextWithPositions, PdfTextItem } from '../../../src/lib/adapters/types';

function item(text: string, x: number, y: number): PdfTextItem {
  return {
    text,
    x,
    y,
    width: text.length * 5,
    height: 10,
    font_size: 9
  };
}

// ── Page 1: Account Summary box ──────────────────────────────────────────────
// X-coordinates mirror the real layout: label at x=18, amount at x≈215-229.
const page1Items: PdfTextItem[] = [
  // Header band — needed for adapter detection.
  item('Chase Card Services', 18, 740),
  item('www.chase.com/cardhelp', 189, 720),

  // ACCOUNT SUMMARY box header
  item('ACCOUNT', 18, 609),
  item('SUMMARY', 91, 609),
  item('Account Number: XXXX XXXX XXXX 1234', 18, 595),

  // Summary rows.  Numbers chosen so the Level A/B/C/D checksums reconcile
  // against the transaction listing below:
  //   3 payments totalling $501.00 (one $500.00 + two $0.50 refunds)
  //   8 purchases totalling $1,750.84 (one $1,000 + two $0.50/$0.34 + 5 mid)
  //   Math: $500 (prev) + $1,750.84 (charges) - $501 (payments) = $1,749.84
  item('Previous Balance', 18, 581),
  item('$500.00', 220, 581),

  item('Payment, Credits', 18, 569),
  item('-$501.00', 215, 569),

  item('Purchases', 18, 558),
  item('+$1,750.84', 215, 558),

  item('Cash Advances', 18, 546),
  item('$0.00', 229, 546),

  item('Balance Transfers', 18, 534),
  item('$0.00', 229, 534),

  item('Fees Charged', 18, 522),
  item('$0.00', 229, 522),

  item('Interest Charged', 18, 510),
  item('$0.00', 229, 510),

  item('New Balance', 18, 496),
  item('$1,749.84', 220, 496),

  item('Opening/Closing Date', 18, 484),
  item('03/14/2026 - 04/13/2026', 181, 484),

  item('Credit Access Line', 18, 472),
  item('$5,000.00', 220, 472),

  item('Available Credit', 18, 460),
  item('$4,250.00', 220, 460),

  // Payment Due Date + Minimum Payment Due appear in the top-right "Payment
  // Information" box on real Chase statements.  In the flat-text scan we
  // depend on the label-then-date and label-then-amount patterns.
  item('Payment Due Date', 270, 192),
  item('05/10/2026', 467, 192),
  item('Minimum Payment Due:', 270, 168),
  item('$25.00', 475, 168)
];

// ── Page 2: legal/info text — skipped by the adapter ─────────────────────────
const page2Items: PdfTextItem[] = [
  item('Information About Your Account', 50, 890),
  item('Making Your Payments:', 50, 877),
  item('You may make payments electronically through our website or by one of', 50, 836)
];

// ── Page 3: ACCOUNT ACTIVITY table ───────────────────────────────────────────
const page3Items: PdfTextItem[] = [
  item('ACCOUNT', 26, 920),
  item('ACTIVITY', 99, 920),
  item('Date of', 37, 903),
  item('Transaction', 29, 893),
  item('Merchant Name or Transaction Description', 182, 893),
  item('$ Amount', 452, 893),

  // PAYMENTS AND OTHER CREDITS
  item('PAYMENTS', 26, 877),
  item('AND', 79, 877),
  item('OTHER', 101, 877),
  item('CREDITS', 135, 877),
  // Three payment rows totalling $501.00.  One sub-$1 row uses ".50" form —
  // PDF.js emits sub-$1 amounts that way on Chase statements (no leading 0).
  // This row is the regression for the bug discovered on 1797 March smoke test.
  item('04/02', 27, 864),
  item('Payment Thank You-Mobile', 112, 864),
  item('-500.00', 462, 864),
  item('04/03', 27, 853),
  item('PAYPAL *CREDIT REFUND', 112, 853),
  item('-.50', 470, 853),
  item('04/04', 27, 842),
  item('AMAZON MKTPLACE REFUND', 112, 842),
  item('-.50', 470, 842),

  // PURCHASE section — totals $751.84.  Two rows use the ".XX" sub-$1 form.
  item('PURCHASE', 26, 830),

  item('04/01', 27, 815),
  item('FAKE COFFEE SHOP AUSTIN TX', 112, 815),
  item('100.00', 466, 815),

  item('04/05', 27, 803),
  item('TEST AIRLINES INC SAN FRANCISCO CA', 112, 803),
  item('150.00', 466, 803),

  item('04/06', 27, 791),
  item('TARGET 00019828 GEORGETOWN TX', 112, 791),
  item('.34', 475, 791),

  item('04/07', 27, 779),
  item('PAYPAL *MYIQCOM DE', 112, 779),
  item('.50', 475, 779),

  // Comma-separated thousands — checks that "1,234.56" still parses
  item('04/08', 27, 767),
  item('LARGE PURCHASE TEXAS', 112, 767),
  item('1,000.00', 456, 767),

  item('04/10', 27, 755),
  item('EXAMPLE GROCERY AUSTIN TX', 112, 755),
  item('200.00', 466, 755),

  item('04/15', 27, 743),
  item('DEMO MERCHANT NEW YORK NY', 112, 743),
  item('175.00', 466, 743),

  // Amazon-style purchase with multi-row continuation
  item('04/20', 27, 731),
  item('Amazon.com*BC1234 Amzn.com/bill WA', 112, 731),
  item('125.00', 466, 731),
  // continuation row 10pt below — outside row-tolerance, becomes a separate row
  item('Order Number 113-1111111-2222222', 113, 721),

  // End-of-activity marker — adapter stops here.
  item('2026 Totals Year-to-Date', 222, 528),
  item('Total fees charged in 2026', 166, 515),
  item('$0.00', 347, 515)
];

export const syntheticChaseCC_v1: PdfTextWithPositions = {
  pages: [
    { page_number: 1, items: page1Items },
    { page_number: 2, items: page2Items },
    { page_number: 3, items: page3Items }
  ],
  total_pages: 3
};

// Expected derived values — used by tests to assert correctness.
export const expectedChaseCC_v1 = {
  account_last_4: '1234',
  period_start: '2026-03-14',
  period_end: '2026-04-13',
  payment_due_date: '2026-05-10',
  minimum_payment_due_minor: 2500n,
  // Account Summary lines, in print order, with sign as bank prints.
  summary_lines: [
    { label: 'Previous Balance', amount_minor: 50000n }, // $500.00
    { label: 'Payment, Credits', amount_minor: -50100n }, // -$501.00 (printed as -)
    { label: 'Purchases', amount_minor: 175084n }, // $1,750.84 (printed as +)
    { label: 'Cash Advances', amount_minor: 0n },
    { label: 'Balance Transfers', amount_minor: 0n },
    { label: 'Fees Charged', amount_minor: 0n },
    { label: 'Interest Charged', amount_minor: 0n },
    { label: 'New Balance', amount_minor: 174984n }, // $1,749.84
    { label: 'Credit Limit', amount_minor: 500000n }, // $5,000.00
    { label: 'Available Credit', amount_minor: 425000n } // $4,250.00
  ],
  previous_balance_minor: 50000n,
  new_balance_minor: 174984n,
  payments_credits_minor: 50100n,
  purchases_total_minor: 175084n,
  // After sign inversion: payments printed as -X become inflow (positive),
  // purchases printed as X become outflow (negative).
  transactions: [
    // PAYMENTS section (in row order top-to-bottom)
    // Note transaction_type: cardholder payments (Payment Thank You) are
    // tagged `payment_to_card`; merchant-originated credits (refunds) are
    // tagged `refund` — see CC_PAYMENT_DESC_RE in the adapter.
    {
      posted_date: '2026-04-02',
      transaction_type: 'payment_to_card',
      amount_minor: 50000n,
      descriptionContains: 'Payment Thank You'
    },
    {
      posted_date: '2026-04-03',
      transaction_type: 'refund',
      amount_minor: 50n, // SUB-$1 REFUND: ".50" → $0.50 inflow
      descriptionContains: 'PAYPAL'
    },
    {
      posted_date: '2026-04-04',
      transaction_type: 'refund',
      amount_minor: 50n, // another sub-$1 refund
      descriptionContains: 'AMAZON'
    },
    // PURCHASE section
    {
      posted_date: '2026-04-01',
      transaction_type: 'purchase',
      amount_minor: -10000n,
      descriptionContains: 'FAKE COFFEE SHOP'
    },
    {
      posted_date: '2026-04-05',
      transaction_type: 'purchase',
      amount_minor: -15000n,
      descriptionContains: 'TEST AIRLINES'
    },
    {
      posted_date: '2026-04-06',
      transaction_type: 'purchase',
      amount_minor: -34n, // SUB-$1 PURCHASE: ".34" → -$0.34 outflow
      descriptionContains: 'TARGET'
    },
    {
      posted_date: '2026-04-07',
      transaction_type: 'purchase',
      amount_minor: -50n, // SUB-$1 PURCHASE
      descriptionContains: 'PAYPAL'
    },
    {
      posted_date: '2026-04-08',
      transaction_type: 'purchase',
      amount_minor: -100000n, // COMMA-THOUSANDS: "1,000.00" → -$1,000
      descriptionContains: 'LARGE PURCHASE'
    },
    {
      posted_date: '2026-04-10',
      transaction_type: 'purchase',
      amount_minor: -20000n,
      descriptionContains: 'EXAMPLE GROCERY'
    },
    {
      posted_date: '2026-04-15',
      transaction_type: 'purchase',
      amount_minor: -17500n,
      descriptionContains: 'DEMO MERCHANT'
    },
    {
      posted_date: '2026-04-20',
      transaction_type: 'purchase',
      amount_minor: -12500n,
      descriptionContains: 'Amazon.com',
      continuationContains: 'Order Number 113-1111111-2222222'
    }
  ]
};
