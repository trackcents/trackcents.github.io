// Bug: BofA April/May 2026 real PDFs failed to import with
//      "could not find Previous Balance or New Balance Total in Account Summary".
//
// Discovered: 2026-05-23
// Reported by: user uploading Bofa Emailing eStmt_2026-04-12 + 05-12 PDFs
//
// Root cause: BofA's Account Summary box prints rows as MULTI-CELL — the
//      label ("Previous Balance") at x=36 and the amount as TWO further
//      cells: "$" at x≈252 and digits at x≈257.  Our anonymizer's JSON
//      output collapsed those three cells into ONE cell (" Previous Balance
//      $X.XX") — so the adapter's per-cell regex worked on the FIXTURE but
//      failed on the REAL PDF.  Account-number format was also wrong in
//      tests: real BofA uses "Account# #### #### #### NNNN" (spaces) but
//      the anonymizer outputs "Account # XXXX-XXXX-XXXX-NNNN" (hyphens).
//
// Fix:
//   - extractAccountSummary now joins each row's cells via rowText() and
//     runs the inline regex on the joined string — handles both squished
//     and split-cell layouts.
//   - Account-number regex accepts spaces OR hyphens between groups.
//   - Added tests/unit/adapters/bofa-credit-card.test.ts with split-cell
//     synthetic fixtures (the REAL layout, not the anonymizer's collapsed
//     form).
//
// This regression test asserts BOTH layouts succeed.

import { describe, test, expect } from 'vitest';
import { bofaCreditCardAdapter } from '../../../src/lib/adapters/bofa-credit-card/adapter';
import type { PdfTextItem, PdfTextWithPositions } from '../../../src/lib/adapters/types';

function mkItem(text: string, x: number, y: number): PdfTextItem {
  return { text, x, y, width: text.length * 5, height: 10, font_size: 9 };
}

function buildBaseStatement(): PdfTextItem[] {
  return [
    // Detect markers
    mkItem('Bank of America', 36, 740),
    mkItem('www.bankofamerica.com', 36, 720),
    mkItem('Visa Signature', 36, 700),
    // Real BofA account-number format: spaces, no space before #
    mkItem('Account# 4147 0010 0020 2050', 467, 571),
    mkItem('March 13 - April 12, 2026', 36, 600),
    mkItem('Account Summary/Payment Information', 36, 521)
  ];
}

describe('regression bug-2026-05-23: BofA real split-cell Account Summary parses', () => {
  test('the REAL layout (label at x=36; "$" at x=252; digits at x=257) parses successfully', async () => {
    const items: PdfTextItem[] = [
      ...buildBaseStatement(),
      // Previous Balance — REAL layout
      mkItem('Previous Balance', 36, 506),
      mkItem('$', 252, 505),
      mkItem('341.27', 257, 505),
      // New Balance Total — REAL layout
      mkItem('New Balance Total', 36, 441),
      mkItem('$', 256, 441),
      mkItem('15.07', 262, 441),
      // Payments
      mkItem('Payments and Other Credits', 36, 495),
      mkItem('-$', 247, 494),
      mkItem('341.27', 257, 494),
      // Purchases / fees / interest (so the checksum has all the inputs)
      mkItem('Purchases and Adjustments', 36, 484),
      mkItem('$', 252, 483),
      mkItem('15.07', 257, 483),
      mkItem('Fees Charged', 36, 472),
      mkItem('$', 258, 472),
      mkItem('0.00', 264, 472),
      mkItem('Interest Charged', 36, 461),
      mkItem('$', 258, 461),
      mkItem('0.00', 264, 461)
    ];
    const pdf: PdfTextWithPositions = {
      pages: [{ page_number: 1, items }],
      total_pages: 1
    };
    const result = await bofaCreditCardAdapter.parse(pdf);
    expect(result.statement.previous_balance_minor).toBe(34127n);
    expect(result.statement.statement_balance_minor).toBe(1507n);
    expect(result.statement.account_last_4).toBe('2050');
  });

  test('the ANONYMIZER-COLLAPSED layout (label+amount in one cell) ALSO parses successfully', async () => {
    const items: PdfTextItem[] = [
      // Detect markers (anonymized form uses hyphens between account groups)
      mkItem('Bank of America', 36, 740),
      mkItem('www.bankofamerica.com', 36, 720),
      mkItem('Visa Signature', 36, 700),
      mkItem('Account # XXXX-XXXX-XXXX-2050', 467, 571),
      mkItem('March 13 - April 12, 2026', 36, 600),
      mkItem('Account Summary/Payment Information', 36, 521),
      // Collapsed cells — single cell carries both label and amount
      mkItem(' Previous Balance   $341.27', 36, 506),
      mkItem(' Payments and Other Credits   -$341.27', 36, 495),
      mkItem(' Purchases and Adjustments   $15.07', 36, 484),
      mkItem(' Fees Charged   $0.00', 36, 472),
      mkItem(' Interest Charged   $0.00', 36, 461),
      mkItem(' New Balance Total   $15.07', 36, 441)
    ];
    const pdf: PdfTextWithPositions = {
      pages: [{ page_number: 1, items }],
      total_pages: 1
    };
    const result = await bofaCreditCardAdapter.parse(pdf);
    expect(result.statement.previous_balance_minor).toBe(34127n);
    expect(result.statement.statement_balance_minor).toBe(1507n);
    expect(result.statement.account_last_4).toBe('2050');
  });

  test('a statement missing every Account Summary row throws a CLEAR error (no silent failure)', async () => {
    const items: PdfTextItem[] = [
      // Detect markers only — no summary rows
      mkItem('Bank of America', 36, 740),
      mkItem('www.bankofamerica.com', 36, 720),
      mkItem('Visa Signature', 36, 700),
      mkItem('Account# 4147 0010 0020 2050', 467, 571),
      mkItem('March 13 - April 12, 2026', 36, 600)
    ];
    const pdf: PdfTextWithPositions = {
      pages: [{ page_number: 1, items }],
      total_pages: 1
    };
    await expect(bofaCreditCardAdapter.parse(pdf)).rejects.toThrow(
      /Previous Balance or New Balance/i
    );
  });
});
