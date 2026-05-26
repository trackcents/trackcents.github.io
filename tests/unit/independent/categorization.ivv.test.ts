// =============================================================================
// IV&V verification environment — categorization (US-P2-A rule engine + overlay)
//
// Independent Verification & Validation. This file is authored by the
// verification-engineer from the verification CONTRACT
// (specs/001-money-tracker-mvp/verification/categorization.contract.md) + the
// spec (US-P2-A) ALONE. The bodies of the public DUT functions (matchRule,
// firstMatchingRule, applyRules, setManualCategory, setAnnotation,
// pruneAnnotation, deleteCategory) were NOT read. Reference models below are an
// independent from-spec re-implementation, never derived from the DUT.
//
// UVM -> software mapping realised here:
//   Sequencer/Generator : fast-check arbitraries (arbRule, arbRules, arbExisting)
//   Driver              : direct call of the public DUT functions
//   Monitor             : extras-extraction + deep-equal helpers
//   Reference Model     : ref* functions (independent re-impl of R1/R2)
//   Scoreboard          : tests/_framework Scoreboard{dut, model}
//   Assertions/Cover    : fast-check properties for INV1..INV7 + R5/R7/R10/R11
//   Coverage collector  : tests/_framework CoverageModel (functional coverage)
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---- DUT (public exports only; never the implementation body) ---------------
import {
  matchRule,
  firstMatchingRule,
  applyRules,
  setManualCategory,
  setAnnotation,
  pruneAnnotation,
  deleteCategory,
  transactionCategoryKey,
  type Category,
  type CategoryRule,
  type TransactionAnnotation,
  type CategorizableTransaction,
  type TransactionSplit
} from '../../../src/lib/app/categorization';

// =============================================================================
// Independent reference models (from the contract WHAT, never the DUT HOW)
// =============================================================================

/** R1 reference: description-only match, regex precedence, empty => nothing,
 *  invalid regex => false (never throws), case-insensitive unless case_sensitive. */
function refMatchRule(rule: CategoryRule, description: string): boolean {
  const ci = rule.case_sensitive !== true;
  const re = rule.regex;
  if (re !== undefined && re !== '') {
    try {
      const r = new RegExp(re, ci ? 'i' : '');
      return r.test(description);
    } catch {
      return false; // invalid regex matches NOTHING, no throw
    }
  }
  const c = rule.contains;
  if (c !== undefined && c !== '') {
    if (ci) return description.toLowerCase().includes(c.toLowerCase());
    return description.includes(c);
  }
  return false; // empty pattern matches NOTHING
}

/** R2 reference: first ENABLED (enabled !== false) rule in list order that matches. */
function refFirstMatchingRule(rules: CategoryRule[], description: string): CategoryRule | null {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (refMatchRule(rule, description)) return rule;
  }
  return null;
}

// =============================================================================
// The "user extras" set (contract section 3): everything EXCEPT
// category_id / source / rule_id.
// =============================================================================
const EXTRA_KEYS = [
  'note',
  'tags',
  'ignored',
  'custom_name',
  'is_recurring',
  'refund_of',
  'split'
] as const;

/** "Present, non-empty" extras as the contract's empty-definition (sec 3):
 *  note/custom_name/refund_of empty = ''; tags/split empty = []; ignored/
 *  is_recurring empty = false/absent. Mirrors what a user would consider a
 *  meaningful annotation worth preserving. */
function nonEmptyExtrasOf(a: TransactionAnnotation): Partial<TransactionAnnotation> {
  const e: Partial<TransactionAnnotation> = {};
  if (typeof a.note === 'string' && a.note !== '') e.note = a.note;
  if (Array.isArray(a.tags) && a.tags.length > 0) e.tags = a.tags;
  if (a.ignored === true) e.ignored = true;
  if (typeof a.custom_name === 'string' && a.custom_name !== '') e.custom_name = a.custom_name;
  if (a.is_recurring === true) e.is_recurring = true;
  if (typeof a.refund_of === 'string' && a.refund_of !== '') e.refund_of = a.refund_of;
  if (Array.isArray(a.split) && a.split.length > 0) e.split = a.split;
  return e;
}

function hasNonEmptyExtras(a: TransactionAnnotation): boolean {
  return Object.keys(nonEmptyExtrasOf(a)).length > 0;
}

