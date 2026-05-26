// Reconciliation matcher — tests for the US-P1-D signature feature.
//
// Algorithm spec is research.md §R12.  Edge cases covered here, ordered by
// importance:
//   1. Single bank payment → exactly one CC statement → auto-link (happy path)
//   2. Multiple CC statements for the same card across different months;
//      bank payment matches only one of them (by amount + date window)
//   3. No CC statement imported yet → bank payment left unlinked (no error)
//   4. CC statement imported but bank tx is outside the date window → no link
//   5. Two CC statements both match by amount within window → ambiguous, no link
//   6. Bank tx description has no "Ending IN NNNN" → no link
//   7. Bank tx is NOT payment_to_card (just a regular transfer) → no link
//   8. Sign convention: bank amount is negative, CC amount is positive, match
//      by absolute value
//   9. Multiple bank payments to the same card in one statement → each gets
//      independently considered
//  10. CC payment-amount mismatch (e.g. bank says $500, CC says $501) → no link

import { describe, expect, test } from 'vitest';
import {
  reconcileImports,
  findLinkForBankTxn,
  type ImportedStatement
} from '../../../src/lib/app/reconciliation';
import type {
  ParsedStatement,
  ParsedTransaction,
  TransactionType
} from '../../../src/lib/adapters/types';

function mkStmt(overrides: Partial<ParsedStatement>): ParsedStatement {
  return {
    account_type: 'checking',
    account_last_4: null,
    period_start: '2026-02-26',
    period_end: '2026-03-24',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: null,
    summary_lines: [],
    payment_due_date: null,
    statement_date: null,
    minimum_payment_due_minor: null,
    parser_provides: [],
    ...overrides
  };
}

function mkTx(
  description: string,
  amount_minor: bigint,
  transaction_type: TransactionType,
  posted_date = '2026-02-28'
): ParsedTransaction {
  return {
    description,
    amount_minor,
    transaction_type,
    posted_date,
    raw_text: description,
    currency: 'USD'
  };
}

function bankImport(
  last4: string,
  txns: ParsedTransaction[],
  periodEnd = '2026-03-24'
): ImportedStatement {
  return {
    statement: mkStmt({
      account_type: 'checking',
      account_last_4: last4,
      period_end: periodEnd
    }),
    transactions: txns,
    bank_name: 'Chase',
    adapter_name: 'layout-chase-checking',
    pdf_source_hash: `bank-${last4}-${periodEnd}`
  };
}

function ccImport(last4: string, txns: ParsedTransaction[], periodEnd: string): ImportedStatement {
  return {
    statement: mkStmt({
      account_type: 'credit_card',
      account_last_4: last4,
      period_end: periodEnd
    }),
    transactions: txns,
    bank_name: 'Chase',
    adapter_name: 'layout-chase-credit-card',
    pdf_source_hash: `cc-${last4}-${periodEnd}`
  };
}

describe('reconcileImports — happy path', () => {
  test('links a single bank payment_to_card to its matching CC statement', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        )
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.bank_import_index).toBe(0);
    expect(links[0]!.bank_transaction_index).toBe(0);
    expect(links[0]!.cc_import_index).toBe(1);
    expect(links[0]!.cc_transaction_index).toBe(0);
    expect(links[0]!.link_type).toBe('auto');
    expect(links[0]!.confidence_score).toBe(1.0);
    expect(links[0]!.matched_amount_minor).toBe(147397n);
  });

  test('matches by absolute value when bank tx is negative and CC tx is positive', () => {
    // Bank: money LEAVES the bank account → negative.
    // CC:   payment REDUCES the CC balance → positive (after our sign inversion).
    // Both have the same absolute amount.
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx('03/06 Payment To Chase Card Ending IN 1797', -5043n, 'payment_to_card', '2026-03-06')
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 5043n, 'payment_to_card', '2026-03-06')],
        '2026-03-13'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
  });

  test('multiple bank payments to the same card → each independently linked', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        ),
        mkTx(
          '03/03 Payment To Chase Card Ending IN 1797',
          -15535n,
          'payment_to_card',
          '2026-03-03'
        ),
        mkTx('03/06 Payment To Chase Card Ending IN 1797', -5043n, 'payment_to_card', '2026-03-06')
      ]),
      ccImport(
        '1797',
        [
          mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28'),
          mkTx('Payment Thank You-Mobile', 15535n, 'payment_to_card', '2026-03-03'),
          mkTx('Payment Thank You-Mobile', 5043n, 'payment_to_card', '2026-03-06')
        ],
        '2026-03-13'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(3);
    // Each link points at a distinct CC transaction.
    const ccTxIdxs = links.map((l) => l.cc_transaction_index);
    expect(new Set(ccTxIdxs).size).toBe(3);
  });
});

