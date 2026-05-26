// detectCardPayment — adversarial coverage of every observed bank descriptor
// for outgoing CC payments, across every major US card issuer.
//
// Test categories:
//   1. Each issuer's observed descriptor(s) recognized.
//   2. Last-4 extraction works for Chase + Discover (issuers that carry it).
//   3. Last-4 is null for issuers whose descriptor doesn't carry it.
//   4. Casing variations don't break detection.
//   5. Descriptors that LOOK similar but aren't CC payments → null.
//   6. bankNameMatchesIssuer correctness.

import { describe, expect, test } from 'vitest';
import { bankNameMatchesIssuer, detectCardPayment } from '../../../src/lib/util/card-payment';

describe('detectCardPayment — Chase', () => {
  test('recognizes "Payment To Chase Card Ending IN 1797" with last_4=1797', () => {
    expect(detectCardPayment('02/27 Payment To Chase Card Ending IN 1797')).toEqual({
      issuer: 'Chase',
      card_last_4: '1797'
    });
  });

  test('recognizes 3-digit last 4 and pads to 4', () => {
    // Edge case: some descriptors print just 3 trailing digits.
    expect(detectCardPayment('Payment To Chase Card Ending IN 562')?.card_last_4).toBe('0562');
  });

  test('case insensitive', () => {
    expect(detectCardPayment('payment to chase card ending in 7137')?.issuer).toBe('Chase');
  });
});

describe('detectCardPayment — Discover', () => {
  test('recognizes "Discover E-Payment 3562 Web ID: ..." with last_4=3562', () => {
    expect(detectCardPayment('Discover E-Payment 3562 Web ID: PHONE REDACTED')).toEqual({
      issuer: 'Discover',
      card_last_4: '3562'
    });
  });

  test('handles "Discover EPayment" (no hyphen)', () => {
    expect(detectCardPayment('Discover EPayment 3562')?.issuer).toBe('Discover');
  });
});

describe('detectCardPayment — Bank of America', () => {
  test('recognizes "Bk of Amer Visa Online Pmt Ckf148086844POS"', () => {
    expect(detectCardPayment('Bk of Amer Visa Online Pmt Ckf148086844POS Web ID:')).toEqual({
      issuer: 'BofA',
      card_last_4: null
    });
  });

  test('recognizes "Bank of America Payment 11Nqzhkyl"', () => {
    expect(detectCardPayment('Bank of America Payment 11Nqzhkyl Web ID:')).toEqual({
      issuer: 'BofA',
      card_last_4: null
    });
  });

  test('recognizes "BANK OF AMERICA CC PMT"', () => {
    expect(detectCardPayment('BANK OF AMERICA CC PMT')?.issuer).toBe('BofA');
  });

  test('recognizes "BOA CARD PMT" shorthand', () => {
    expect(detectCardPayment('BOA CARD PMT')?.issuer).toBe('BofA');
  });
});

describe('detectCardPayment — American Express', () => {
  test('recognizes "American Express ACH Pmt M0560 Web ID:"', () => {
    expect(detectCardPayment('American Express ACH Pmt M0560 Web ID:')).toEqual({
      issuer: 'Amex',
      card_last_4: null // M-code is NOT the card last 4
    });
  });

  test('recognizes "American Express EPAYMENT"', () => {
    expect(detectCardPayment('American Express EPAYMENT')?.issuer).toBe('Amex');
  });

  test('recognizes "AMEX EPAYMENT ACH PMT"', () => {
    expect(detectCardPayment('AMEX EPAYMENT ACH PMT WEB ID:')?.issuer).toBe('Amex');
  });
});

describe('detectCardPayment — Robinhood', () => {
  test('recognizes "Robinhood Card Payment PPD ID:"', () => {
    expect(detectCardPayment('Robinhood Card Payment PPD ID: PHONE REDACTED')).toEqual({
      issuer: 'Robinhood',
      card_last_4: null
    });
  });

  test('recognizes "Robinhood CRD PMT" shorthand', () => {
    expect(detectCardPayment('Robinhood CRD PMT')?.issuer).toBe('Robinhood');
  });
});

describe('detectCardPayment — Capital One / Citi / Wells / Apple', () => {
  test('Capital One Mobile Pmt', () => {
    expect(detectCardPayment('CAPITAL ONE MOBILE PMT Web ID:')?.issuer).toBe('CapitalOne');
  });

  test('Capital One AUTOPAY', () => {
    expect(detectCardPayment('CAPITAL ONE AUTOPAY')?.issuer).toBe('CapitalOne');
  });

  test('Citi AUTOPAY', () => {
    expect(detectCardPayment('CITI AUTOPAY')?.issuer).toBe('Citi');
  });

  test('Citibank Online', () => {
    expect(detectCardPayment('CITIBANK ONLINE Web ID:')?.issuer).toBe('Citi');
  });

  test('Wells Fargo CREDIT CARD PMT', () => {
    expect(detectCardPayment('WF CREDIT CARD PMT')?.issuer).toBe('WellsFargo');
  });

  test('Apple Card via GS Bank USA', () => {
    expect(detectCardPayment('GS BANK USA PMT')?.issuer).toBe('Apple');
  });

  test('Synchrony Bank', () => {
    expect(detectCardPayment('SYNCHRONY BANK PAYMENT')?.issuer).toBe('Synchrony');
  });

  test('Barclays Card', () => {
    expect(detectCardPayment('BARCLAYS CARD PAYMENT')?.issuer).toBe('Barclays');
  });
});

