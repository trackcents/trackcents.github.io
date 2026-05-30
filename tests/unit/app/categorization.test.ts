import { describe, test, expect } from 'vitest';
import {
  matchRule,
  firstMatchingRule,
  applyRules,
  setManualCategory,
  setAnnotation,
  pruneAnnotation,
  deleteCategory,
  transactionCategoryKey,
  type CategoryRule,
  type Category,
  type TransactionAnnotation,
  type CategorizableTransaction
} from '../../../src/lib/app/categorization';

const rule = (over: Partial<CategoryRule> = {}): CategoryRule => ({
  id: 'r1',
  contains: 'AMAZON',
  category_id: 'shopping',
  ...over
});

// No default `contains` — for regex-only / empty-pattern cases. (exactOptionalPropertyTypes
// forbids passing `contains: undefined` to override, so we omit the key entirely.)
const bare = (over: Partial<CategoryRule> = {}): CategoryRule => ({
  id: 'r1',
  category_id: 'shopping',
  ...over
});

describe('transactionCategoryKey', () => {
  test('combines pdf hash and tx index into a stable key', () => {
    expect(transactionCategoryKey('abc123', 4)).toBe('abc123#4');
  });
});

describe('matchRule (description-only, never amount)', () => {
  test('substring match is case-insensitive by default', () => {
    expect(matchRule(rule(), 'amazon marketplace')).toBe(true);
    expect(matchRule(rule(), 'AMAZON.COM')).toBe(true);
    expect(matchRule(rule(), 'Whole Foods')).toBe(false);
  });

  test('case_sensitive substring respects case', () => {
    expect(matchRule(rule({ case_sensitive: true }), 'amazon')).toBe(false);
    expect(matchRule(rule({ case_sensitive: true }), 'AMAZON')).toBe(true);
  });

  test('regex match, case-insensitive by default', () => {
    const r = bare({ regex: 'uber\\s?eats' });
    expect(matchRule(r, 'UBER EATS 123')).toBe(true);
    expect(matchRule(r, 'ubereats')).toBe(true);
    expect(matchRule(r, 'lyft')).toBe(false);
  });

  test('case_sensitive regex respects case', () => {
    const r = bare({ regex: 'Netflix', case_sensitive: true });
    expect(matchRule(r, 'Netflix')).toBe(true);
    expect(matchRule(r, 'netflix')).toBe(false);
  });

  test('invalid regex never matches (no throw)', () => {
    expect(matchRule(bare({ regex: '(' }), 'anything')).toBe(false);
  });

  test('empty contains and empty regex match nothing (no blanket tagging)', () => {
    expect(matchRule(rule({ contains: '' }), 'AMAZON')).toBe(false);
    expect(matchRule(bare({ regex: '' }), 'AMAZON')).toBe(false);
    expect(matchRule(bare(), 'AMAZON')).toBe(false);
  });
});

describe('firstMatchingRule', () => {
  test('returns the first matching rule in list order', () => {
    const rules = [
      rule({ id: 'a', contains: 'COFFEE', category_id: 'cafe' }),
      rule({ id: 'b', contains: 'STARBUCKS', category_id: 'cafe2' })
    ];
    expect(firstMatchingRule(rules, 'STARBUCKS COFFEE')?.id).toBe('a');
  });

  test('skips disabled rules', () => {
    const rules = [
      rule({ id: 'a', contains: 'AMAZON', enabled: false }),
      rule({ id: 'b', contains: 'AMAZON', category_id: 'other' })
    ];
    expect(firstMatchingRule(rules, 'AMAZON')?.id).toBe('b');
  });

  test('returns null when no rule matches', () => {
    expect(firstMatchingRule([rule()], 'Rent payment')).toBeNull();
  });
});