describe('reconcileImports — no-match cases', () => {
  test('no CC statement imported → bank payment unlinked (no error)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        )
      ])
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('bank payment outside the ±10-day window of CC period_end → no link', () => {
    // Bank tx on Feb 5, CC period ends March 13 — that's ~36 days apart.
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/05 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-05'
        )
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-05')],
        '2026-03-13'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('description has no "Ending IN NNNN" → no link', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [mkTx('Some Other Payment', -147397n, 'payment_to_card', '2026-02-28')]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('amount mismatch (off by $1) → no link', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        )
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147300n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('non-payment_to_card bank tx (regular transfer) → ignored', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx('02/28 Zelle Payment To Friend', -147397n, 'transfer', '2026-02-28')
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });
});

describe('reconcileImports — multi-month and ambiguity', () => {
  test('two CC statements for the same card in different months: each bank-tx links to the right month', () => {
    const imports: ImportedStatement[] = [
      // March CC statement
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      ),
      // April CC statement (different period)
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 100000n, 'payment_to_card', '2026-03-28')],
        '2026-04-13'
      ),
      // Bank statement covering both months
      bankImport(
        '9535',
        [
          mkTx(
            '02/28 Payment To Chase Card Ending IN 1797',
            -147397n,
            'payment_to_card',
            '2026-02-28'
          ),
          mkTx(
            '03/28 Payment To Chase Card Ending IN 1797',
            -100000n,
            'payment_to_card',
            '2026-03-28'
          )
        ],
        '2026-04-25'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(2);
    // Feb payment → March CC statement (cc_import_index=0)
    expect(findLinkForBankTxn(links, 2, 0)?.cc_import_index).toBe(0);
    // March payment → April CC statement (cc_import_index=1)
    expect(findLinkForBankTxn(links, 2, 1)?.cc_import_index).toBe(1);
  });

  test('two CC statements both match by amount AND date → ambiguous, no auto-link', () => {
    // Edge case: user has two cards both ending in same last 4 (shouldn't
    // happen with real Chase but the matcher must be safe).  Or two CC
    // statements for the same card in the same month (e.g. user imported a
    // duplicate).  Auto-linking would be wrong; matcher refuses.
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        )
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      ),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });
});

