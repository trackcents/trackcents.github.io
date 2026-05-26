// Chase Checking adapter — fixture-driven tests covering all known
// statement formats (multi-cell descriptions, sub-$1 amounts, comma
// thousands, marker rows, the Payment-to-Chase-Card reconciliation trigger).

import { describe, expect, test } from 'vitest';
import { chaseCheckingAdapter } from '../../../src/lib/adapters/chase-checking/adapter';
import { chaseCreditCardAdapter } from '../../../src/lib/adapters/chase-credit-card/adapter';
import {
  syntheticChaseChecking_v1,
  expectedChaseChecking_v1
} from '../../fixtures/chase-checking/synthetic-v1';
import { runChecksumGate } from '../../../src/lib/app/checksum';

describe('Chase Checking adapter — detection', () => {
  test('detects a Chase Checking statement', () => {
    const sample = syntheticChaseChecking_v1.pages[0]!.items.map((i) => i.text)
      .join(' ')
      .slice(0, 4096);
    expect(chaseCheckingAdapter.detect(sample)).toBe(true);
  });

  test('does NOT mis-detect a Chase Credit Card statement as checking', () => {
    // A CC statement contains "Chase Card Services" in the payment-coupon block.
    // That alone must be enough to disambiguate even though both statements
    // share the Chase brand.
    const ccSample = 'Chase Card Services www.chase.com/cardhelp ACCOUNT SUMMARY Credit Limit';
    expect(chaseCheckingAdapter.detect(ccSample)).toBe(false);
  });

  test('checking and credit-card adapters have non-overlapping detect()', () => {
    // Both adapters should disagree on the same input.
    const checkingSample = syntheticChaseChecking_v1.pages[0]!.items.map((i) => i.text).join(' ');
    expect(chaseCheckingAdapter.detect(checkingSample)).toBe(true);
    expect(chaseCreditCardAdapter.detect(checkingSample)).toBe(false);
  });
});

describe('Chase Checking adapter — statement-level fields', () => {
  test('extracts account_last_4 from the 15-digit account number', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.account_last_4).toBe(expectedChaseChecking_v1.account_last_4);
  });

  test('parses long-form statement period ("Month DD, YYYY through Month DD, YYYY")', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.period_start).toBe(expectedChaseChecking_v1.period_start);
    expect(r.statement.period_end).toBe(expectedChaseChecking_v1.period_end);
  });

  test('classifies account_type as checking', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.account_type).toBe('checking');
  });
});

describe('Chase Checking adapter — CHECKING SUMMARY box', () => {
  test('extracts opening (Beginning) and closing (Ending) balances', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.opening_balance_minor).toBe(expectedChaseChecking_v1.opening_balance_minor);
    expect(r.statement.closing_balance_minor).toBe(expectedChaseChecking_v1.closing_balance_minor);
  });

  test('populates summary_lines with the 4 verbatim CHECKING SUMMARY rows', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.summary_lines).toEqual(expectedChaseChecking_v1.summary_lines);
  });

  test('preserves the bank-printed sign on Electronic Withdrawals', async () => {
    // The bank prints "-4,001.00"; we must keep the negative.
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const withdrawals = r.statement.summary_lines.find((l) => l.label === 'Electronic Withdrawals');
    expect(withdrawals?.amount_minor).toBe(-400100n);
  });
});