describe('applyRules', () => {
  const txns: CategorizableTransaction[] = [
    { key: 'h#0', description: 'AMAZON MARKETPLACE' },
    { key: 'h#1', description: 'RENT' }
  ];

  test('assigns a rule-sourced category to matching transactions', () => {
    const out = applyRules([rule()], txns, new Map());
    expect(out.get('h#0')).toEqual({ category_id: 'shopping', source: 'rule', rule_id: 'r1' });
    expect(out.has('h#1')).toBe(false); // no rule matched RENT
  });

  test('manual annotations are preserved and never overwritten by a rule', () => {
    const existing = new Map<string, TransactionAnnotation>([
      ['h#0', { category_id: 'gifts', source: 'manual' }]
    ]);
    const out = applyRules([rule()], txns, existing);
    expect(out.get('h#0')).toEqual({ category_id: 'gifts', source: 'manual' });
  });

  test('a manual annotation for a tx not in this batch is still carried over', () => {
    const existing = new Map<string, TransactionAnnotation>([
      ['other#9', { category_id: 'salary', source: 'manual' }]
    ]);
    const out = applyRules([rule()], txns, existing);
    expect(out.get('other#9')).toEqual({ category_id: 'salary', source: 'manual' });
  });

  test('stale rule-sourced annotation is dropped when no rule matches anymore', () => {
    const existing = new Map<string, TransactionAnnotation>([
      ['h#1', { category_id: 'shopping', source: 'rule', rule_id: 'old' }]
    ]);
    const out = applyRules([rule()], txns, existing); // RENT matches nothing now
    expect(out.has('h#1')).toBe(false);
  });

  test('preserves a flow_intent-only override across re-apply (regression: was dropped on load)', () => {
    // "Not income" sets flow_intent with no category/other extras. applyRules
    // runs on every load; the override must survive or the deposit reverts to
    // income. RENT matches no rule, so without the fix this entry vanishes.
    const existing = new Map<string, TransactionAnnotation>([
      ['h#1', { category_id: null, source: 'manual', flow_intent: 'transfer_self' }]
    ]);
    const out = applyRules([rule()], txns, existing);
    expect(out.get('h#1')).toEqual({
      category_id: null,
      source: 'manual',
      flow_intent: 'transfer_self'
    });
  });

  test('is idempotent for a fixed rule set', () => {
    const once = applyRules([rule()], txns, new Map());
    const twice = applyRules([rule()], txns, once);
    expect([...twice.entries()]).toEqual([...once.entries()]);
  });

  test('does not mutate the input map', () => {
    const existing = new Map<string, TransactionAnnotation>();
    applyRules([rule()], txns, existing);
    expect(existing.size).toBe(0);
  });
});

describe('setManualCategory', () => {
  test('sets a manual category and returns a new map', () => {
    const before = new Map<string, TransactionAnnotation>();
    const after = setManualCategory(before, 'h#0', 'groceries');
    expect(after.get('h#0')).toEqual({ category_id: 'groceries', source: 'manual' });
    expect(before.size).toBe(0);
  });

  test('can clear a category to explicit uncategorized (null)', () => {
    const after = setManualCategory(new Map(), 'h#0', null);
    expect(after.get('h#0')).toEqual({ category_id: null, source: 'manual' });
  });
});

describe('deleteCategory', () => {
  const categories: Category[] = [
    { id: 'shopping', name: 'Shopping' },
    { id: 'rent', name: 'Rent' }
  ];

  test('removes the category from the list', () => {
    const { categories: next } = deleteCategory(categories, new Map(), 'shopping');
    expect(next.map((c) => c.id)).toEqual(['rent']);
  });

  test('manual annotation pointing at it becomes explicit null', () => {
    const ann = new Map<string, TransactionAnnotation>([
      ['h#0', { category_id: 'shopping', source: 'manual' }]
    ]);
    const { annotations } = deleteCategory(categories, ann, 'shopping');
    expect(annotations.get('h#0')).toEqual({ category_id: null, source: 'manual' });
  });

  test('rule-sourced annotation pointing at it is dropped', () => {
    const ann = new Map<string, TransactionAnnotation>([
      ['h#0', { category_id: 'shopping', source: 'rule', rule_id: 'r1' }]
    ]);
    const { annotations } = deleteCategory(categories, ann, 'shopping');
    expect(annotations.has('h#0')).toBe(false);
  });

  test('annotations for other categories are untouched', () => {
    const ann = new Map<string, TransactionAnnotation>([
      ['h#1', { category_id: 'rent', source: 'manual' }]
    ]);
    const { annotations } = deleteCategory(categories, ann, 'shopping');
    expect(annotations.get('h#1')).toEqual({ category_id: 'rent', source: 'manual' });
  });
});

