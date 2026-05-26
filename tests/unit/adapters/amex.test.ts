// Amex Blue Cash Everyday adapter — fixture-driven tests covering every
// observed format + adversarial edges per the thoroughness mandate.

import { describe, expect, test } from 'vitest';
import { amexAdapter } from '../../../src/lib/adapters/amex/adapter';
import { chaseCreditCardAdapter } from '../../../src/lib/adapters/chase-credit-card/adapter';
import { chaseCheckingAdapter } from '../../../src/lib/adapters/chase-checking/adapter';
import { syntheticAmex_v1, expectedAmex_v1 } from '../../fixtures/amex/synthetic-v1';
import { runChecksumGate } from '../../../src/lib/app/checksum';

describe('Amex adapter — detection', () => {
  test('detects a Blue Cash Everyday statement', () => {
    const sample = syntheticAmex_v1.pages[0]!.items.map((i) => i.text)
      .join(' ')
      .slice(0, 4096);
    expect(amexAdapter.detect(sample)).toBe(true);
  });

  test('does NOT mis-detect on Chase CC or Chase Checking text', () => {
    expect(amexAdapter.detect('Chase Card Services www.chase.com/cardhelp')).toBe(false);
    expect(amexAdapter.detect('JPMorgan Chase Bank, N.A. CHECKING SUMMARY')).toBe(false);
  });

  test('cross-adapter: Amex sample does NOT match Chase adapters', () => {
    const sample = syntheticAmex_v1.pages[0]!.items.map((i) => i.text).join(' ');
    expect(chaseCreditCardAdapter.detect(sample)).toBe(false);
    expect(chaseCheckingAdapter.detect(sample)).toBe(false);
  });
});

describe('Amex adapter — statement-level fields', () => {
  test('extracts account_last_4 from "Account Ending 2-03004"', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.account_last_4).toBe(expectedAmex_v1.account_last_4);
  });

  test('derives period from Closing Date + Days in Billing Period', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.period_end).toBe(expectedAmex_v1.period_end);
    expect(r.statement.period_start).toBe(expectedAmex_v1.period_start);
  });

  test('extracts payment_due_date', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.payment_due_date).toBe(expectedAmex_v1.payment_due_date);
  });

  test('extracts minimum_payment_due_minor', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.minimum_payment_due_minor).toBe(expectedAmex_v1.minimum_payment_due_minor);
  });

  test('classifies account_type as credit_card', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.account_type).toBe('credit_card');
  });

  test('bank_name is "American Express"', async () => {
    expect(amexAdapter.bank_name).toBe('American Express');
  });
});

describe('Amex adapter — Account Summary', () => {
  test('extracts previous_balance and new_balance', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.previous_balance_minor).toBe(expectedAmex_v1.previous_balance_minor);
    expect(r.statement.statement_balance_minor).toBe(expectedAmex_v1.new_balance_minor);
  });

  test('summary_lines includes all 8 fields in order', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const labels = r.statement.summary_lines.map((l) => l.label);
    expect(labels).toEqual([
      'Previous Balance',
      'Less Payments/Credits',
      'Plus New Charges',
      'Plus Fees',
      'Plus Interest Charged',
      'Equals New Balance',
      'Credit Limit',
      'Available Credit'
    ]);
  });

  test('"Less Payments/Credits" line is stored as negative (subtractive direction)', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const less = r.statement.summary_lines.find((l) => l.label === 'Less Payments/Credits');
    expect(less?.amount_minor).toBe(-27550n);
  });

  test('Account Summary equation reconciles: prev - payments + charges + fees + interest = new', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const prev = r.statement.previous_balance_minor!;
    const newBal = r.statement.statement_balance_minor!;
    // Recompute from summary_lines.
    const findLine = (label: string) =>
      r.statement.summary_lines.find((l) => l.label === label)?.amount_minor ?? 0n;
    const computed =
      prev +
      findLine('Less Payments/Credits') + // negative
      findLine('Plus New Charges') +
      findLine('Plus Fees') +
      findLine('Plus Interest Charged');
    expect(computed).toBe(newBal);
  });
});

