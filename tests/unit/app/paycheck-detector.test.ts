// Tests for the paycheck + income detector (US-P2-D, increment 1).
//
// Demonstrates the verification framework on real calculation code:
//   - Example tests (the obvious cases)
//   - Property tests (invariants over random input)
//   - Metamorphic tests (relationships that must hold under transformation)
//   - Edge cases (the corners that break naive detectors)

import { describe, test, expect } from 'vitest';
import * as fc from 'fast-check';
import { detectPaychecks, normalizeDescriptor } from '../../../src/lib/app/paycheck-detector';
import type { ImportSuccess } from '../../../src/lib/app/import';
import type {
  AccountType,
  ParsedStatement,
  ParsedTransaction
} from '../../../src/lib/adapters/types';

// ── Fixture builders ─────────────────────────────────────────────────────────

function mkTxn(
  date: string,
  amount: number,
  type: ParsedTransaction['transaction_type'],
  description: string
): ParsedTransaction {
  return {
    posted_date: date,
    description,
    raw_text: description,
    amount_minor: BigInt(Math.round(amount * 100)),
    currency: 'USD',
    transaction_type: type
  };
}

function mkImport(
  account_type: AccountType,
  account_last_4: string,
  txns: ParsedTransaction[],
  pdfHash = `hash-${account_type}-${account_last_4}`
): ImportSuccess {
  const statement: ParsedStatement = {
    account_type,
    account_last_4,
    period_start: '2026-01-01',
    period_end: '2026-03-31',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    previous_balance_minor: null,
    statement_balance_minor: null,
    printed_transaction_count: txns.length,
    summary_lines: [],
    payment_due_date: null,
    statement_date: '2026-03-31',
    minimum_payment_due_minor: null,
    parser_provides: ['A']
  };
  return {
    ok: true,
    adapter_name: 'test',
    adapter_version: '0.0.0',
    bank_name: 'Chase',
    pdf_source_hash: pdfHash,
    statement,
    transactions: txns,
    checksum: { ok: true, strategy_used: 'A', level_results: [] }
  };
}

// Helper: build a biweekly paycheck series starting at a date.
function biweeklyPaychecks(
  start: string,
  count: number,
  amount: number,
  desc: string
): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  const base = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i * 14);
    out.push(mkTxn(d.toISOString().slice(0, 10), amount, 'deposit', desc));
  }
  return out;
}

// ── Example tests — the obvious cases ────────────────────────────────────────