describe('setAnnotation + extras (note/tags/ignored/rename/recurring)', () => {
  test('setAnnotation merges a patch, creating an annotation if absent', () => {
    const out = setAnnotation(new Map(), 'h#0', { note: 'work lunch', ignored: true });
    expect(out.get('h#0')).toEqual({
      category_id: null,
      source: 'manual',
      note: 'work lunch',
      ignored: true
    });
  });

  test('setAnnotation preserves prior fields', () => {
    const before = new Map<string, TransactionAnnotation>([
      ['h#0', { category_id: 'shopping', source: 'rule', rule_id: 'r1' }]
    ]);
    const out = setAnnotation(before, 'h#0', { tags: ['gift'] });
    expect(out.get('h#0')).toEqual({
      category_id: 'shopping',
      source: 'rule',
      rule_id: 'r1',
      tags: ['gift']
    });
  });

  test('applyRules preserves user extras even when it recomputes the rule category', () => {
    const txns: CategorizableTransaction[] = [{ key: 'h#0', description: 'AMAZON' }];
    const existing = new Map<string, TransactionAnnotation>([
      // a note + ignore on a rule-categorized txn
      [
        'h#0',
        { category_id: 'old', source: 'rule', rule_id: 'old', note: 'keep me', ignored: true }
      ]
    ]);
    const out = applyRules([rule()], txns, existing); // rule() → AMAZON→shopping
    expect(out.get('h#0')).toEqual({
      category_id: 'shopping',
      source: 'rule',
      rule_id: 'r1',
      note: 'keep me',
      ignored: true
    });
  });

  test('applyRules keeps an extras-only annotation when no rule matches', () => {
    const txns: CategorizableTransaction[] = [{ key: 'h#0', description: 'RENT' }];
    const existing = new Map<string, TransactionAnnotation>([
      ['h#0', { category_id: null, source: 'manual', note: 'march rent' }]
    ]);
    const out = applyRules([rule()], txns, existing); // RENT matches nothing
    expect(out.get('h#0')?.note).toBe('march rent');
  });
});

describe('pruneAnnotation', () => {
  test('returns null for an uncategorized manual annotation with no extras', () => {
    expect(pruneAnnotation({ category_id: null, source: 'manual' })).toBeNull();
  });

  test('drops empty rename / note and empty tag list', () => {
    const out = pruneAnnotation({
      category_id: null,
      source: 'manual',
      custom_name: '',
      note: '',
      tags: []
    });
    expect(out).toBeNull();
  });

  test('keeps a category even with no extras', () => {
    expect(pruneAnnotation({ category_id: 'food', source: 'manual' })).toEqual({
      category_id: 'food',
      source: 'manual'
    });
  });

  test('keeps meaningful extras and preserves rule_id', () => {
    const out = pruneAnnotation({
      category_id: 'shopping',
      source: 'rule',
      rule_id: 'r1',
      note: 'gift',
      tags: ['x'],
      ignored: true,
      custom_name: 'Amazon',
      is_recurring: true
    });
    expect(out).toEqual({
      category_id: 'shopping',
      source: 'rule',
      rule_id: 'r1',
      note: 'gift',
      tags: ['x'],
      ignored: true,
      custom_name: 'Amazon',
      is_recurring: true
    });
  });

  test('preserves a flow_intent override (regression: was silently dropped)', () => {
    // The Manage-income sheet sets flow_intent:'transfer_self' to mean "this
    // deposit is NOT income". pruneAnnotation must keep it, or the edit reverts.
    expect(
      pruneAnnotation({ category_id: null, source: 'manual', flow_intent: 'transfer_self' })
    ).toEqual({ category_id: null, source: 'manual', flow_intent: 'transfer_self' });
  });

  test('an extras-only annotation survives (e.g. ignored)', () => {
    expect(pruneAnnotation({ category_id: null, source: 'manual', ignored: true })).toEqual({
      category_id: null,
      source: 'manual',
      ignored: true
    });
  });

  test('drops ignored:false and is_recurring:false', () => {
    expect(
      pruneAnnotation({ category_id: null, source: 'manual', ignored: false, is_recurring: false })
    ).toBeNull();
  });
});
