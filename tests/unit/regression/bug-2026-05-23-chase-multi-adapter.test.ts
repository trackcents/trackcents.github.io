// Bug: Chase Checking PDF rejected as "ambiguous detection" after we added
//      the BofA and Discover adapters.
//
// Discovered: 2026-05-23
// Reported by: user uploading 20260423-statements-9535-.pdf
//
// Root cause: detect() in bofa-credit-card and discover-credit-card matched
//      transaction-descriptor text inside a CHASE CHECKING statement.  Chase
//      Checking shows descriptors like "Bk of Amer Visa Online Pmt" and
//      "Chase Card Ending IN 1797" — strings the new adapters' regexes
//      consumed as evidence of "this is a BofA/Discover statement."  Three
//      adapters matched the same file; detectAdapter() threw.
//
// Fix:
//   - bofa-credit-card detect() requires bankofamerica.com URL OR
//     (Visa Signature/Platinum brand + hyphenated account number)
//   - discover-credit-card detect() requires DISCOVER IT, Discover.com URL,
//     or "Cashback Bonus" — none of which appear in other banks' descriptors.
//   - Added cross-adapter-exclusivity test as the structural guard.
//
// This regression test PROVES the structural guard catches the bug.
// If anyone re-introduces the lax detect, this test fails.

import { describe, test, expect } from 'vitest';
import { detectAdapter } from '../../../src/lib/adapters';

describe('regression bug-2026-05-23: Chase Checking with BofA + Discover descriptors must be claimed by exactly chase-checking', () => {
  test('the exact bank-tx descriptors that caused the original failure no longer false-positive', () => {
    // The bank-tx descriptors that were embedded in the Chase Checking
    // statement and triggered the false-positive detection.
    const chaseCheckingPageOne =
      'JPMorgan Chase Bank, N.A. CHECKING SUMMARY *start*summary ' +
      'Chase College Checking Beginning Balance Deposits and Additions ' +
      'Electronic Withdrawals Ending Balance Account Number: 000000533089535 ' +
      'February 26, 2026 through March 24, 2026 ' +
      'Bk of Amer Visa Online Pmt ' + // ← used to fool BofA adapter
      'Discover E-Payment 3562 ' + // ← used to fool Discover adapter
      'Chase Card Ending IN 1797 ' +
      'Robinhood Card Payment PPD ID: 6823032815'; // ← used to fool Robinhood adapter

    const result = detectAdapter(chaseCheckingPageOne);
    expect(result).not.toBeNull();
    expect(result!.adapter.name).toBe('layout-chase-checking');
  });

  test('BofA detect alone does NOT match the Chase Checking descriptor band', async () => {
    const { bofaCreditCardAdapter } =
      await import('../../../src/lib/adapters/bofa-credit-card/adapter');
    expect(
      bofaCreditCardAdapter.detect('Bk of Amer Visa Online Pmt Ckf148086844POS Web ID: 9500000000')
    ).toBe(false);
  });

  test('Discover detect alone does NOT match the Chase Checking descriptor band', async () => {
    const { discoverCreditCardAdapter } =
      await import('../../../src/lib/adapters/discover-credit-card/adapter');
    expect(discoverCreditCardAdapter.detect('Discover E-Payment 3562 Web ID: 2510020270')).toBe(
      false
    );
  });

  // Note: a previous version of this file had a test asserting
  // detectAdapter() THROWS on a contrived ambiguous sample.  After the
  // 2026-05-23 detect tightening, constructing such a sample is hard —
  // each adapter's detect() now requires markers that are unique to its
  // own statement template.  The "throws on multi-match" path is still
  // present in detector.ts (loud failure rather than silent first-match
  // win), and cross-adapter-exclusivity.test.ts covers it structurally.
});
