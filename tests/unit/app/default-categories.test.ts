/**
 * Tests for the default category + rule seeding (REQ-B0.2).
 *
 * Key assertion: after seeding, applyRules() against REAL temp3-style
 * descriptions assigns the right categories (no more 236-Uncategorized).
 */
import { describe, expect, test } from 'vitest';
import { seedCategoriesAndRules, shouldAutoSeed } from '../../../src/lib/app/default-categories';
import { applyRules } from '../../../src/lib/app/categorization';

describe('seedCategoriesAndRules', () => {
  test('produces ≥20 categories covering the main spending verticals', () => {
    const { categories } = seedCategoriesAndRules(() => '2026-05-28T00:00:00Z');
    expect(categories.length).toBeGreaterThanOrEqual(20);
    const names = new Set(categories.map((c) => c.name));
    // Spot-check required categories per REQ-B0.2.
    [
      'Groceries',
      'Food',
      'Rent/Mortgage',
      'Phone & Internet',
      'Insurance',
      'Subscriptions',
      'CC Payment',
      'Transfer',
      'Investment',
      'Income (salary)'
    ].forEach((n) => expect(names.has(n)).toBe(true));
  });

  test('produces ≥50 seed rules covering the obvious merchants', () => {
    const { rules } = seedCategoriesAndRules(() => '2026-05-28T00:00:00Z');
    expect(rules.length).toBeGreaterThanOrEqual(50);
  });

  test('every rule points at an existing seeded category', () => {
    const { categories, rules } = seedCategoriesAndRules(() => '2026-05-28T00:00:00Z');
    const catIds = new Set(categories.map((c) => c.id));
    for (const r of rules) {
      expect(catIds.has(r.category_id)).toBe(true);
    }
  });

  test('Reapply: applyRules on temp3-style descriptions tags them correctly', () => {
    const { categories, rules } = seedCategoriesAndRules(() => '2026-05-28T00:00:00Z');
    const txns = [
      { key: 'k1', description: 'Altera Corporati Payroll' },
      { key: 'k2', description: '05/10 Online Realtime Payment To Robinhood Securities' },
      { key: 'k3', description: 'Robinhood Card Payment PPD ID: 6823032815' },
      { key: 'k4', description: 'Kitsap CU Transfer 630515' },
      { key: 'k5', description: 'T-Mobile Pcs Svc 9398708' },
      { key: 'k6', description: 'WWW COSTCO COM' },
      { key: 'k7', description: 'CLAUDE.AI SUBSCRIPTION ANTHROPIC.COM CA' },
      { key: 'k8', description: 'TST* NEW SITARA INDIAN RE AUSTIN TX' },
      { key: 'k9', description: 'CARD PURCHASE RETURN COSTCO' },
      { key: 'k10', description: 'Vw Credit, Tel. Web Debit' }
    ];
    const next = applyRules(rules, txns, new Map());
    const idByName = (name: string) => categories.find((c) => c.name === name)?.id ?? '__missing__';
    expect(next.get('k1')?.category_id).toBe(idByName('Income (salary)'));
    expect(next.get('k2')?.category_id).toBe(idByName('Investment'));
    expect(next.get('k3')?.category_id).toBe(idByName('CC Payment'));
    expect(next.get('k4')?.category_id).toBe(idByName('Transfer'));
    expect(next.get('k5')?.category_id).toBe(idByName('Phone & Internet'));
    expect(next.get('k6')?.category_id).toBe(idByName('Groceries'));
    expect(next.get('k7')?.category_id).toBe(idByName('Subscriptions'));
    expect(next.get('k8')?.category_id).toBe(idByName('Food'));
    expect(next.get('k9')?.category_id).toBe(idByName('Refund'));
    expect(next.get('k10')?.category_id).toBe(idByName('Loan/Installment'));
  });
});

describe('shouldAutoSeed', () => {
  test('returns true when both categories and rules are empty', () => {
    expect(shouldAutoSeed({ categories: [], rules: [] })).toBe(true);
  });
  test('returns false when the user has any category', () => {
    expect(
      shouldAutoSeed({
        categories: [{ id: 'c1', name: 'Mine' }],
        rules: []
      })
    ).toBe(false);
  });
  test('returns false when the user has any rule', () => {
    expect(
      shouldAutoSeed({
        categories: [],
        rules: [{ id: 'r1', category_id: 'c1', contains: 'X' }]
      })
    ).toBe(false);
  });
});