describe('Amex adapter — transactions', () => {
  test('parses 7 transactions (2 payments/credits + 3 charges + 1 fee + 1 interest)', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.transactions).toHaveLength(expectedAmex_v1.transaction_count);
  });

  test('every transaction has the expected posted_date, type, amount, and description', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    for (const [i, expected] of expectedAmex_v1.transactions.entries()) {
      const actual = r.transactions[i]!;
      expect(actual.posted_date, `txn ${i} posted_date`).toBe(expected.posted_date);
      expect(actual.transaction_type, `txn ${i} type`).toBe(expected.transaction_type);
      expect(actual.amount_minor, `txn ${i} amount`).toBe(expected.amount_minor);
      expect(actual.description, `txn ${i} description`).toContain(expected.descriptionContains);
    }
  });

  test('multi-row continuation merges merchant phone into the previous description', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const openai = r.transactions.find((t) => t.description.includes('OPENAI'));
    expect(openai?.description).toContain('800-555-0100');
  });

  test('sub-$1 amount ".50" (after $ prefix stripped) parses to 50n outflow', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const youtube = r.transactions.find((t) => t.description.includes('YOUTUBE'));
    expect(youtube?.amount_minor).toBe(-50n);
  });

  test('comma-thousands amount $1,000.00 parses correctly', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const delta = r.transactions.find((t) => t.description.includes('DELTA'));
    expect(delta?.amount_minor).toBe(-100000n);
  });

  test('refund row in payments section classified as refund, NOT payment_to_card', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const refund = r.transactions.find((t) => t.description.includes('MERCHANT CREDIT'));
    expect(refund?.transaction_type).toBe('refund');
  });

  test('ANNUAL MEMBERSHIP FEE classified as fee, not purchase', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const fee = r.transactions.find((t) => t.description.includes('ANNUAL MEMBERSHIP'));
    expect(fee?.transaction_type).toBe('fee');
    expect(fee?.amount_minor).toBe(-3500n);
  });

  test('INTEREST CHARGE classified as interest', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const interest = r.transactions.find((t) => t.description.includes('INTEREST CHARGE'));
    expect(interest?.transaction_type).toBe('interest');
  });

  test('sign convention: payments printed -$X → stored positive; charges printed $X → stored negative', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const payment = r.transactions.find((t) => t.description.includes('MOBILE PAYMENT'));
    expect(payment?.amount_minor).toBeGreaterThan(0n);
    const charge = r.transactions.find((t) => t.description.includes('DELTA'));
    expect(charge?.amount_minor).toBeLessThan(0n);
  });
});

describe('Amex adapter — checksum gate', () => {
  test('declares B + C + D in parser_provides', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.parser_provides).toContain('B');
    expect(r.statement.parser_provides).toContain('C');
    expect(r.statement.parser_provides).toContain('D');
  });

  test('Level B totals match printed Account Summary aggregates', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    expect(r.statement.total_debits_minor).toBe(expectedAmex_v1.total_debits_minor);
    expect(r.statement.total_credits_minor).toBe(expectedAmex_v1.total_credits_minor);
  });

  test('Level B: sum of transactions matches printed totals (sign convention works)', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    let debits = 0n;
    let credits = 0n;
    for (const t of r.transactions) {
      if (t.amount_minor < 0n) debits += -t.amount_minor;
      else credits += t.amount_minor;
    }
    expect(debits).toBe(r.statement.total_debits_minor);
    expect(credits).toBe(r.statement.total_credits_minor);
  });

  test('Level C: previous_balance + debits - credits = new_balance', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const prev = r.statement.previous_balance_minor!;
    const newBal = r.statement.statement_balance_minor!;
    expect(prev + r.statement.total_debits_minor! - r.statement.total_credits_minor!).toBe(newBal);
  });

  test('runChecksumGate returns ok=true with strategy B+C+D', async () => {
    const r = await amexAdapter.parse(syntheticAmex_v1);
    const gate = runChecksumGate(r.statement, r.transactions);
    expect(gate.ok, gate.ok ? '' : gate.reason).toBe(true);
    if (gate.ok) expect(gate.strategy_used).toBe('B+C+D');
  });
});
