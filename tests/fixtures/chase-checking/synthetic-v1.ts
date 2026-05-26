// Synthetic Chase Checking statement — hand-authored test data.
//
// NOT a real statement.  Numbers, names, dates, account number are invented to
// exercise the chase-checking adapter against a comprehensive set of formats:
//   - 4-field CHECKING SUMMARY box with mixed signs
//   - *start*/*end* section markers
//   - Beginning/Ending Balance marker rows inside the transaction table
//   - Multi-cell descriptions (Pennymac-style split across 3-4 items)
//   - Sub-$1 amount (.50) regression
//   - Comma-separated thousands amount
//   - The `MM/DD Payment To Chase Card Ending IN NNNN` reconciliation row
//   - Refund row (Card Purchase Return)
//   - Mixed transaction types: deposit, payment_to_card, transfer, refund

import type { PdfTextWithPositions, PdfTextItem } from '../../../src/lib/adapters/types';

function item(text: string, x: number, y: number): PdfTextItem {
  return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
}

// Numbers chosen so the Level A balance reconciles exactly:
//   Beginning      $5,000.00
//   + Deposits     $3,550.00  (Zelle in $500 + Payroll $3,000 + Return $50)
//   - Withdrawals  $4,001.00  ($1,000 + $200 + $300 + $2,500.50 + $0.50)
//   = Ending       $4,549.00

const page1Items: PdfTextItem[] = [
  item('February 26, 2026 through March 24, 2026', 366, 738),
  item('JPMorgan Chase Bank, N.A.', 59, 731),
  item('Account Number:', 362, 725),
  item('000000533089535', 437, 725),

  item('*start*summary', 35, 516),
  item('Chase College Checking', 204, 504),
  item('CHECKING SUMMARY', 41, 498),
  item('AMOUNT', 346, 484),

  item('Beginning Balance', 40, 473),
  item('$5,000.00', 331, 473),

  item('Deposits and Additions', 40, 459),
  item('3,550.00', 336, 459),

  item('Electronic Withdrawals', 40, 446),
  item('-4,001.00', 333, 446),

  item('Ending Balance', 40, 432),
  item('$4,549.00', 331, 432),

  item('*end*summary', 35, 419),

  // Transaction table starts:
  item('*start*transactiondetail', 31, 269),
  item('TRANSACTION DETAIL', 36, 251),
  item('DATE', 38, 233),
  item('DESCRIPTION', 80, 233),
  item('AMOUNT', 432, 233),
  item('BALANCE', 501, 233),

  // Beginning Balance marker row
  item('Beginning Balance', 87, 219),
  item('$5,000.00', 494, 219),

  // Transaction 1: Zelle deposit
  item('02/26', 36, 204),
  item('Zelle Payment From Friend Bacquqncxzdt', 80, 204),
  item('500.00', 435, 204),
  item('5,500.00', 499, 204),

  // Transaction 2: Payroll deposit (multi-cell description, comma-thousands amount)
  item('02/27', 36, 192),
  item('Altera Corporati Payroll', 80, 192),
  item('PPD ID: 1234567890', 227, 192),
  item('3,000.00', 427, 192),
  item('8,500.00', 494, 192),

  // Transaction 3: Payment To Chase Card — RECONCILIATION TRIGGER for US-P1-D
  item('02/28', 36, 180),
  item('02/27 Payment To Chase Card Ending IN 1797', 80, 180),
  item('-1,000.00', 424, 180),
  item('7,500.00', 494, 180),

  // Transaction 4: Zelle outflow
  item('03/01', 36, 167),
  item('Zelle Payment To Vendor Jpm99Cask0O2', 80, 167),
  item('-200.00', 437, 167),
  item('7,300.00', 499, 167),

  // Transaction 5: Discover E-Payment (typical CC bill pay)
  item('03/02', 36, 155),
  item('Discover', 80, 155),
  item('E-Payment', 137, 155),
  item('3562', 187, 155),
  item('Web ID: ABC123', 239, 155),
  item('-300.00', 430, 155),
  item('7,000.00', 497, 155),

  // Transaction 6: Card Purchase Return (refund)
  item('03/03', 36, 143),
  item('Card Purchase Return', 80, 143),
  item('03/01 Costco Whse Georgetown TX Card 0703', 181, 143),
  item('50.00', 435, 143),
  item('7,050.00', 494, 143),

  // Transaction 7: Pennymac cash (multi-cell long description + sub-cent amount)
  item('03/04', 36, 131),
  item('Pennymac', 80, 131),
  item('Cash', 147, 131),
  item('8212879623-0009 Web ID: 1262049351', 186, 131),
  item('-2,500.50', 422, 131),
  item('4,549.50', 494, 131),

  // Transaction 8: Sub-$1 amount (.50 form — regression for the PDF.js leading-zero bug)
  item('03/05', 36, 118),
  item('Robinhood Card Payment', 80, 118),
  item('-.50', 437, 118),
  item('4,549.00', 494, 118),

  // Ending Balance marker
  item('Ending Balance', 85, 95),
  item('$4,549.00', 487, 95),

  item('*end*transaction detail', 31, 66)
];