describe('detectPaychecks — basic recognition', () => {
  test('recognizes a biweekly paycheck series', () => {
    const checking = mkImport('checking', '9535', [
      ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME CORP PPD ID: 12345'),
      mkTxn('2026-01-10', -2000, 'withdrawal', 'RENT'),
      mkTxn('2026-01-20', -50, 'purchase', 'GROCERIES')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.paychecks.length).toBe(4);
    expect(result.paychecks.every((p) => p.amount_minor === 320000n)).toBe(true);
    expect(result.detected_cadence_days).toBeGreaterThanOrEqual(12);
    expect(result.detected_cadence_days).toBeLessThanOrEqual(16);
  });

  test('a single deposit is NOT a paycheck (need recurrence)', () => {
    const checking = mkImport('checking', '9535', [
      mkTxn('2026-01-02', 3200, 'deposit', 'PAYROLL ACME CORP')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.paychecks.length).toBe(0);
    expect(result.other_income.length).toBe(1);
  });

  test('confidence is "high" for 3+ tight biweekly deposits', () => {
    const checking = mkImport(
      'checking',
      '9535',
      biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME')
    );
    const result = detectPaychecks([checking]);
    expect(result.paychecks.every((p) => p.confidence === 'high')).toBe(true);
  });

  test('confidence is "medium" for exactly 2 biweekly deposits', () => {
    const checking = mkImport(
      'checking',
      '9535',
      biweeklyPaychecks('2026-01-02', 2, 3200, 'PAYROLL ACME')
    );
    const result = detectPaychecks([checking]);
    expect(result.paychecks.length).toBe(2);
    expect(result.paychecks.every((p) => p.confidence === 'medium')).toBe(true);
  });
});

// ── Other income — NOT auto-classified by amount ─────────────────────────────
//
// The detector deliberately does NOT guess "bonus" vs "gift" vs "refund".
// Amount is not a reliable signal: a bonus can be $50 or $5000, a friend's
// gift or an IRS refund can be any size.  Every non-paycheck deposit becomes
// "other income" with user_label = null; the USER labels what it actually is.

describe('detectPaychecks — other income (no amount-based guessing)', () => {
  test('a LARGE irregular deposit is other income with no auto-label', () => {
    const checking = mkImport('checking', '9535', [
      ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME CORP'),
      mkTxn('2026-02-10', 8000, 'deposit', 'ACME CORP ANNUAL BONUS')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.paychecks.length).toBe(4);
    expect(result.other_income.length).toBe(1);
    // NOT auto-classified — user_label is null until the user sets it.
    expect(result.other_income[0]!.user_label).toBeNull();
  });

  test('a SMALL irregular deposit is also other income with no auto-label', () => {
    const checking = mkImport('checking', '9535', [
      ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME CORP'),
      mkTxn('2026-02-10', 50, 'deposit', 'ZELLE FROM FRIEND')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.other_income.length).toBe(1);
    expect(result.other_income[0]!.user_label).toBeNull();
  });

  test('an IRS-refund-sized deposit between paycheck and 1.5x is still just other income', () => {
    // $4000 IRS refund — would have been MISSED by the old >1.5x ($4800) rule.
    // Now it's correctly "other income" like everything else non-recurring.
    const checking = mkImport('checking', '9535', [
      ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME CORP'),
      mkTxn('2026-02-10', 4000, 'deposit', 'IRS TREAS 310 TAX REF')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.other_income.length).toBe(1);
    expect(result.other_income[0]!.user_label).toBeNull();
    expect(result.other_income[0]!.description).toContain('IRS');
  });

  test('every non-paycheck deposit, any size, lands in other_income', () => {
    const checking = mkImport('checking', '9535', [
      ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME CORP'),
      mkTxn('2026-01-20', 25, 'deposit', 'INTEREST PAYMENT'),
      mkTxn('2026-02-05', 500, 'deposit', 'BIRTHDAY GIFT GRANDMA'),
      mkTxn('2026-02-18', 9000, 'deposit', 'YEAR END BONUS'),
      mkTxn('2026-03-01', 120, 'deposit', 'VENMO SPLIT DINNER')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.paychecks.length).toBe(4);
    expect(result.other_income.length).toBe(4);
    expect(result.other_income.every((i) => i.user_label === null)).toBe(true);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('detectPaychecks — edge cases', () => {
  test('no deposits at all → empty result', () => {
    const checking = mkImport('checking', '9535', [
      mkTxn('2026-01-10', -2000, 'withdrawal', 'RENT')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.paychecks).toEqual([]);
    expect(result.other_income).toEqual([]);
    expect(result.detected_cadence_days).toBeNull();
  });

  test('credit-card "deposits" (payments/refunds) are NOT scanned for paychecks', () => {
    const cc = mkImport(
      'credit_card',
      '1797',
      biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYMENT THANK YOU')
    );
    const result = detectPaychecks([cc]);
    expect(result.paychecks.length).toBe(0);
    expect(result.other_income.length).toBe(0);
  });

  test('monthly deposits (≈30 days apart) are NOT classified as biweekly paychecks', () => {
    const checking = mkImport('checking', '9535', [
      mkTxn('2026-01-01', 3200, 'deposit', 'MONTHLY PAYROLL'),
      mkTxn('2026-02-01', 3200, 'deposit', 'MONTHLY PAYROLL'),
      mkTxn('2026-03-01', 3200, 'deposit', 'MONTHLY PAYROLL')
    ]);
    const result = detectPaychecks([checking]);
    // 30-day spacing is outside our biweekly/semi-monthly window → not paychecks.
    expect(result.paychecks.length).toBe(0);
  });

  test('two different payroll streams are detected independently', () => {
    const checking = mkImport('checking', '9535', [
      ...biweeklyPaychecks('2026-01-02', 3, 3200, 'PAYROLL ACME CORP'),
      ...biweeklyPaychecks('2026-01-09', 3, 1500, 'PAYROLL SIDE GIG LLC')
    ]);
    const result = detectPaychecks([checking]);
    expect(result.paychecks.length).toBe(6);
    const streams = new Set(result.paychecks.map((p) => p.stream_key));
    expect(streams.size).toBe(2);
  });

  test('deposits across two checking statements (Mar + Apr) merge into one stream', () => {
    const mar = mkImport(
      'checking',
      '9535',
      biweeklyPaychecks('2026-03-06', 2, 3200, 'PAYROLL ACME'),
      'h-mar'
    );
    const apr = mkImport(
      'checking',
      '9535',
      biweeklyPaychecks('2026-04-03', 2, 3200, 'PAYROLL ACME'),
      'h-apr'
    );
    const result = detectPaychecks([mar, apr]);
    // 4 paychecks 14 days apart across the statement boundary.
    expect(result.paychecks.length).toBe(4);
  });
});

// ── normalizeDescriptor ──────────────────────────────────────────────────────

describe('normalizeDescriptor', () => {
  test('strips IDs and digits so dated payroll descriptors group together', () => {
    const a = normalizeDescriptor('PAYROLL ACME CORP PPD ID: 12345 04/25');
    const b = normalizeDescriptor('PAYROLL ACME CORP PPD ID: 67890 05/09');
    expect(a).toBe(b);
  });

  test('different employers do NOT collapse together', () => {
    expect(normalizeDescriptor('PAYROLL ACME CORP')).not.toBe(
      normalizeDescriptor('PAYROLL GLOBEX INC')
    );
  });
});

// ── Property tests — invariants over random input ────────────────────────────

describe('detectPaychecks — property invariants', () => {
  // Arbitrary: a checking statement with random deposits + spends.
  const depositArb = fc.record({
    day: fc.integer({ min: 1, max: 180 }),
    amount: fc.integer({ min: 1, max: 10000 }),
    desc: fc.constantFrom('PAYROLL ACME', 'ZELLE FRIEND', 'REFUND', 'INTEREST', 'TAX RETURN')
  });

  function buildFromDeposits(
    deps: Array<{ day: number; amount: number; desc: string }>
  ): ImportSuccess {
    const base = new Date(Date.UTC(2026, 0, 1));
    const txns = deps.map((d) => {
      const date = new Date(base);
      date.setUTCDate(date.getUTCDate() + d.day);
      return mkTxn(date.toISOString().slice(0, 10), d.amount, 'deposit', d.desc);
    });
    return mkImport('checking', '9535', txns);
  }

  test('I1: every paycheck and every income event is a deposit that existed in the input', () => {
    fc.assert(
      fc.property(fc.array(depositArb, { maxLength: 30 }), (deps) => {
        const imp = buildFromDeposits(deps);
        const result = detectPaychecks([imp]);
        const all = [...result.paychecks, ...result.other_income];
        // Count of classified deposits must equal count of input deposits.
        expect(all.length).toBe(deps.length);
        // Every classified amount is positive (a deposit).
        expect(all.every((x) => x.amount_minor > 0n)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  test('I2: a deposit is NEVER both a paycheck and other-income (partition)', () => {
    fc.assert(
      fc.property(fc.array(depositArb, { maxLength: 30 }), (deps) => {
        const imp = buildFromDeposits(deps);
        const result = detectPaychecks([imp]);
        const paycheckKeys = new Set(
          result.paychecks.map((p) => `${p.import_index}:${p.transaction_index}`)
        );
        const incomeKeys = new Set(
          result.other_income.map((i) => `${i.import_index}:${i.transaction_index}`)
        );
        for (const k of paycheckKeys) expect(incomeKeys.has(k)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('I3: outputs are sorted chronologically', () => {
    fc.assert(
      fc.property(fc.array(depositArb, { maxLength: 30 }), (deps) => {
        const result = detectPaychecks([buildFromDeposits(deps)]);
        for (let i = 1; i < result.paychecks.length; i++) {
          expect(result.paychecks[i]!.posted_date >= result.paychecks[i - 1]!.posted_date).toBe(
            true
          );
        }
        for (let i = 1; i < result.other_income.length; i++) {
          expect(
            result.other_income[i]!.posted_date >= result.other_income[i - 1]!.posted_date
          ).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ── Metamorphic tests ────────────────────────────────────────────────────────

describe('detectPaychecks — metamorphic relations', () => {
  test('M1: scaling every amount by k does not change WHICH deposits are paychecks', () => {
    // Cadence detection is amount-independent; scaling amounts must not move a
    // deposit between the paycheck and income buckets.
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), (k) => {
        const baseTxns = [
          ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME'),
          mkTxn('2026-02-10', 50, 'deposit', 'ZELLE')
        ];
        const scaledTxns = baseTxns.map((t) => ({
          ...t,
          amount_minor: t.amount_minor * BigInt(k)
        }));

        const base = detectPaychecks([mkImport('checking', '9535', baseTxns, 'h-base')]);
        const scaled = detectPaychecks([mkImport('checking', '9535', scaledTxns, 'h-scaled')]);

        expect(scaled.paychecks.length).toBe(base.paychecks.length);
        expect(scaled.other_income.length).toBe(base.other_income.length);
        // The set of paycheck positions must be identical.
        expect(scaled.paychecks.map((p) => p.transaction_index).sort()).toEqual(
          base.paychecks.map((p) => p.transaction_index).sort()
        );
      }),
      { numRuns: 50 }
    );
  });

  test('M2: shifting every date by a constant offset does not change classification', () => {
    // A paycheck stream is defined by RELATIVE spacing, not absolute dates.
    // Shifting the whole calendar must not change which deposits are paychecks.
    const baseTxns = [
      ...biweeklyPaychecks('2026-01-02', 4, 3200, 'PAYROLL ACME'),
      mkTxn('2026-02-10', 8000, 'deposit', 'BONUS')
    ];
    function shiftDays(txns: ParsedTransaction[], offset: number): ParsedTransaction[] {
      return txns.map((t) => {
        const d = new Date(t.posted_date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + offset);
        return { ...t, posted_date: d.toISOString().slice(0, 10) };
      });
    }
    const base = detectPaychecks([mkImport('checking', '9535', baseTxns, 'h0')]);
    const shifted = detectPaychecks([mkImport('checking', '9535', shiftDays(baseTxns, 37), 'h1')]);

    expect(shifted.paychecks.length).toBe(base.paychecks.length);
    expect(shifted.other_income.length).toBe(base.other_income.length);
    expect(shifted.other_income[0]?.user_label).toBe(base.other_income[0]?.user_label);
  });
});
