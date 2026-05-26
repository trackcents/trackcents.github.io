// Bug: Robinhood detect() returned true for the substring "Robinhood Card
//      Payment" appearing in a Chase Checking transaction descriptor.  That
//      would false-positive any Chase Checking statement containing a
//      Robinhood payment row.
//
// Discovered: 2026-05-23 (during cross-check on synthetic fixture work)
// Reported by: synthetic fixture in tests/unit/adapters/robinhood-credit-card.test.ts
//      ("does NOT false-positive on a non-Robinhood statement…")
//
// Root cause: const DETECT_BRAND = /\bRobinhood\s+(?:Credit|Card)\b/i —
//      the regex matched the bare brand string in isolation.
//
// Fix: brand match now requires AT LEAST ONE Robinhood-specific marker
//      (operator-prefixed labels, address fingerprint, etc.) alongside.
//      See src/lib/adapters/robinhood-credit-card/adapter.ts detect().
//
// This regression test pins the false-positive scenario.

import { describe, test, expect } from 'vitest';
import { robinhoodCreditCardAdapter } from '../../../src/lib/adapters/robinhood-credit-card/adapter';

describe('regression bug-2026-05-23: Robinhood detect() must NOT match bare brand strings', () => {
  test('"Robinhood Card Payment" descriptor on a non-Robinhood statement does NOT detect Robinhood', () => {
    expect(
      robinhoodCreditCardAdapter.detect(
        'Chase Checking statement: 03/15 Robinhood Card Payment PPD ID: 6823032815'
      )
    ).toBe(false);
  });

  test('"Robinhood Credit" without any operator-label or address marker does NOT detect Robinhood', () => {
    expect(robinhoodCreditCardAdapter.detect('Robinhood Credit')).toBe(false);
    expect(robinhoodCreditCardAdapter.detect('Robinhood Card')).toBe(false);
  });

  test('the brand string DOES match when paired with an operator-prefixed label (real statement signal)', () => {
    expect(
      robinhoodCreditCardAdapter.detect(
        'Robinhood Credit Member FDIC = New Balance Days in Billing Cycle'
      )
    ).toBe(true);
  });
});