/** Deep value equality for the extra slice (stable, order-independent on keys). */
function extrasEqual(a: TransactionAnnotation, b: TransactionAnnotation): boolean {
  const ea = nonEmptyExtrasOf(a);
  const eb = nonEmptyExtrasOf(b);
  return JSON.stringify(normExtras(ea)) === JSON.stringify(normExtras(eb));
}

function normExtras(e: Partial<TransactionAnnotation>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EXTRA_KEYS) {
    if (e[k] !== undefined) {
      const v = e[k];
      if (k === 'split' && Array.isArray(v)) {
        out[k] = (v as TransactionSplit[]).map((s) => ({
          category_id: s.category_id,
          amount_minor: `${s.amount_minor}n`
        }));
      } else {
        out[k] = v as unknown;
      }
    }
  }
  return out;
}

function isManualCat(a: TransactionAnnotation): boolean {
  return a.source === 'manual' && a.category_id !== null;
}

// =============================================================================
// Constrained-random generators (the sequencer)
// =============================================================================

const arbCategoryId = fc.constantFrom('cat-shop', 'cat-food', 'cat-bills', 'cat-fun');

// Descriptions intentionally include the tokens our rules will match, plus
// Unicode / special-regex chars to probe R1 edge cases.
const arbDescription = fc.constantFrom(
  'AMAZON MARKETPLACE',
  'amazon prime',
  'WHOLE FOODS #123',
  'Starbucks Coffee',
  'NETFLIX.COM',
  'PG&E PAYMENT',
  'Café Münchën €5',
  '(parens) [brackets] {braces}',
  'a+b*c?',
  '   ',
  'random vendor xyz'
);

// Rule generator covering: contains-only, regex-only, both, empty patterns,
// invalid regex, case sensitivity, enabled true/false/undefined.
// Built via map so optional keys are OMITTED (not set to undefined) — required
// under exactOptionalPropertyTypes.
const arbRule: fc.Arbitrary<CategoryRule> = fc
  .record({
    id: fc.constantFrom('r1', 'r2', 'r3', 'r4'),
    contains: fc.option(fc.constantFrom('AMAZON', 'amazon', 'foods', '', 'NETFLIX', 'xyz'), {
      nil: undefined
    }),
    regex: fc.option(fc.constantFrom('amazon', '^NETFLIX', 'foods?', '', '[(', 'a\\+b', 'café'), {
      nil: undefined
    }),
    case_sensitive: fc.option(fc.boolean(), { nil: undefined }),
    category_id: arbCategoryId,
    enabled: fc.option(fc.boolean(), { nil: undefined })
  })
  .map((r) => {
    const rule: CategoryRule = { id: r.id, category_id: r.category_id };
    if (r.contains !== undefined) rule.contains = r.contains;
    if (r.regex !== undefined) rule.regex = r.regex;
    if (r.case_sensitive !== undefined) rule.case_sensitive = r.case_sensitive;
    if (r.enabled !== undefined) rule.enabled = r.enabled;
    return rule;
  });

const arbRules: fc.Arbitrary<CategoryRule[]> = fc.array(arbRule, { maxLength: 5 });

const arbSplit: fc.Arbitrary<TransactionSplit> = fc.record({
  category_id: fc.option(arbCategoryId, { nil: null }),
  amount_minor: fc.bigInt({ min: -100000n, max: 100000n })
});

/** A random annotation that may be manual, rule-sourced, with or without extras.
 *  Built via map so optional keys are OMITTED (exactOptionalPropertyTypes). */
const arbAnnotation: fc.Arbitrary<TransactionAnnotation> = fc
  .record({
    category_id: fc.option(arbCategoryId, { nil: null }),
    source: fc.constantFrom<'manual' | 'rule'>('manual', 'rule'),
    rule_id: fc.option(fc.constantFrom('r1', 'r2', 'r3'), { nil: undefined }),
    note: fc.option(fc.constantFrom('', 'my note', 'rent'), { nil: undefined }),
    tags: fc.option(fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 3 }), {
      nil: undefined
    }),
    ignored: fc.option(fc.boolean(), { nil: undefined }),
    custom_name: fc.option(fc.constantFrom('', 'Landlord'), { nil: undefined }),
    is_recurring: fc.option(fc.boolean(), { nil: undefined }),
    refund_of: fc.option(fc.constantFrom('', 'key-orig'), { nil: undefined }),
    split: fc.option(fc.array(arbSplit, { maxLength: 2 }), { nil: undefined })
  })
  .map((a) => {
    const ann: TransactionAnnotation = { category_id: a.category_id, source: a.source };
    // rule_id is only meaningful for source:'rule'
    if (a.source === 'rule' && a.rule_id !== undefined) ann.rule_id = a.rule_id;
    if (a.note !== undefined) ann.note = a.note;
    if (a.tags !== undefined) ann.tags = a.tags;
    if (a.ignored !== undefined) ann.ignored = a.ignored;
    if (a.custom_name !== undefined) ann.custom_name = a.custom_name;
    if (a.is_recurring !== undefined) ann.is_recurring = a.is_recurring;
    if (a.refund_of !== undefined) ann.refund_of = a.refund_of;
    if (a.split !== undefined) ann.split = a.split;
    return ann;
  });