describe('reconcileImports — cross-bank CC payments', () => {
  function ccImportNamed(
    bankName: string,
    last4: string | null,
    txns: ParsedTransaction[],
    periodEnd: string
  ): ImportedStatement {
    return {
      statement: mkStmt({
        account_type: 'credit_card',
        account_last_4: last4,
        period_end: periodEnd
      }),
      transactions: txns,
      bank_name: bankName,
      adapter_name: `layout-${bankName.toLowerCase().replace(/\s+/g, '-')}-credit-card`,
      pdf_source_hash: `cc-${bankName}-${last4 ?? 'na'}-${periodEnd}`
    };
  }

  test('Discover payment from Chase Checking → linked to Discover CC by E-Payment NNNN', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          'Discover E-Payment 3562 Web ID: PHONE REDACTED',
          -35127n,
          'payment_to_card',
          '2026-03-05'
        )
      ]),
      ccImportNamed(
        'Discover',
        '3562',
        [mkTx('Payment Thank You-Web', 35127n, 'payment_to_card', '2026-03-05')],
        '2026-03-15'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.cc_import_index).toBe(1);
    expect(links[0]!.confidence_score).toBe(1.0); // Discover descriptor carries last_4
  });

  test('BofA payment from Chase Checking → linked to BofA CC by issuer + amount (no last_4 in descriptor)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx('Bk of Amer Visa Online Pmt Ckf148086844POS', -20000n, 'payment_to_card', '2026-03-02')
      ]),
      ccImportNamed(
        'Bank of America',
        '2050',
        [mkTx('Payment Thank You-AUTOPAY', 20000n, 'payment_to_card', '2026-03-02')],
        '2026-03-13'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.cc_import_index).toBe(1);
    // Lower confidence because descriptor lacked last_4 — matched by issuer+amount+date.
    expect(links[0]!.confidence_score).toBe(0.85);
  });

  test('Amex payment with M-code → linked to Amex CC (M-code is NOT a last_4)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          'American Express ACH Pmt M0560 Web ID: PHONE REDACTED',
          -3542n,
          'payment_to_card',
          '2026-03-02'
        )
      ]),
      ccImportNamed(
        'American Express',
        '03004',
        [mkTx('MOBILE PAYMENT - THANK YOU', 3542n, 'payment_to_card', '2026-03-02')],
        '2026-03-17'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.confidence_score).toBe(0.85);
  });

  test('Robinhood payment from Chase Checking → linked to Robinhood CC by issuer + amount', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          'Robinhood Card Payment PPD ID: PHONE REDACTED',
          -34492n,
          'payment_to_card',
          '2026-04-15'
        )
      ]),
      ccImportNamed(
        'Robinhood',
        '9024',
        [mkTx('Payment Thank You-Mobile', 34492n, 'payment_to_card', '2026-04-15')],
        '2026-04-28'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
    expect(links[0]!.confidence_score).toBe(0.85);
  });

  test('All 5 issuers paid from a single Chase Checking statement → 5 distinct links', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/27 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        ),
        mkTx('Bk of Amer Visa Online Pmt', -20000n, 'payment_to_card', '2026-03-02'),
        mkTx('American Express ACH Pmt M0560', -3542n, 'payment_to_card', '2026-03-02'),
        mkTx('Discover E-Payment 3562', -35127n, 'payment_to_card', '2026-03-05'),
        mkTx('Robinhood Card Payment', -34492n, 'payment_to_card', '2026-03-06')
      ]),
      ccImportNamed(
        'Chase',
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      ),
      ccImportNamed(
        'Bank of America',
        '2050',
        [mkTx('Payment Thank You-AUTOPAY', 20000n, 'payment_to_card', '2026-03-02')],
        '2026-03-13'
      ),
      ccImportNamed(
        'American Express',
        '03004',
        [mkTx('MOBILE PAYMENT - THANK YOU', 3542n, 'payment_to_card', '2026-03-02')],
        '2026-03-17'
      ),
      ccImportNamed(
        'Discover',
        '3562',
        [mkTx('Payment Thank You-Web', 35127n, 'payment_to_card', '2026-03-05')],
        '2026-03-15'
      ),
      ccImportNamed(
        'Robinhood',
        '9024',
        [mkTx('Payment Thank You-Mobile', 34492n, 'payment_to_card', '2026-03-06')],
        '2026-03-29'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(5);
    // Each link targets a DIFFERENT cc_import_index.
    const targets = new Set(links.map((l) => l.cc_import_index));
    expect(targets.size).toBe(5);
  });

  test('BofA payment but no BofA CC imported yet → no link (silent, not error)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx('Bk of Amer Visa Online Pmt', -20000n, 'payment_to_card', '2026-03-02')
      ])
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('Wrong-amount Amex payment → no link (amount must match to the cent)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx('American Express ACH Pmt M0560', -3542n, 'payment_to_card', '2026-03-02')
      ]),
      ccImportNamed(
        'American Express',
        '03004',
        [mkTx('MOBILE PAYMENT - THANK YOU', 3543n, 'payment_to_card', '2026-03-02')], // off by 1¢
        '2026-03-17'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('Multi-month: Feb BofA payment → March BofA CC; March BofA payment → April BofA CC', () => {
    const imports: ImportedStatement[] = [
      ccImportNamed(
        'Bank of America',
        '2050',
        [mkTx('Payment Thank You-AUTOPAY', 20000n, 'payment_to_card', '2026-02-15')],
        '2026-03-13'
      ),
      ccImportNamed(
        'Bank of America',
        '2050',
        [mkTx('Payment Thank You-AUTOPAY', 30000n, 'payment_to_card', '2026-03-15')],
        '2026-04-12'
      ),
      bankImport(
        '9535',
        [
          mkTx('Bk of Amer Visa Online Pmt', -20000n, 'payment_to_card', '2026-02-15'),
          mkTx('Bk of Amer Visa Online Pmt', -30000n, 'payment_to_card', '2026-03-15')
        ],
        '2026-04-25'
      )
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(2);
    expect(findLinkForBankTxn(links, 2, 0)?.cc_import_index).toBe(0);
    expect(findLinkForBankTxn(links, 2, 1)?.cc_import_index).toBe(1);
  });

  test('Issuer mismatch: Chase bank says "Bk of Amer" but only Discover CC imported → no link', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx('Bk of Amer Visa Online Pmt', -20000n, 'payment_to_card', '2026-03-02')
      ]),
      ccImportNamed(
        'Discover', // wrong issuer
        '3562',
        [mkTx('Payment Thank You-Web', 20000n, 'payment_to_card', '2026-03-02')],
        '2026-03-15'
      )
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });
});