describe('detectCardPayment — false positives MUST be rejected', () => {
  test('Zelle Payment to a person is NOT a card payment', () => {
    expect(detectCardPayment('Zelle Payment To Vasthav Jpm99Cask0O2')).toBeNull();
  });

  test('Zelle Payment From a person is NOT a card payment', () => {
    expect(detectCardPayment('Zelle Payment From Srikanth Bacquqncxzdt')).toBeNull();
  });

  test('Payroll deposit is NOT a card payment', () => {
    expect(detectCardPayment('Altera Corporati Payroll PPD ID:')).toBeNull();
  });

  test('Pennymac (mortgage) is NOT a card payment', () => {
    expect(detectCardPayment('Pennymac Cash 8212879623-0009')).toBeNull();
  });

  test('Affirm.Com (BNPL) is NOT a card payment by our definition', () => {
    // Affirm is buy-now-pay-later, not a traditional CC.  Treat as transfer
    // unless / until we add an Affirm adapter.
    expect(detectCardPayment('Affirm.Com Payme Purchase A St-')).toBeNull();
  });

  test('IRS Treas refund is NOT a card payment', () => {
    expect(detectCardPayment('Irs Treas 310 Tax Ref')).toBeNull();
  });

  test('Volkswagen Credit (auto loan) is NOT a card payment', () => {
    expect(detectCardPayment('Vw Credit, Tel. Web Debit Pwbs')).toBeNull();
  });

  test('T-Mobile bill payment is NOT a card payment', () => {
    expect(detectCardPayment('T-Mobile Pcs Svc 8155683')).toBeNull();
  });

  test('Western Union transfer is NOT a card payment', () => {
    expect(detectCardPayment('Western Union Capture 606686959116811')).toBeNull();
  });

  test('Kitsap CU transfer is NOT a card payment', () => {
    expect(detectCardPayment('Kitsap CU Transfer 630515')).toBeNull();
  });
});

describe('bankNameMatchesIssuer', () => {
  test('exact match', () => {
    expect(bankNameMatchesIssuer('Chase', 'Chase')).toBe(true);
    expect(bankNameMatchesIssuer('American Express', 'Amex')).toBe(true);
    expect(bankNameMatchesIssuer('Bank of America', 'BofA')).toBe(true);
  });

  test('alias match (Chase = JPMorgan Chase)', () => {
    expect(bankNameMatchesIssuer('JPMorgan Chase', 'Chase')).toBe(true);
  });

  test('case insensitive', () => {
    expect(bankNameMatchesIssuer('AMERICAN EXPRESS', 'Amex')).toBe(true);
    expect(bankNameMatchesIssuer('discover', 'Discover')).toBe(true);
  });

  // IV&V D25: matching is now EXACT (case-insensitive) against the alias list,
  // not a loose substring. Every real CC adapter sets bank_name to a canonical
  // alias ('Robinhood', 'Bank of America', 'Chase', 'Discover', 'American
  // Express'), so exact match covers production and produces ZERO false
  // positives. A suffixed/legal-entity form that NO adapter emits (e.g.
  // "Robinhood Credit, Inc.") deliberately does NOT match — it fails CLOSED
  // (a missing link, which is safe & fixable by adding the exact string to the
  // alias table) rather than risk a wrong link.
  test('exact alias match for real adapter bank_names', () => {
    expect(bankNameMatchesIssuer('Robinhood', 'Robinhood')).toBe(true);
    expect(bankNameMatchesIssuer('Bank of America', 'BofA')).toBe(true);
    expect(bankNameMatchesIssuer('Citibank', 'Citi')).toBe(true);
  });

  test('no substring false-positive on unrelated banks (D25)', () => {
    // The bug this fixed: short aliases must NOT match a bank that merely
    // contains them as a substring or unrelated whole word.
    expect(bankNameMatchesIssuer('Citizens Bank', 'Citi')).toBe(false);
    expect(bankNameMatchesIssuer('Pineapple Credit Union', 'Apple')).toBe(false);
    expect(bankNameMatchesIssuer('Robinhood Credit, Inc.', 'Robinhood')).toBe(false);
  });

  test('wrong issuer → false', () => {
    expect(bankNameMatchesIssuer('Chase', 'Amex')).toBe(false);
    expect(bankNameMatchesIssuer('Discover', 'BofA')).toBe(false);
  });
});
