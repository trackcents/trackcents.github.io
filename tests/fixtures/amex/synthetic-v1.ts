// Synthetic Amex Blue Cash Everyday statement — hand-authored test data.
//
// Mirrors the real Amex statement template (header, payment summary, account
// summary, transactions in two sections, fees, interest, billing-period days).
// Covers all the formats a financial QA would probe:
//   - "Account Ending N-NNNNN" pattern (the 5-digit suffix with dash)
//   - "Closing Date MM/DD/YYYY" (full year, not MM/DD like Chase)
//   - "Days in Billing Period: NN" → derives period_start
//   - Payments printed -$X.XX, charges printed $X.XX
//   - Multi-row merchant continuation (phone / email line under each charge)
//   - Sub-$1 charge (.50 regression)
//   - Comma-thousands amount
//   - Refund row (negative in payments section)

import type { PdfTextWithPositions, PdfTextItem } from '../../../src/lib/adapters/types';

function item(text: string, x: number, y: number): PdfTextItem {
  return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
}

// Numbers chosen so the checksum reconciles:
//   Previous Balance:    $500.00
//   Less Payments/Credits: $250.00 (one $250 payment + one $50 refund = $300 - actually let me redo)
//   ... simpler: 1 payment $250.50, plus 1 refund $25.00 (in payments section)
//   Plus New Charges:    $1,030.50  (one $1,000 + one $30 + one $0.50)
//   Plus Fees:           $35.00     (one annual fee)
//   Plus Interest:       $4.00
//   Equals New Balance:  $500 - 250.50 - 25 + 1030.50 + 35 + 4 = $1,294.00

const page1Items: PdfTextItem[] = [
  item('Blue Cash Everyday® from American Express', 99, 735),
  item('Prepared for', 50, 690),
  item('ACCOUNT HOLDER', 50, 675),
  item('Account Ending 2-03004', 50, 665),
  item('Closing Date 03/17/2026', 50, 654),

  item('Payment Summary', 50, 625),
  item('New Balance', 50, 602),
  item('$1,294.00', 302, 602),
  item('Minimum Payment Due', 50, 587),
  item('$40.00', 302, 587),
  item('Payment Due Date', 50, 573),
  item('04/14/2026', 302, 573),

  item('Account Summary', 50, 410),
  item('Previous Balance', 50, 395),
  item('$500.00', 230, 395),
  item('Less Payments/Credits', 50, 385),
  item('$275.50', 230, 385),
  item('Plus New Charges', 50, 374),
  item('$1,030.50', 230, 374),
  item('Plus Fees', 50, 363),
  item('$35.00', 230, 363),
  item('Plus Interest Charged', 50, 352),
  item('$4.00', 230, 352),
  item('Equals New Balance', 50, 341),
  item('$1,294.00', 230, 341),

  item('Credit Summary', 50, 318),
  item('Credit Limit', 50, 307),
  item('$10,000.00', 230, 307),
  item('Available Credit', 50, 296),
  item('$8,706.00', 230, 296)
];