describe('Chase Checking adapter — transactions', () => {
  test('parses exactly 8 transactions (excluding Beginning/Ending Balance marker rows)', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.transactions).toHaveLength(expectedChaseChecking_v1.transactions.length);
  });

  test('does NOT include Beginning Balance or Ending Balance as transactions', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const descs = r.transactions.map((t) => t.description);
    for (const d of descs) {
      expect(d).not.toMatch(/^Beginning\s+Balance$/i);
      expect(d).not.toMatch(/^Ending\s+Balance$/i);
    }
  });

  test('preserves the bank-printed sign on each transaction (no inversion like CC)', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    for (const [i, expected] of expectedChaseChecking_v1.transactions.entries()) {
      expect(r.transactions[i]!.amount_minor).toBe(expected.amount_minor);
    }
  });

  test('classifies "Payment To Chase Card Ending IN NNNN" as payment_to_card', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const payment = r.transactions.find((t) =>
      t.description.includes('Payment To Chase Card Ending')
    );
    expect(payment).toBeDefined();
    expect(payment?.transaction_type).toBe('payment_to_card');
  });

  test('classifies Zelle Payment From as deposit, Zelle Payment To as transfer', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const zelleIn = r.transactions.find((t) => t.description.includes('Zelle Payment From'));
    const zelleOut = r.transactions.find((t) => t.description.includes('Zelle Payment To'));
    expect(zelleIn?.transaction_type).toBe('deposit');
    expect(zelleOut?.transaction_type).toBe('transfer');
  });

  test('classifies Payroll as deposit', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const payroll = r.transactions.find((t) => t.description.includes('Payroll'));
    expect(payroll?.transaction_type).toBe('deposit');
  });

  test('classifies Card Purchase Return as refund', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const refund = r.transactions.find((t) => t.description.includes('Card Purchase Return'));
    expect(refund?.transaction_type).toBe('refund');
  });

  test('joins multi-cell description items (Pennymac across 3 items)', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const pennymac = r.transactions.find((t) => t.description.includes('Pennymac'));
    expect(pennymac?.description).toContain('Pennymac');
    expect(pennymac?.description).toContain('Cash');
    expect(pennymac?.description).toContain('8212879623-0009');
  });

  test('parses sub-$1 amount in ".50" leading-zero-stripped form', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const robinhood = r.transactions.find((t) => t.description.includes('Robinhood'));
    expect(robinhood?.amount_minor).toBe(-50n);
  });

  test('parses comma-thousands amount (3,000.00 payroll)', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const payroll = r.transactions.find((t) => t.description.includes('Payroll'));
    expect(payroll?.amount_minor).toBe(300000n);
  });
});

describe('Chase Checking adapter — cross-bank CC payment classification', () => {
  test('classifies Discover E-Payment NNNN as payment_to_card', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const discover = r.transactions.find((t) => t.description.includes('Discover E-Payment'));
    expect(discover?.transaction_type).toBe('payment_to_card');
  });

  test('classifies Robinhood Card Payment as payment_to_card (no last_4 in descriptor)', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const robinhood = r.transactions.find((t) => t.description.includes('Robinhood'));
    expect(robinhood?.transaction_type).toBe('payment_to_card');
  });
});