describe('reconcileImports — adversarial / boundary cases', () => {
  test('empty imports array → empty links (no error)', () => {
    expect(reconcileImports([])).toEqual([]);
  });

  test('only bank imports, no CC → no links (no error)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        )
      ])
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('only CC imports, no bank → no links (no error)', () => {
    const imports: ImportedStatement[] = [
      {
        statement: mkStmt({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2026-03-13'
        }),
        transactions: [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        bank_name: 'Chase',
        adapter_name: 'layout-chase-credit-card',
        pdf_source_hash: 'cc-only'
      }
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('bank tx date EXACTLY at window boundary (±30 days) is included', () => {
    // CC period_end 2026-03-13, bank tx 2026-02-11 = exactly 30 days earlier.
    // Should link (≤ 30 day window).
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/11 Payment To Chase Card Ending IN 1797',
          -100000n,
          'payment_to_card',
          '2026-02-11'
        )
      ]),
      {
        statement: mkStmt({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2026-03-13'
        }),
        transactions: [mkTx('Payment Thank You', 100000n, 'payment_to_card', '2026-02-11')],
        bank_name: 'Chase',
        adapter_name: 'layout-chase-credit-card',
        pdf_source_hash: 'cc-boundary'
      }
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(1);
  });

  test('bank tx date 31 days from CC period_end is excluded', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/10 Payment To Chase Card Ending IN 1797',
          -100000n,
          'payment_to_card',
          '2026-02-10'
        )
      ]),
      {
        statement: mkStmt({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2026-03-13'
        }),
        transactions: [mkTx('Payment Thank You', 100000n, 'payment_to_card', '2026-02-10')],
        bank_name: 'Chase',
        adapter_name: 'layout-chase-credit-card',
        pdf_source_hash: 'cc-out-of-window'
      }
    ];
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('bank pays the same amount to TWO different cards on the same day — each gets the right link', () => {
    // User has both a Chase 1797 and a Chase 7137; bank statement shows two
    // $100 payments, one to each.  Each link must target the correct card.
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -10000n,
          'payment_to_card',
          '2026-02-28'
        ),
        mkTx('02/28 Payment To Chase Card Ending IN 7137', -10000n, 'payment_to_card', '2026-02-28')
      ]),
      {
        statement: mkStmt({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2026-03-13'
        }),
        transactions: [mkTx('Payment Thank You', 10000n, 'payment_to_card', '2026-02-28')],
        bank_name: 'Chase',
        adapter_name: 'layout-chase-credit-card',
        pdf_source_hash: 'cc-1797'
      },
      {
        statement: mkStmt({
          account_type: 'credit_card',
          account_last_4: '7137',
          period_end: '2026-03-13'
        }),
        transactions: [mkTx('Payment Thank You', 10000n, 'payment_to_card', '2026-02-28')],
        bank_name: 'Chase',
        adapter_name: 'layout-chase-credit-card',
        pdf_source_hash: 'cc-7137'
      }
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(2);
    // Each link goes to the matching card.
    expect(findLinkForBankTxn(links, 0, 0)?.cc_import_index).toBe(1); // 1797 import is at index 1
    expect(findLinkForBankTxn(links, 0, 1)?.cc_import_index).toBe(2); // 7137 import is at index 2
  });

  test('three months of unique-amount payments each link to the matching CC statement', () => {
    // 30-day window makes any single amount paid across multiple months
    // ambiguous (the bank tx is in window for two adjacent CCs).  But with
    // a UNIQUE amount per month, the matcher disambiguates via amount.
    const imports: ImportedStatement[] = [
      bankImport(
        '9535',
        [
          mkTx(
            '02/28 Payment To Chase Card Ending IN 1797',
            -10000n,
            'payment_to_card',
            '2026-02-28'
          ),
          mkTx(
            '03/28 Payment To Chase Card Ending IN 1797',
            -20000n,
            'payment_to_card',
            '2026-03-28'
          ),
          mkTx(
            '04/28 Payment To Chase Card Ending IN 1797',
            -30000n,
            'payment_to_card',
            '2026-04-28'
          )
        ],
        '2026-05-15'
      ),
      ccImportNamedHelper('1797', '2026-03-13', 10000n),
      ccImportNamedHelper('1797', '2026-04-13', 20000n),
      ccImportNamedHelper('1797', '2026-05-13', 30000n)
    ];
    const links = reconcileImports(imports);
    expect(links).toHaveLength(3);
    expect(findLinkForBankTxn(links, 0, 0)?.cc_import_index).toBe(1); // $100 → Mar CC
    expect(findLinkForBankTxn(links, 0, 1)?.cc_import_index).toBe(2); // $200 → Apr CC
    expect(findLinkForBankTxn(links, 0, 2)?.cc_import_index).toBe(3); // $300 → May CC
  });

  test('SAME-amount payments to same card in adjacent months are correctly refused as ambiguous (no false link)', () => {
    // Two months with identical $100 payments — the matcher CAN'T tell which
    // CC the Mar 28 bank pmt covered because both Mar and Apr CCs have a
    // $100 row inside the date window.  Correct behavior: refuse to link
    // ambiguously rather than guessing.
    const imports: ImportedStatement[] = [
      bankImport(
        '9535',
        [
          mkTx(
            '03/28 Payment To Chase Card Ending IN 1797',
            -10000n,
            'payment_to_card',
            '2026-03-28'
          )
        ],
        '2026-04-25'
      ),
      ccImportNamedHelper('1797', '2026-03-13', 10000n), // 15 days from 03/28
      ccImportNamedHelper('1797', '2026-04-13', 10000n) // 16 days from 03/28
    ];
    // Both CCs match: same amount, both within ±30 days. Matcher refuses
    // to auto-link — better silent than wrong.
    expect(reconcileImports(imports)).toEqual([]);
  });

  test('bank tx with payment_to_card type but no recognized issuer in description → no link', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [mkTx('CREDIT CARD PAYMENT', -10000n, 'payment_to_card', '2026-02-28')]),
      {
        statement: mkStmt({
          account_type: 'credit_card',
          account_last_4: '1797',
          period_end: '2026-03-13'
        }),
        transactions: [mkTx('Payment Thank You', 10000n, 'payment_to_card', '2026-02-28')],
        bank_name: 'Chase',
        adapter_name: 'layout-chase-credit-card',
        pdf_source_hash: 'cc-unidentified'
      }
    ];
    // Generic "CREDIT CARD PAYMENT" doesn't match any of our 11 issuer patterns
    // and has no "Ending IN NNNN" — no auto-link.  This avoids false-positive
    // links when the bank uses a non-standard descriptor we haven't yet
    // taught the matcher.
    expect(reconcileImports(imports)).toEqual([]);
  });
});