const page2Items: PdfTextItem[] = [
  item('Payments and Credits Summary', 50, 704),
  item('Payments Details', 50, 620),
  item('*Indicates posting date', 50, 610),
  item('ACCOUNT HOLDER', 50, 596),
  item('Card Ending 2-03004', 50, 581),
  item('Date', 50, 564),
  item('Description', 101, 564),
  item('Amount', 553, 564),

  // Payment #1 — standard mobile payment
  item('03/05/2026*', 50, 550),
  item('MOBILE PAYMENT - THANK YOU', 101, 550),
  item('-$250.50', 559, 550),

  // Payment #2 — merchant refund (Amex sometimes puts refunds here)
  item('03/10/2026', 50, 536),
  item('MERCHANT CREDIT - AMAZON RETURN', 101, 536),
  item('-$25.00', 559, 536),

  item('New Charges Summary', 50, 516),
  item('New Charges Details', 50, 457),
  item('ACCOUNT HOLDER', 50, 442),
  item('Card Ending 2-03004', 50, 427),
  item('Date', 50, 411),
  item('Description', 101, 411),
  item('Amount', 553, 411),

  // Charge #1 — multi-row merchant (phone continuation)
  item('02/20/2026', 50, 397),
  item('OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', 101, 397),
  item('$30.00', 564, 397),
  // Continuation row — merchant phone
  item('800-555-0100', 101, 387),

  // Charge #2 — sub-$1 charge (.50 regression)
  item('02/22/2026', 50, 374),
  item('GOOGLE *YOUTUBE PREMIUM MOUNTAIN VIEW CA', 101, 374),
  item('$0.50', 564, 374),
  item('650-555-0200 / billing@google', 101, 364),

  // Charge #3 — comma-thousands amount (large purchase)
  item('03/01/2026', 50, 343),
  item('DELTA AIRLINES ATLANTA GA', 101, 343),
  item('$1,000.00', 559, 343),

  // Fees section
  item('Fees', 50, 325),
  item('02/17/2026', 50, 310),
  item('ANNUAL MEMBERSHIP FEE', 101, 310),
  item('$35.00', 564, 310),
  item('Total Fees for this Period', 50, 296),
  item('$35.00', 561, 296),

  // Interest section
  item('Interest Charged', 50, 278),
  item('03/17/2026', 50, 263),
  item('INTEREST CHARGE ON PURCHASES', 101, 263),
  item('$4.00', 564, 263),
  item('Total Interest Charged for this Period', 50, 249),
  item('$4.00', 561, 249),

  // Closing legal text — adapter should STOP parsing here.
  item('About Trailing Interest', 50, 225),
  item('Interest Charge Calculation', 50, 176),
  item('Days in Billing Period: 30', 50, 151)
];

export const syntheticAmex_v1: PdfTextWithPositions = {
  pages: [
    { page_number: 1, items: page1Items },
    { page_number: 2, items: page2Items }
  ],
  total_pages: 2
};

export const expectedAmex_v1 = {
  account_last_4: '3004', // last 4 chars of "2-03004"
  period_start: '2026-02-16', // 30 days back from 03/17/2026 inclusive
  period_end: '2026-03-17',
  payment_due_date: '2026-04-14',
  minimum_payment_due_minor: 4000n,
  previous_balance_minor: 50000n,
  new_balance_minor: 129400n,
  // Level B aggregates (sum of all "Plus" rows on debit side; abs of payments on credit)
  total_debits_minor: 106950n, // 1030.50 + 35.00 + 4.00 = 1069.50
  total_credits_minor: 27550n, // 250.50 + 25.00 = 275.50
  // 7 transactions: 1 payment + 1 refund + 3 charges + 1 fee + 1 interest
  transaction_count: 7,
  // Per-transaction expectations
  transactions: [
    {
      posted_date: '2026-03-05',
      transaction_type: 'payment_to_card',
      amount_minor: 25050n, // +$250.50 (inverted from printed -$250.50)
      descriptionContains: 'MOBILE PAYMENT'
    },
    {
      posted_date: '2026-03-10',
      transaction_type: 'refund',
      amount_minor: 2500n, // +$25.00 inflow
      descriptionContains: 'MERCHANT CREDIT'
    },
    {
      posted_date: '2026-02-20',
      transaction_type: 'purchase',
      amount_minor: -3000n, // -$30.00 outflow
      descriptionContains: 'OPENAI'
    },
    {
      posted_date: '2026-02-22',
      transaction_type: 'purchase',
      amount_minor: -50n, // SUB-$1 regression
      descriptionContains: 'YOUTUBE PREMIUM'
    },
    {
      posted_date: '2026-03-01',
      transaction_type: 'purchase',
      amount_minor: -100000n, // -$1,000.00 (comma-thousands)
      descriptionContains: 'DELTA'
    },
    {
      posted_date: '2026-02-17',
      transaction_type: 'fee',
      amount_minor: -3500n,
      descriptionContains: 'ANNUAL MEMBERSHIP FEE'
    },
    {
      posted_date: '2026-03-17',
      transaction_type: 'interest',
      amount_minor: -400n,
      descriptionContains: 'INTEREST CHARGE'
    }
  ]
};