const arbKey = fc.constantFrom('k0', 'k1', 'k2', 'k3', 'k4');

const arbExisting: fc.Arbitrary<Map<string, TransactionAnnotation>> = fc
  .array(fc.tuple(arbKey, arbAnnotation), { maxLength: 6 })
  .map((pairs) => new Map(pairs));

const arbTransactions: fc.Arbitrary<CategorizableTransaction[]> = fc
  .array(fc.tuple(arbKey, arbDescription), { maxLength: 6 })
  .map((pairs) => {
    // dedupe keys so the batch is well-shaped (one txn per key)
    const seen = new Set<string>();
    const out: CategorizableTransaction[] = [];
    for (const [key, description] of pairs) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, description });
    }
    return out;
  });

// Snapshot a map for purity comparison (bigint-safe).
function snapshot(m: ReadonlyMap<string, TransactionAnnotation>): string {
  return JSON.stringify(
    [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)
  );
}

// =============================================================================
// FUNCTIONAL COVERAGE PLAN (vplan cover points -> R#/INV# traceability)
// =============================================================================
const cov = new CoverageModel([
  // R1 / matchRule
  'R1:contains-match',
  'R1:contains-no-match',
  'R1:regex-match',
  'R1:regex-no-match',
  'R1:empty-contains-nomatch', // empty-pattern tag-everything probe
  'R1:empty-object-nomatch',
  'R1:invalid-regex-false',
  'R1:case-insensitive-default',
  'R1:case-sensitive-true',
  'R1:regex-precedence-over-contains',
  // R2 / firstMatchingRule
  'R2:first-of-two-wins',
  'R2:disabled-skipped',
  'R2:enabled-undefined-is-enabled',
  'R2:all-disabled-null',
  'R2:empty-list-null',
  'R2:no-match-null',
  // applyRules
  'apply:manual-sticks-over-rule', // INV1
  'apply:rule-assigned', // R3
  'apply:rule-recomputed-lost', // R5
  'apply:extras-kept-no-rule', // R6
  'apply:extras-kept-with-rule', // R6
  'apply:extras-out-of-batch-carried', // R6
  'apply:empty-dropped', // R7
  'apply:empty-rules',
  'apply:empty-txns',
  // CRUD
  'setManual:set',
  'setManual:clear-null',
  'setAnnotation:merge-existing',
  'setAnnotation:merge-absent',
  'prune:all-empty-null',
  'prune:lone-ignored-kept',
  'delete:manual-keeps-extras-null',
  'delete:rule-only-dropped',
  'delete:rule-plus-extras-kept',
  'delete:unrelated-untouched'
]);

