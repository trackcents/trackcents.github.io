import { describe, test, expect } from 'vitest';
import {
  categorizableFromImports,
  summaryFromImports,
  detailedRowsFromImports,
  resolveEffectiveCategory
} from '../../../src/lib/app/categorization-glue';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { TransactionAnnotation } from '../../../src/lib/app/categorization';

// Minimal import records — the glue reads pdf_source_hash + bank_name + transactions[].
const imp = (
  hash: string,
  txns: Array<{ description: string; amount_minor: bigint; posted_date: string }>,
  bank_name = 'TestBank'
): ImportRecord =>
  ({ pdf_source_hash: hash, bank_name, transactions: txns }) as unknown as ImportRecord;

describe('categorizableFromImports', () => {
  test('flattens to stable keys + descriptions across imports', () => {
    const out = categorizableFromImports([
      imp('h1', [
        { description: 'AMAZON', amount_minor: -100n, posted_date: '2026-01-01' },
        { description: 'RENT', amount_minor: -2000n, posted_date: '2026-01-02' }
      ]),
      imp('h2', [{ description: 'PAY', amount_minor: 5000n, posted_date: '2026-01-03' }])
    ]);
    expect(out).toEqual([
      { key: 'h1#0', description: 'AMAZON' },
      { key: 'h1#1', description: 'RENT' },
      { key: 'h2#0', description: 'PAY' }
    ]);
  });
});

describe('summaryFromImports', () => {
  test('joins each transaction with its annotation category (null when unannotated)', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': { category_id: 'shopping', source: 'manual' }
    };
    const out = summaryFromImports(
      [
        imp('h1', [
          { description: 'AMAZON', amount_minor: -100n, posted_date: '2026-01-01' },
          { description: 'RENT', amount_minor: -2000n, posted_date: '2026-01-02' }
        ])
      ],
      annotations
    );
    expect(out).toEqual([
      { posted_date: '2026-01-01', amount_minor: -100n, category_id: 'shopping' },
      { posted_date: '2026-01-02', amount_minor: -2000n, category_id: null }
    ]);
  });
});

describe('detailedRowsFromImports', () => {
  test('produces drill-down rows with key, description, bank, and resolved category', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': { category_id: 'shopping', source: 'rule', rule_id: 'r1' }
    };
    const out = detailedRowsFromImports(
      [
        imp(
          'h1',
          [
            { description: 'AMAZON', amount_minor: -100n, posted_date: '2026-01-01' },
            { description: 'RENT', amount_minor: -2000n, posted_date: '2026-01-02' }
          ],
          'Chase'
        )
      ],
      annotations
    );
    expect(out).toEqual([
      {
        key: 'h1#0',
        posted_date: '2026-01-01',
        description: 'AMAZON',
        amount_minor: -100n,
        category_id: 'shopping',
        bank_name: 'Chase',
        ignored: false
      },
      {
        key: 'h1#1',
        posted_date: '2026-01-02',
        description: 'RENT',
        amount_minor: -2000n,
        category_id: null,
        bank_name: 'Chase',
        ignored: false
      }
    ]);
  });

  test('summaryFromImports excludes ignored transactions; detailed row uses custom_name', () => {
    const imports = [
      imp('h1', [
        { description: 'AMAZON', amount_minor: -100n, posted_date: '2026-01-01' },
        { description: 'GYM', amount_minor: -5000n, posted_date: '2026-01-02' }
      ])
    ];
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': { category_id: null, source: 'manual', custom_name: 'Amazon order' },
      'h1#1': { category_id: null, source: 'manual', ignored: true }
    };
    // ignored GYM is dropped from the spend summary
    expect(summaryFromImports(imports, annotations)).toEqual([
      { posted_date: '2026-01-01', amount_minor: -100n, category_id: null }
    ]);
    // detailed rows: rename applied, ignored flag surfaced
    const rows = detailedRowsFromImports(imports, annotations);
    expect(rows[0]?.description).toBe('Amazon order');
    expect(rows[1]?.ignored).toBe(true);
  });
});