export const syntheticChaseChecking_v1: PdfTextWithPositions = {
  pages: [{ page_number: 1, items: page1Items }],
  total_pages: 1
};

export const expectedChaseChecking_v1 = {
  account_last_4: '9535',
  period_start: '2026-02-26',
  period_end: '2026-03-24',
  opening_balance_minor: 500000n, // $5,000.00
  closing_balance_minor: 454900n, // $4,549.00
  total_debits_minor: 400100n, // $4,001.00
  total_credits_minor: 355000n, // $3,550.00
  summary_lines: [
    { label: 'Beginning Balance', amount_minor: 500000n },
    { label: 'Deposits and Additions', amount_minor: 355000n },
    { label: 'Electronic Withdrawals', amount_minor: -400100n }, // signed
    { label: 'Ending Balance', amount_minor: 454900n }
  ],
  transactions: [
    {
      posted_date: '2026-02-26',
      transaction_type: 'deposit',
      amount_minor: 50000n,
      descriptionContains: 'Zelle Payment From'
    },
    {
      posted_date: '2026-02-27',
      transaction_type: 'deposit',
      amount_minor: 300000n,
      descriptionContains: 'Altera Corporati Payroll'
    },
    {
      posted_date: '2026-02-28',
      transaction_type: 'payment_to_card',
      amount_minor: -100000n,
      descriptionContains: 'Payment To Chase Card Ending IN 1797'
    },
    {
      posted_date: '2026-03-01',
      transaction_type: 'transfer',
      amount_minor: -20000n,
      descriptionContains: 'Zelle Payment To'
    },
    {
      // Cross-bank CC payment: the matcher recognizes "Discover E-Payment NNNN"
      // and tags it payment_to_card so reconciliation can link it to a
      // Discover CC statement if/when one is imported.
      posted_date: '2026-03-02',
      transaction_type: 'payment_to_card',
      amount_minor: -30000n,
      descriptionContains: 'Discover E-Payment'
    },
    {
      posted_date: '2026-03-03',
      transaction_type: 'refund',
      amount_minor: 5000n,
      descriptionContains: 'Card Purchase Return'
    },
    {
      posted_date: '2026-03-04',
      transaction_type: 'other',
      amount_minor: -250050n,
      descriptionContains: 'Pennymac'
    },
    {
      // Robinhood is a card issuer; their card-payment ACH descriptor doesn't
      // carry a last_4, but `detectCardPayment` still recognizes it.
      posted_date: '2026-03-05',
      transaction_type: 'payment_to_card',
      amount_minor: -50n, // SUB-$1 regression
      descriptionContains: 'Robinhood Card Payment'
    }
  ]
};