function ccImportNamedHelper(last4: string, periodEnd: string, amount: bigint): ImportedStatement {
  return {
    statement: mkStmt({
      account_type: 'credit_card',
      account_last_4: last4,
      period_end: periodEnd
    }),
    transactions: [mkTx('Payment Thank You', amount, 'payment_to_card', '2026-02-28')],
    bank_name: 'Chase',
    adapter_name: 'layout-chase-credit-card',
    pdf_source_hash: `cc-${last4}-${periodEnd}`
  };
}

describe('findLinkForBankTxn helper', () => {
  test('returns the link by (bank_import_index, bank_transaction_index)', () => {
    const imports: ImportedStatement[] = [
      bankImport('9535', [
        mkTx(
          '02/28 Payment To Chase Card Ending IN 1797',
          -147397n,
          'payment_to_card',
          '2026-02-28'
        )
      ]),
      ccImport(
        '1797',
        [mkTx('Payment Thank You-Mobile', 147397n, 'payment_to_card', '2026-02-28')],
        '2026-03-13'
      )
    ];
    const links = reconcileImports(imports);
    const found = findLinkForBankTxn(links, 0, 0);
    expect(found).toBeDefined();
    expect(found?.cc_import_index).toBe(1);
  });

  test('returns undefined when no link exists for that bank-tx coordinate', () => {
    expect(findLinkForBankTxn([], 0, 0)).toBeUndefined();
  });
});