describe('refund tracking (US-P3-C) — resolveEffectiveCategory + netting', () => {
  test('resolveEffectiveCategory follows refund_of one hop to the original category', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': { category_id: 'shopping', source: 'manual' },
      'h1#1': { category_id: null, source: 'manual', refund_of: 'h1#0' }
    };
    expect(resolveEffectiveCategory(annotations, 'h1#1')).toBe('shopping');
    expect(resolveEffectiveCategory(annotations, 'h1#0')).toBe('shopping');
  });

  test('a linked refund nets against the original category (not double-counted)', () => {
    const imports = [
      imp('h1', [
        { description: 'AMAZON ORDER', amount_minor: -5000n, posted_date: '2026-01-10' },
        { description: 'AMAZON REFUND', amount_minor: 2000n, posted_date: '2026-01-20' }
      ])
    ];
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': { category_id: 'shopping', source: 'manual' },
      'h1#1': { category_id: null, source: 'manual', refund_of: 'h1#0' }
    };
    const out = summaryFromImports(imports, annotations);
    // both rows resolve to 'shopping'; signed sum nets to -3000 (net spend 30.00)
    expect(out).toEqual([
      { posted_date: '2026-01-10', amount_minor: -5000n, category_id: 'shopping' },
      { posted_date: '2026-01-20', amount_minor: 2000n, category_id: 'shopping' }
    ]);
    const shoppingNet = out
      .filter((r) => r.category_id === 'shopping')
      .reduce((s, r) => s + r.amount_minor, 0n);
    expect(shoppingNet).toBe(-3000n);
  });

  test('refund_of pointing at a missing or self key falls back to own category', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#1': { category_id: 'misc', source: 'manual', refund_of: 'nope#9' },
      'h1#2': { category_id: 'misc', source: 'manual', refund_of: 'h1#2' }
    };
    expect(resolveEffectiveCategory(annotations, 'h1#1')).toBe('misc');
    expect(resolveEffectiveCategory(annotations, 'h1#2')).toBe('misc');
  });

  test('detailedRowsFromImports surfaces refund_of for the UI', () => {
    const imports = [
      imp('h1', [
        { description: 'BUY', amount_minor: -5000n, posted_date: '2026-01-10' },
        { description: 'REFUND', amount_minor: 2000n, posted_date: '2026-01-20' }
      ])
    ];
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#1': { category_id: null, source: 'manual', refund_of: 'h1#0' }
    };
    const rows = detailedRowsFromImports(imports, annotations);
    expect(rows[0]?.refund_of).toBeUndefined();
    expect(rows[1]?.refund_of).toBe('h1#0');
  });
});

describe('split transactions (US-SPLIT) — distribution + conservation', () => {
  const splitImports = [
    imp('h1', [{ description: 'AMAZON ORDER', amount_minor: -10000n, posted_date: '2026-01-10' }])
  ];

  test('an exact split distributes across categories (sums to the whole)', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': {
        category_id: 'shopping',
        source: 'manual',
        split: [
          { category_id: 'household', amount_minor: -6000n },
          { category_id: 'gifts', amount_minor: -4000n }
        ]
      }
    };
    const out = summaryFromImports(splitImports, annotations);
    expect(out).toEqual([
      { posted_date: '2026-01-10', amount_minor: -6000n, category_id: 'household' },
      { posted_date: '2026-01-10', amount_minor: -4000n, category_id: 'gifts' }
    ]);
    // conservation: parts sum to the original txn amount
    expect(out.reduce((s, r) => s + r.amount_minor, 0n)).toBe(-10000n);
  });

  test('a PARTIAL split emits a remainder to the txn category — total always conserved', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': {
        category_id: 'shopping',
        source: 'manual',
        split: [{ category_id: 'household', amount_minor: -6000n }]
      }
    };
    const out = summaryFromImports(splitImports, annotations);
    expect(out).toEqual([
      { posted_date: '2026-01-10', amount_minor: -6000n, category_id: 'household' },
      { posted_date: '2026-01-10', amount_minor: -4000n, category_id: 'shopping' } // remainder
    ]);
    expect(out.reduce((s, r) => s + r.amount_minor, 0n)).toBe(-10000n);
  });

  test('an ignored split transaction is omitted entirely', () => {
    const annotations: Record<string, TransactionAnnotation> = {
      'h1#0': {
        category_id: null,
        source: 'manual',
        ignored: true,
        split: [{ category_id: 'household', amount_minor: -6000n }]
      }
    };
    expect(summaryFromImports(splitImports, annotations)).toEqual([]);
  });

  test('conservation holds for arbitrary split parts (property-ish)', () => {
    for (const parts of [
      [-1n],
      [-3333n, -3333n],
      [-9999n, -1n],
      [-10000n],
      [-5000n, -2500n, -2500n],
      [-12000n] // over-split: remainder +2000 to shopping
    ]) {
      const annotations: Record<string, TransactionAnnotation> = {
        'h1#0': {
          category_id: 'shopping',
          source: 'manual',
          split: parts.map((amount_minor) => ({ category_id: 'household', amount_minor }))
        }
      };
      const out = summaryFromImports(splitImports, annotations);
      expect(out.reduce((s, r) => s + r.amount_minor, 0n)).toBe(-10000n);
    }
  });
});