// =============================================================================
// STAGE 1 — matchRule (R1, INV5)
// =============================================================================
describe('R1 / INV5 — matchRule (description-only, scoreboard vs ref)', () => {
  test('scoreboard: DUT matchRule == independent ref over constrained-random', () => {
    const sb = new Scoreboard<{ rule: CategoryRule; desc: string }, boolean>({
      dut: ({ rule, desc }) => matchRule(rule, desc),
      model: ({ rule, desc }) => refMatchRule(rule, desc),
      show: ({ rule, desc }) => `rule=${JSON.stringify(rule)} desc=${JSON.stringify(desc)}`
    });
    fc.assert(
      fc.property(arbRule, arbDescription, (rule, desc) => {
        const r = matchRule(rule, desc); // must never throw
        cov.coverIf(r && rule.regex === undefined, 'R1:contains-match');
        cov.coverIf(
          !r && rule.contains !== undefined && rule.contains !== '',
          'R1:contains-no-match'
        );
        cov.coverIf(r && rule.regex !== undefined && rule.regex !== '', 'R1:regex-match');
        cov.coverIf(rule.case_sensitive === true, 'R1:case-sensitive-true');
        cov.coverIf(rule.case_sensitive !== true, 'R1:case-insensitive-default');
        sb.check({ rule, desc });
        return true;
      }),
      { numRuns: 600 }
    );
    sb.assertClean();
  });

  test('empty pattern matches NOTHING (the tag-everything bug)', () => {
    const desc = 'AMAZON MARKETPLACE';
    expect(matchRule({ id: 'e1', contains: '', category_id: 'c' }, desc)).toBe(false);
    cov.cover('R1:empty-contains-nomatch');
    expect(matchRule({ id: 'e2', regex: '', category_id: 'c' }, desc)).toBe(false);
    expect(matchRule({ id: 'e3', category_id: 'c' }, desc)).toBe(false); // {} pattern
    cov.cover('R1:empty-object-nomatch');
    // even an empty description must not be tagged by an empty pattern
    expect(matchRule({ id: 'e4', category_id: 'c' }, '')).toBe(false);
  });

  test('invalid regex returns false, never throws', () => {
    const bad = ['[(', '(', '*abc', 'a{', '\\'];
    for (const rx of bad) {
      let threw = false;
      let res = true;
      try {
        res = matchRule({ id: 'b', regex: rx, category_id: 'c' }, 'anything (abc');
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(res).toBe(false);
    }
    cov.cover('R1:invalid-regex-false');
  });

  test('case sensitivity both directions', () => {
    // default (case-insensitive)
    expect(matchRule({ id: 'c1', contains: 'amazon', category_id: 'c' }, 'AMAZON')).toBe(true);
    expect(matchRule({ id: 'c2', regex: 'amazon', category_id: 'c' }, 'AMAZON')).toBe(true);
    // case_sensitive: true
    expect(
      matchRule({ id: 'c3', contains: 'amazon', case_sensitive: true, category_id: 'c' }, 'AMAZON')
    ).toBe(false);
    expect(
      matchRule({ id: 'c4', contains: 'AMAZON', case_sensitive: true, category_id: 'c' }, 'AMAZON')
    ).toBe(true);
    expect(
      matchRule({ id: 'c5', regex: 'amazon', case_sensitive: true, category_id: 'c' }, 'AMAZON')
    ).toBe(false);
    cov.cover('R1:case-sensitive-true');
    cov.cover('R1:case-insensitive-default');
  });

  test('regex takes precedence over contains', () => {
    // contains would NOT match, regex WOULD => result follows regex (true)
    expect(
      matchRule({ id: 'p1', contains: 'NOPE_NEVER', regex: 'amazon', category_id: 'c' }, 'AMAZON')
    ).toBe(true);
    // contains WOULD match, regex would NOT => result follows regex (false)
    expect(
      matchRule({ id: 'p2', contains: 'AMAZON', regex: '^ZZZ$', category_id: 'c' }, 'AMAZON')
    ).toBe(false);
    cov.cover('R1:regex-precedence-over-contains');
  });

  test('regex match / no-match directed', () => {
    expect(matchRule({ id: 'rm1', regex: 'foods?', category_id: 'c' }, 'WHOLE FOODS')).toBe(true);
    cov.cover('R1:regex-match');
    expect(matchRule({ id: 'rm2', regex: '^NETFLIX', category_id: 'c' }, 'PAY NETFLIX')).toBe(
      false
    );
    cov.cover('R1:regex-no-match');
    expect(matchRule({ id: 'rm3', contains: 'xyz', category_id: 'c' }, 'vendor xyz')).toBe(true);
    cov.cover('R1:contains-match');
    expect(matchRule({ id: 'rm4', contains: 'AMAZON', category_id: 'c' }, 'STARBUCKS')).toBe(false);
    cov.cover('R1:contains-no-match');
  });
});

// =============================================================================
// STAGE 1 — firstMatchingRule (R2, INV6)
// =============================================================================
describe('R2 / INV6 — firstMatchingRule (precedence + enabled inversion)', () => {
  test('scoreboard: DUT == independent ref over constrained-random', () => {
    const sb = new Scoreboard<{ rules: CategoryRule[]; desc: string }, CategoryRule | null>({
      dut: ({ rules, desc }) => firstMatchingRule(rules, desc),
      model: ({ rules, desc }) => refFirstMatchingRule(rules, desc),
      show: ({ rules, desc }) => `rules=${JSON.stringify(rules)} desc=${JSON.stringify(desc)}`
    });
    fc.assert(
      fc.property(arbRules, arbDescription, (rules, desc) => {
        const got = firstMatchingRule(rules, desc);
        // INV6: returned rule (if any) is enabled and actually matches
        if (got !== null) {
          expect(got.enabled).not.toBe(false);
          expect(matchRule(got, desc)).toBe(true);
        }
        cov.coverIf(rules.length === 0, 'R2:empty-list-null');
        cov.coverIf(got === null && rules.length > 0, 'R2:no-match-null');
        sb.check({ rules, desc });
        return true;
      }),
      { numRuns: 600 }
    );
    sb.assertClean();
  });

  test('first of two matching rules wins', () => {
    const rules: CategoryRule[] = [
      { id: 'a', contains: 'AMAZON', category_id: 'cat-1' },
      { id: 'b', contains: 'AMAZON', category_id: 'cat-2' }
    ];
    expect(firstMatchingRule(rules, 'AMAZON')?.id).toBe('a');
    cov.cover('R2:first-of-two-wins');
  });

  test('disabled first rule is skipped; second wins', () => {
    const rules: CategoryRule[] = [
      { id: 'a', contains: 'AMAZON', category_id: 'cat-1', enabled: false },
      { id: 'b', contains: 'AMAZON', category_id: 'cat-2' }
    ];
    expect(firstMatchingRule(rules, 'AMAZON')?.id).toBe('b');
    cov.cover('R2:disabled-skipped');
  });

  test('enabled===undefined is ENABLED (inversion probe)', () => {
    const rules: CategoryRule[] = [{ id: 'a', contains: 'AMAZON', category_id: 'cat-1' }];
    expect(firstMatchingRule(rules, 'AMAZON')?.id).toBe('a');
    cov.cover('R2:enabled-undefined-is-enabled');
  });

  test('all matching rules disabled => null', () => {
    const rules: CategoryRule[] = [
      { id: 'a', contains: 'AMAZON', category_id: 'cat-1', enabled: false },
      { id: 'b', contains: 'AMAZON', category_id: 'cat-2', enabled: false }
    ];
    expect(firstMatchingRule(rules, 'AMAZON')).toBeNull();
    cov.cover('R2:all-disabled-null');
  });

  test('empty rules list => null', () => {
    expect(firstMatchingRule([], 'AMAZON')).toBeNull();
    cov.cover('R2:empty-list-null');
  });
});

// =============================================================================
// STAGE 1 — applyRules: the HEADLINE safety invariants (INV1, INV2) + R3/R5/R7
// =============================================================================
describe('applyRules — INV1 manual immortal, INV2 extras survive (oracle-free)', () => {
  test('INV1: every manual category is preserved verbatim, in ANY rule config', () => {
    fc.assert(
      fc.property(arbRules, arbTransactions, arbExisting, (rules, txns, existing) => {
        const before = new Map(existing);
        const out = applyRules(rules, txns, existing);
        // INV4 purity: input map not mutated
        expect(snapshot(existing)).toBe(snapshot(before));
        for (const [k, ann] of existing) {
          if (isManualCat(ann)) {
            const o = out.get(k);
            expect(o, `manual key ${k} must survive`).toBeDefined();
            // category + source preserved verbatim
            expect(o!.category_id).toBe(ann.category_id);
            expect(o!.source).toBe('manual');
            // extras preserved verbatim
            expect(extrasEqual(o!, ann)).toBe(true);
            cov.cover('apply:manual-sticks-over-rule');
          }
        }
        return true;
      }),
      { numRuns: 800 }
    );
  });

  test('INV2: user extras survive applyRules (rule/manual/no-match)', () => {
    fc.assert(
      fc.property(arbRules, arbTransactions, arbExisting, (rules, txns, existing) => {
        const out = applyRules(rules, txns, existing);
        for (const [k, ann] of existing) {
          if (hasNonEmptyExtras(ann)) {
            const o = out.get(k);
            // An entry carrying extras must still exist and still carry them.
            expect(o, `extras key ${k} must survive`).toBeDefined();
            expect(extrasEqual(o!, ann), `extras for ${k} must be preserved`).toBe(true);
            const inBatch = txns.some((t) => t.key === k);
            cov.coverIf(inBatch, 'apply:extras-kept-no-rule');
            cov.coverIf(!inBatch, 'apply:extras-out-of-batch-carried');
          }
        }
        return true;
      }),
      { numRuns: 800 }
    );
  });

  test('INV3: idempotence — applyRules(applyRules(x)) == applyRules(x)', () => {
    fc.assert(
      fc.property(arbRules, arbTransactions, arbExisting, (rules, txns, existing) => {
        const once = applyRules(rules, txns, existing);
        const twice = applyRules(rules, txns, once);
        expect(snapshot(twice)).toBe(snapshot(once));
        return true;
      }),
      { numRuns: 600 }
    );
  });

  test('R3 + extras-kept-with-rule: matching rule assigns rule category, extras kept', () => {
    const rules: CategoryRule[] = [{ id: 'r-shop', contains: 'AMAZON', category_id: 'cat-shop' }];
    const txns: CategorizableTransaction[] = [{ key: 'k1', description: 'AMAZON MARKETPLACE' }];
    const existing = new Map<string, TransactionAnnotation>([
      ['k1', { category_id: null, source: 'manual', note: 'keep me', tags: ['x'] }]
    ]);
    const out = applyRules(rules, txns, existing);
    const o = out.get('k1');
    expect(o).toBeDefined();
    expect(o!.category_id).toBe('cat-shop');
    expect(o!.source).toBe('rule');
    expect(o!.note).toBe('keep me');
    expect(o!.tags).toEqual(['x']);
    cov.cover('apply:rule-assigned');
    cov.cover('apply:extras-kept-with-rule');
  });

  test('R5: a previously rule-categorized txn that now matches nothing LOSES its category', () => {
    const rules: CategoryRule[] = []; // no rules => nothing matches
    const txns: CategorizableTransaction[] = [{ key: 'k1', description: 'AMAZON MARKETPLACE' }];
    const existing = new Map<string, TransactionAnnotation>([
      ['k1', { category_id: 'cat-shop', source: 'rule', rule_id: 'old' }]
    ]);
    const out = applyRules(rules, txns, existing);
    // rule label not sticky, no extras => dropped entirely (R7) OR cleared to null.
    const o = out.get('k1');
    if (o !== undefined) {
      expect(o.category_id).toBeNull();
    }
    // The previous rule category must NOT survive.
    expect(o?.category_id ?? null).toBeNull();
    cov.cover('apply:rule-recomputed-lost');
    cov.cover('apply:empty-rules');
  });

  test('R7: no manual cat + no matching rule + no extras => NO output entry', () => {
    const rules: CategoryRule[] = [{ id: 'r1', contains: 'NETFLIX', category_id: 'cat-fun' }];
    const txns: CategorizableTransaction[] = [{ key: 'k1', description: 'STARBUCKS' }];
    const out = applyRules(rules, txns, new Map());
    expect(out.has('k1')).toBe(false);
    cov.cover('apply:empty-dropped');
  });

  test('R5 + R7 property: rule-only annotation that no longer matches yields no surviving rule cat', () => {
    fc.assert(
      fc.property(arbRules, arbTransactions, arbExisting, (rules, txns, existing) => {
        const out = applyRules(rules, txns, existing);
        for (const t of txns) {
          const prev = existing.get(t.key);
          const matched = refFirstMatchingRule(rules, t.description);
          const prevManual = prev !== undefined && isManualCat(prev);
          if (!prevManual && matched === null) {
            // no manual, no current match => no rule-sourced category may appear
            const o = out.get(t.key);
            if (o !== undefined) {
              // any surviving entry must be a non-rule category (null), kept only for extras
              expect(o.category_id).toBeNull();
            }
          }
        }
        return true;
      }),
      { numRuns: 600 }
    );
  });

  test('empty txns => entries are carried over (out-of-batch extras), no rule applied', () => {
    const rules: CategoryRule[] = [{ id: 'r1', contains: 'AMAZON', category_id: 'cat-shop' }];
    const existing = new Map<string, TransactionAnnotation>([
      ['k-old', { category_id: 'cat-food', source: 'manual', note: 'lunch' }]
    ]);
    const out = applyRules(rules, [], existing);
    const o = out.get('k-old');
    expect(o).toBeDefined();
    expect(o!.category_id).toBe('cat-food');
    expect(o!.note).toBe('lunch');
    cov.cover('apply:empty-txns');
    cov.cover('apply:extras-out-of-batch-carried');
  });
});

// =============================================================================
// STAGE 1 — CRUD: setManualCategory (R8), setAnnotation (R9), purity (INV4)
// =============================================================================
describe('R8/R9/INV4 — setManualCategory + setAnnotation purity & merge', () => {
  test('R8: setManualCategory sets manual category, preserves extras, new map', () => {
    const before = new Map<string, TransactionAnnotation>([
      ['k1', { category_id: 'cat-food', source: 'rule', rule_id: 'r', note: 'n', tags: ['t'] }]
    ]);
    const snap = snapshot(before);
    const out = setManualCategory(before, 'k1', 'cat-shop');
    expect(out).not.toBe(before);
    expect(snapshot(before)).toBe(snap); // INV4 purity
    const o = out.get('k1');
    expect(o!.category_id).toBe('cat-shop');
    expect(o!.source).toBe('manual');
    expect(o!.note).toBe('n');
    expect(o!.tags).toEqual(['t']);
    cov.cover('setManual:set');
  });

  test('R8: setManualCategory with null clears category (still manual)', () => {
    const before = new Map<string, TransactionAnnotation>([
      ['k1', { category_id: 'cat-food', source: 'manual', note: 'n' }]
    ]);
    const out = setManualCategory(before, 'k1', null);
    const o = out.get('k1');
    expect(o!.category_id).toBeNull();
    expect(o!.source).toBe('manual');
    expect(o!.note).toBe('n'); // extras preserved
    cov.cover('setManual:clear-null');
  });

  test('R9: setAnnotation merges patch onto existing', () => {
    const before = new Map<string, TransactionAnnotation>([
      ['k1', { category_id: 'cat-food', source: 'manual', note: 'old' }]
    ]);
    const snap = snapshot(before);
    const out = setAnnotation(before, 'k1', { note: 'new', tags: ['x'] });
    expect(snapshot(before)).toBe(snap); // purity
    const o = out.get('k1');
    expect(o!.note).toBe('new');
    expect(o!.tags).toEqual(['x']);
    expect(o!.category_id).toBe('cat-food'); // untouched field stays
    cov.cover('setAnnotation:merge-existing');
  });

  test('R9: setAnnotation on absent key creates from a default', () => {
    const before = new Map<string, TransactionAnnotation>();
    const out = setAnnotation(before, 'k-new', { ignored: true });
    const o = out.get('k-new');
    expect(o).toBeDefined();
    expect(o!.ignored).toBe(true);
    cov.cover('setAnnotation:merge-absent');
  });
});

// =============================================================================
// STAGE 1 — pruneAnnotation (R10)
// =============================================================================
describe('R10 — pruneAnnotation', () => {
  test('all-empty uncategorized manual => null', () => {
    const empties: TransactionAnnotation[] = [
      { category_id: null, source: 'manual' },
      {
        category_id: null,
        source: 'manual',
        note: '',
        tags: [],
        custom_name: '',
        refund_of: '',
        split: []
      },
      { category_id: null, source: 'manual', ignored: false, is_recurring: false }
    ];
    for (const a of empties) {
      expect(pruneAnnotation(a)).toBeNull();
    }
    cov.cover('prune:all-empty-null');
  });

  test('a lone ignored:true is KEPT', () => {
    const a: TransactionAnnotation = { category_id: null, source: 'manual', ignored: true };
    const out = pruneAnnotation(a);
    expect(out).not.toBeNull();
    expect(out!.ignored).toBe(true);
    cov.cover('prune:lone-ignored-kept');
  });

  test('a category-bearing annotation is kept', () => {
    const a: TransactionAnnotation = { category_id: 'cat-food', source: 'manual' };
    expect(pruneAnnotation(a)).not.toBeNull();
  });
});

// =============================================================================
// STAGE 1 — deleteCategory (R11, INV7)
// =============================================================================
describe('R11 / INV7 — deleteCategory removes dangling references', () => {
  test('manual->null keep extras; rule-only dropped; rule+extras kept; unrelated untouched', () => {
    const categories: Category[] = [
      { id: 'cat-shop', name: 'Shopping' },
      { id: 'cat-food', name: 'Food' }
    ];
    const annotations = new Map<string, TransactionAnnotation>([
      ['k-man', { category_id: 'cat-shop', source: 'manual', note: 'keep' }],
      ['k-rule', { category_id: 'cat-shop', source: 'rule', rule_id: 'r1' }],
      ['k-rule-extra', { category_id: 'cat-shop', source: 'rule', rule_id: 'r1', tags: ['t'] }],
      ['k-other', { category_id: 'cat-food', source: 'manual', note: 'other' }]
    ]);
    const snap = snapshot(annotations);
    const out = deleteCategory(categories, annotations, 'cat-shop');

    // category gone from list
    expect(out.categories.find((c) => c.id === 'cat-shop')).toBeUndefined();
    expect(out.categories.find((c) => c.id === 'cat-food')).toBeDefined();

    // purity: inputs untouched
    expect(snapshot(annotations)).toBe(snap);

    // manual pointing at deleted => null category, keep extras
    const man = out.annotations.get('k-man');
    expect(man).toBeDefined();
    expect(man!.category_id).toBeNull();
    expect(man!.note).toBe('keep');
    cov.cover('delete:manual-keeps-extras-null');

    // rule-only pointing at deleted => dropped
    expect(out.annotations.has('k-rule')).toBe(false);
    cov.cover('delete:rule-only-dropped');

    // rule + extras => kept with null category, extras intact
    const re = out.annotations.get('k-rule-extra');
    expect(re).toBeDefined();
    expect(re!.category_id).toBeNull();
    expect(re!.tags).toEqual(['t']);
    cov.cover('delete:rule-plus-extras-kept');

    // unrelated annotation untouched
    const other = out.annotations.get('k-other');
    expect(other!.category_id).toBe('cat-food');
    expect(other!.note).toBe('other');
    cov.cover('delete:unrelated-untouched');

    // INV7: no annotation anywhere points at the deleted id
    for (const [, a] of out.annotations) {
      expect(a.category_id).not.toBe('cat-shop');
    }
  });

  test('INV7 property: no dangling reference after delete, purity holds', () => {
    fc.assert(
      fc.property(arbExisting, arbCategoryId, (existing, delId) => {
        const cats: Category[] = [
          { id: 'cat-shop', name: 'Shopping' },
          { id: 'cat-food', name: 'Food' },
          { id: 'cat-bills', name: 'Bills' },
          { id: 'cat-fun', name: 'Fun' }
        ];
        const snap = snapshot(existing);
        const out = deleteCategory(cats, existing, delId);
        // purity
        expect(snapshot(existing)).toBe(snap);
        // no dangling reference
        for (const [, a] of out.annotations) {
          expect(a.category_id).not.toBe(delId);
        }
        // category removed from list
        expect(out.categories.find((c) => c.id === delId)).toBeUndefined();
        return true;
      }),
      { numRuns: 400 }
    );
  });
});

// =============================================================================
// transactionCategoryKey — stable key (used by all downstream maps)
// =============================================================================
describe('transactionCategoryKey — deterministic + injective', () => {
  test('deterministic and distinguishes hash & index', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(10000), fc.string(), fc.nat(10000), (h1, i1, h2, i2) => {
        // determinism
        expect(transactionCategoryKey(h1, i1)).toBe(transactionCategoryKey(h1, i1));
        // injective on (hash,index): different inputs => different keys
        if (h1 !== h2 || i1 !== i2) {
          expect(transactionCategoryKey(h1, i1)).not.toBe(transactionCategoryKey(h2, i2));
        }
        return true;
      }),
      { numRuns: 300 }
    );
  });
});

