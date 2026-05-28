/**
 * Tests for cleanDescription against REAL examples from the user's temp3
 * Chase / BofA / Robinhood / Amex statements.  These are LOCKED — failing them
 * means a downstream regression (Recurring / Spending Trends will start showing
 * ACH metadata again).
 */
import { describe, expect, test } from 'vitest';
import { cleanDescription, descriptorKey } from '../../../src/lib/util/description-clean';

describe('cleanDescription — real-world ACH metadata', () => {
  test('strips trailing Web ID: NNNNN', () => {
    expect(cleanDescription('Discover E-Payment 3562 Web ID: 2510020270')).toBe(
      'Discover E-Payment 3562'
    );
    expect(cleanDescription('American Express ACH Pmt M0442 Web ID: 2005032111')).toBe(
      'American Express ACH Pmt M0442'
    );
    expect(cleanDescription('Vw Credit, Tel. Web Debit Pwbs8157638769 Web ID: 1382362409')).toBe(
      'Vw Credit, Tel. Web Debit'
    );
  });

  test('strips trailing PPD ID: NNNNN', () => {
    expect(cleanDescription('Altera Corporati Payroll PPD ID: 9111111101')).toBe(
      'Altera Corporati Payroll'
    );
    expect(cleanDescription('Robinhood Card Payment PPD ID: 6823032815')).toBe(
      'Robinhood Card Payment'
    );
    expect(cleanDescription('Fidelity 15105 P Fprs PPD ID: 9075693322')).toBe(
      'Fidelity 15105 P Fprs'
    );
  });

  test('strips leading MM/DD prefix from cross-account descriptions', () => {
    expect(cleanDescription('04/04 Payment To Chase Card Ending IN 1797')).toBe(
      'Payment To Chase Card Ending IN 1797'
    );
    expect(cleanDescription('05/18 Payment To Chase Card Ending IN 7137')).toBe(
      'Payment To Chase Card Ending IN 7137'
    );
    expect(cleanDescription('05/10 Online Realtime Payment To Robinhood Securities')).toBe(
      'Online Realtime Payment To Robinhood Securities'
    );
  });

  test('strips trailing reference-number tails (Capture / online-banking)', () => {
    expect(cleanDescription('Western Union Capture 614087502863146')).toBe('Western Union Capture');
    expect(cleanDescription('Bk of Amer Visa Online Pmt Ckf148086844POS')).toBe(
      'Bk of Amer Visa Online Pmt'
    );
    expect(cleanDescription('Venmo Payment 1050187677259')).toBe('Venmo Payment');
  });

  test('strips combined MM/DD + Transaction# + Reference#', () => {
    expect(
      cleanDescription(
        '05/10 Online Realtime Payment To Robinhood Securities Transaction#: 1058571 Reference#: 7010585715Rx'
      )
    ).toBe('Online Realtime Payment To Robinhood Securities');
  });

  test('preserves merchant name + city/state', () => {
    expect(cleanDescription('COSTCO WHSE #1385 GEORGETOWN TX')).toBe(
      'COSTCO WHSE #1385 GEORGETOWN TX'
    );
    expect(cleanDescription('H-E-B #781 GEORGETOWN TX')).toBe('H-E-B #781 GEORGETOWN TX');
    expect(cleanDescription('STARBUCKS STORE 23478 AUSTIN TX')).toBe(
      'STARBUCKS STORE 23478 AUSTIN TX'
    );
    expect(cleanDescription('TST* NEW SITARA INDIAN RE AUSTIN TX')).toBe(
      'TST* NEW SITARA INDIAN RE AUSTIN TX'
    );
  });

  test('idempotent — cleanDescription(cleanDescription(x)) === cleanDescription(x)', () => {
    const samples = [
      'Discover E-Payment 3562 Web ID: 2510020270',
      'COSTCO WHSE #1385 GEORGETOWN TX',
      '04/04 Payment To Chase Card Ending IN 1797',
      '   spaces all over the place  ',
      'short'
    ];
    for (const s of samples) {
      const once = cleanDescription(s);
      expect(cleanDescription(once)).toBe(once);
    }
  });

  test('collapses internal whitespace + trims edges', () => {
    expect(cleanDescription('   COSTCO   WHSE   #1385   ')).toBe('COSTCO WHSE #1385');
    expect(cleanDescription('A\t\tB')).toBe('A B');
  });

  test('empty / non-string inputs return empty string', () => {
    expect(cleanDescription('')).toBe('');
    expect(cleanDescription(' ')).toBe('');
    // @ts-expect-error — testing non-string guard
    expect(cleanDescription(null)).toBe('');
    // @ts-expect-error — testing non-string guard
    expect(cleanDescription(undefined)).toBe('');
  });
});

describe('descriptorKey — case + whitespace normalization', () => {
  test('groups same merchant despite case + reference noise', () => {
    expect(descriptorKey('Western Union Capture 614087502863146')).toBe('WESTERN UNION CAPTURE');
    expect(descriptorKey('western union capture 612585603025515')).toBe('WESTERN UNION CAPTURE');
    expect(descriptorKey('Robinhood Card Payment PPD ID: 6823032815')).toBe(
      'ROBINHOOD CARD PAYMENT'
    );
  });
});