describe('Chase Checking adapter — adversarial classifier coverage', () => {
  // descriptionToTxnType is the function the adapter uses internally to tag
  // each row.  We can't import it directly (it's not exported), so these
  // tests use a one-row synthetic statement and inspect the parsed type.
  // Each scenario uses a self-contained fixture so the test is independent.
  function makeItem(text: string, x: number, y: number) {
    return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
  }

  function singleRowFixture(description: string, signedAmount: string) {
    const descItems = description
      .split('  ')
      .map((part, i) => makeItem(part.trim(), 80 + i * 60, 204))
      .filter((it) => it.text.length > 0);
    return {
      total_pages: 1,
      pages: [
        {
          page_number: 1,
          items: [
            makeItem('February 26, 2026 through March 24, 2026', 366, 738),
            makeItem('JPMorgan Chase Bank, N.A.', 59, 731),
            makeItem('Account Number:', 362, 725),
            makeItem('000000533089535', 437, 725),
            makeItem('*start*summary', 35, 516),
            makeItem('Chase College Checking', 204, 504),
            makeItem('CHECKING SUMMARY', 41, 498),
            makeItem('Beginning Balance', 40, 473),
            makeItem('$1,000.00', 331, 473),
            makeItem('Deposits and Additions', 40, 459),
            makeItem(
              signedAmount.startsWith('-') ? '0.00' : signedAmount.replace('$', ''),
              336,
              459
            ),
            makeItem('Electronic Withdrawals', 40, 446),
            makeItem(
              signedAmount.startsWith('-') ? signedAmount.replace('$', '') : '0.00',
              333,
              446
            ),
            makeItem('Ending Balance', 40, 432),
            makeItem('$1,000.00', 331, 432), // approximate; we don't assert this
            makeItem('*end*summary', 35, 419),
            makeItem('*start*transactiondetail', 31, 269),
            makeItem('TRANSACTION DETAIL', 36, 251),
            makeItem('DATE', 38, 233),
            makeItem('DESCRIPTION', 80, 233),
            makeItem('AMOUNT', 432, 233),
            makeItem('BALANCE', 501, 233),
            makeItem('Beginning Balance', 87, 219),
            makeItem('$1,000.00', 494, 219),
            // Single transaction row:
            makeItem('02/27', 36, 204),
            ...descItems,
            makeItem(signedAmount, 432, 204),
            makeItem('1,000.00', 494, 204),
            makeItem('Ending Balance', 85, 95),
            makeItem('$1,000.00', 487, 95),
            makeItem('*end*transaction detail', 31, 66)
          ]
        }
      ]
    };
  }

  test('ATM withdrawal → withdrawal', async () => {
    const pdf = singleRowFixture('ATM WITHDRAWAL 1234567 GEORGETOWN TX', '-100.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('withdrawal');
  });

  test('Overdraft fee → fee', async () => {
    const pdf = singleRowFixture('OVERDRAFT FEE Item Returned', '-34.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('fee');
  });

  test('NSF fee → fee', async () => {
    const pdf = singleRowFixture('NSF FEE Returned Item', '-35.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('fee');
  });

  test('Monthly Service Fee → fee', async () => {
    const pdf = singleRowFixture('MONTHLY SERVICE FEE', '-12.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('fee');
  });

  test('Wire transfer outgoing → transfer', async () => {
    const pdf = singleRowFixture('DOMESTIC WIRE TRANSFER OUTGOING Ref# 12345', '-500.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('transfer');
  });

  test('Interest earned credit → interest', async () => {
    const pdf = singleRowFixture('INTEREST PAYMENT', '0.05');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('interest');
  });

  test('Pennymac mortgage payment → transfer', async () => {
    const pdf = singleRowFixture('Pennymac Cash 8212879623-0009 Web ID', '-2100.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('transfer');
  });

  test('T-Mobile bill payment → transfer', async () => {
    const pdf = singleRowFixture('T-Mobile Pcs Svc 8155683 Web ID 0000450304', '-179.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('transfer');
  });

  test('Affirm BNPL payment → transfer', async () => {
    const pdf = singleRowFixture('Affirm.Com Payme Purchase A St-L4V9M1C8H4Y2', '-29.67');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('transfer');
  });

  test('IRS Treas tax refund → deposit', async () => {
    const pdf = singleRowFixture('Irs Treas 310 Tax Ref PPD ID', '1234.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('deposit');
  });

  test('Volkswagen Credit auto loan → transfer', async () => {
    const pdf = singleRowFixture('Vw Credit, Tel. Web Debit Pwbs', '-368.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('transfer');
  });

  test('Bank of America CC payment → payment_to_card', async () => {
    const pdf = singleRowFixture('Bk of Amer Visa Online Pmt Ckf148086844POS Web ID', '-200.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('payment_to_card');
  });

  test('American Express ACH Pmt → payment_to_card', async () => {
    const pdf = singleRowFixture('American Express ACH Pmt M0560 Web ID', '-35.42');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('payment_to_card');
  });

  test('Unknown vendor → other (not silently classified)', async () => {
    const pdf = singleRowFixture('SOME UNKNOWN VENDOR XYZ', '-50.00');
    const r = await chaseCheckingAdapter.parse(pdf);
    expect(r.transactions[0]?.transaction_type).toBe('other');
  });
});

describe('Chase Checking adapter — checksum gate', () => {
  test('declares Level A + B + D in parser_provides', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.parser_provides).toContain('A');
    expect(r.statement.parser_provides).toContain('B');
    expect(r.statement.parser_provides).toContain('D');
  });

  test('Level A reconciles: Beginning + Σ(transactions) = Ending', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    let sum = 0n;
    for (const t of r.transactions) sum += t.amount_minor;
    expect(r.statement.opening_balance_minor! + sum).toBe(r.statement.closing_balance_minor);
  });

  test('Level B totals equal CHECKING SUMMARY aggregates', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    expect(r.statement.total_debits_minor).toBe(expectedChaseChecking_v1.total_debits_minor);
    expect(r.statement.total_credits_minor).toBe(expectedChaseChecking_v1.total_credits_minor);
  });

  test('runChecksumGate returns ok=true with strategy "B+A+D"', async () => {
    const r = await chaseCheckingAdapter.parse(syntheticChaseChecking_v1);
    const gate = runChecksumGate(r.statement, r.transactions);
    expect(gate.ok, gate.ok ? '' : gate.reason).toBe(true);
    if (gate.ok) expect(gate.strategy_used).toBe('B+A+D');
  });
});