// =============================================================================
// Bench-has-teeth: confirm the scoreboard FAILS when the reference model is
// corrupted (self-mutation). Proves the matchRule scoreboard isn't vacuous.
// =============================================================================
describe('fault injection — scoreboard teeth (self-mutation of ref model)', () => {
  test('a corrupted matchRule ref disagrees with the DUT (scoreboard catches it)', () => {
    // Mutant: invert the empty-pattern rule (tag-everything bug) in the model.
    const mutantRef = (rule: CategoryRule, desc: string): boolean => {
      const noPattern =
        (rule.regex === undefined || rule.regex === '') &&
        (rule.contains === undefined || rule.contains === '');
      if (noPattern) return true; // BUG injected: empty pattern matches everything
      return refMatchRule(rule, desc);
    };
    const sb = new Scoreboard<{ rule: CategoryRule; desc: string }, boolean>({
      dut: ({ rule, desc }) => matchRule(rule, desc),
      model: ({ rule, desc }) => mutantRef(rule, desc)
    });
    // Drive an empty-pattern rule against any description.
    sb.check({ rule: { id: 'x', contains: '', category_id: 'c' }, desc: 'AMAZON' });
    sb.check({ rule: { id: 'y', category_id: 'c' }, desc: 'anything' });
    let caught = false;
    try {
      sb.assertClean();
    } catch {
      caught = true;
    }
    expect(caught, 'scoreboard must FAIL against a corrupted ref => bench has teeth').toBe(true);
  });
});

// =============================================================================
// Functional coverage closure gate (sign-off)
// =============================================================================
describe('functional coverage closure', () => {
  test('all planned cover points hit', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
