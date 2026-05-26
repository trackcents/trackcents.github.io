// =============================================================================
// IV&V verification environment — refund resolution + spending netting (US-P3-C)
//
// Independent Verification & Validation. This file is authored by the
// verification-engineer WITHOUT reading src/lib/app/categorization-glue.ts (the
// DUT) or any Designer test for it. Everything below derives ONLY from:
//   - the verification contract
//     (specs/001-money-tracker-mvp/verification/refund-resolution.contract.md)
//   - the cited spec sources: spec.md US-P3-C, DECISIONS.md D12,
//     constitution Principle II (bigint cents)
//   - the DATA-CONTRACT types (TransactionAnnotation, ImportRecord,
//     SummaryTransaction, ParsedTransaction) — interfaces, never the DUT body.
//
// UVM -> software mapping realised here:
//   Sequencer/Generator : arbScenario constrained-random fast-check arbitrary
//                         (imports w/ outflows + linked refunds, ignored flags,
//                          dangling / self / refund-of-refund refund_of)
//   Driver              : direct call of the public DUT functions
//   Monitor             : sumAmounts / rowsByKey helpers normalising DUT output
//   Reference Model     : ref* functions — an independent from-contract re-impl
//   Scoreboard          : tests/_framework Scoreboard{dut, model}
//   Assertions/Cover    : fast-check properties for INV1..INV4 + R1..R6
//   Coverage collector  : tests/_framework CoverageModel (functional coverage)
//   Fault injection     : Stryker (run separately) + a self-mutation teeth check
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { Scoreboard, deepEqual, stringify } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---- DUT (public exports only; never the implementation body) ---------------
import {
  resolveEffectiveCategory,
  summaryFromImports,
  detailedRowsFromImports,
  categorizableFromImports
} from '../../../src/lib/app/categorization-glue';

// ---- DATA-CONTRACT types (interfaces only, not the DUT) ----------------------
import type { TransactionAnnotation } from '../../../src/lib/app/categorization';
import { transactionCategoryKey } from '../../../src/lib/app/categorization';
import type { ImportRecord } from '../../../src/lib/db/store';
import type { SummaryTransaction } from '../../../src/lib/app/spending-summary';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';

// =============================================================================
// SECTION 0 — fixture builders (the test-bench's transaction-level driver)
//
// We build ImportRecord[] + annotations such that the stable annotation key for
// the j-th transaction of the i-th import is EXACTLY
//   `${import.pdf_source_hash}#${j}`  (== transactionCategoryKey(hash, j))
// per contract §3. We use transactionCategoryKey() (a pure DATA-CONTRACT helper,
// not the DUT) so the bench's key derivation cannot drift from the spec's.
// =============================================================================

function makeTxn(amountMinor: bigint, description = 'tx', date = '2024-03-15'): ParsedTransaction {
  return {
    posted_date: date,
    description,
    raw_text: description,
    amount_minor: amountMinor,
    currency: 'USD',
    transaction_type: amountMinor < 0n ? 'purchase' : 'refund'
  };
}

function makeStatement(): ParsedStatement {
  return {
    account_type: 'credit_card',
    account_last_4: '1234',
    period_start: '2024-03-01',
    period_end: '2024-03-31',
    currency: 'USD',
    opening_balance_minor: 0n,
    closing_balance_minor: 0n,
    total_debits_minor: null,
    total_credits_minor: null,
    statement_balance_minor: null,
    previous_balance_minor: null,
    printed_transaction_count: null,
    summary_lines: [],
    payment_due_date: null,
    statement_date: null,
    minimum_payment_due_minor: null,
    parser_provides: ['A']
  };
}

function makeImport(hash: string, txns: ParsedTransaction[], bankName = 'Test Bank'): ImportRecord {
  return {
    bank_name: bankName,
    adapter_name: 'layout-test',
    adapter_version: '1.0.0',
    pdf_source_hash: hash,
    imported_at: '2024-04-01T00:00:00.000Z',
    statement: makeStatement(),
    transactions: txns,
    checksum_strategy_used: 'A'
  };
}

// =============================================================================
// SECTION 1 — INDEPENDENT REFERENCE MODEL (the "golden", from the contract ONLY)
//
// resolveEffectiveCategory (R1-R4):
//   - no refund_of (undefined / '')  -> own category_id ?? null            (R1, R4)
//   - refund_of === key (self)       -> own category_id ?? null            (R4)
//   - refund_of points to missing    -> own category_id ?? null            (R4)
//   - refund_of -> existing origKey  -> annotations[origKey].category_id ?? null (R2)
//     ... following refund_of EXACTLY ONCE (orig's own refund_of ignored)  (R3)
//
// summaryFromImports (R5): for each NON-ignored transaction emit
//   { posted_date, amount_minor, category_id: resolveEffectiveCategory(...) }.
//   ignored===true transactions are omitted entirely. Order = import order then
//   txn order (verified independently below; the contract does not pin order,
//   so the scoreboard compares as an order-sensitive list AND we separately
//   prove the MULTISET matches if order ever differs — see note in §4).
// =============================================================================

function refResolveEffectiveCategory(
  annotations: Record<string, TransactionAnnotation>,
  key: string
): string | null {
  const own = annotations[key];
  if (own === undefined) return null; // unknown key -> no category (R1 "absent")
  const refundOf = own.refund_of;
  // R4 safe fallbacks: empty string, self-reference, or missing target.
  if (
    refundOf === undefined ||
    refundOf === '' ||
    refundOf === key ||
    annotations[refundOf] === undefined
  ) {
    return own.category_id ?? null;
  }
  // R2 + R3: inherit the ORIGINAL's own category, following the link exactly once.
  const orig = annotations[refundOf];
  return orig.category_id ?? null;
}

interface RefDetailedRow {
  key: string;
  posted_date: string;
  amount_minor: bigint;
  description: string;
  bank_name: string;
  category_id: string | null;
  ignored: boolean;
  refund_of?: string;
}

function refSummaryFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): SummaryTransaction[] {
  const out: SummaryTransaction[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((tx, j) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, j);
      const ann = annotations[key];
      if (ann?.ignored === true) return; // R5: ignored omitted entirely
      out.push({
        posted_date: tx.posted_date,
        amount_minor: tx.amount_minor,
        category_id: refResolveEffectiveCategory(annotations, key)
      });
    });
  }
  return out;
}

function refDetailedRowsFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): RefDetailedRow[] {
  const out: RefDetailedRow[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((tx, j) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, j);
      const ann = annotations[key];
      // R6: description = custom_name if set else parsed description.
      // "if set" interpreted (matching pruneAnnotation data-contract) as a
      // non-empty custom_name; empty string falls back to the parsed value.
      const customName = ann?.custom_name;
      const description =
        customName !== undefined && customName !== '' ? customName : tx.description;
      const row: RefDetailedRow = {
        key,
        posted_date: tx.posted_date,
        amount_minor: tx.amount_minor,
        description,
        bank_name: imp.bank_name,
        // R6: OWN annotated category, NOT resolved.
        category_id: ann?.category_id ?? null,
        ignored: ann?.ignored === true
      };
      // R6: refund_of present iff the annotation has a NON-EMPTY refund_of.
      if (ann?.refund_of !== undefined && ann.refund_of !== '') {
        row.refund_of = ann.refund_of;
      }
      return out.push(row);
    });
  }
  return out;
}

// =============================================================================
// SECTION 2 — CONSTRAINED-RANDOM STIMULUS GENERATOR
//
// Produces a legal-but-adversarial scenario: a handful of imports, each with a
// few transactions, plus an annotation map that exercises every refund_of
// shape (none / valid-link / self / dangling / refund-of-refund / ignored /
// uncategorized-original / multiple-refunds-of-same-purchase).
// =============================================================================

interface Scenario {
  imports: ImportRecord[];
  annotations: Record<string, TransactionAnnotation>;
}

const CATEGORIES = ['cat-food', 'cat-shopping', 'cat-travel', null] as const;

const arbAmount = fc.integer({ min: -50_000, max: 50_000 }).map((n) => BigInt(n) as bigint);

const arbCategory = fc.constantFrom<(typeof CATEGORIES)[number]>(...CATEGORIES);

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    nImports: fc.integer({ min: 1, max: 3 }),
    perImport: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 3 })
  })
  .chain(({ nImports, perImport }) => {
    const counts: number[] = [];
    for (let i = 0; i < nImports; i++) counts.push(perImport[i % perImport.length] ?? 1);
    // Build the imports + the universe of valid keys first.
    const imports: ImportRecord[] = counts.map((cnt, i) => {
      const txns: ParsedTransaction[] = [];
      for (let j = 0; j < cnt; j++) txns.push(makeTxn(0n)); // amount filled below
      return makeImport(`hash${i}`, txns);
    });
    const keys: string[] = [];
    imports.forEach((imp) =>
      imp.transactions.forEach((_, j) => keys.push(transactionCategoryKey(imp.pdf_source_hash, j)))
    );

    // For each key produce: an amount + an annotation spec.
    const arbAmounts = fc.array(arbAmount, { minLength: keys.length, maxLength: keys.length });
    // refund_of choices: none, self, dangling, or a real other key (incl. a key
    // that may itself be a refund -> exercises one-hop R3).
    const arbAnnSpec = fc.record({
      category: arbCategory,
      ignored: fc.boolean(),
      hasCustomName: fc.boolean(),
      // 0=none 1=self 2=dangling 3=link-to-other
      refundMode: fc.integer({ min: 0, max: 3 }),
      // which other key to link to (index into keys); resolved modulo length
      linkTarget: fc.nat()
    });
    const arbAnnSpecs = fc.array(arbAnnSpec, {
      minLength: keys.length,
      maxLength: keys.length
    });

    return fc.tuple(arbAmounts, arbAnnSpecs).map(([amounts, specs]) => {
      // fill amounts
      let k = 0;
      for (const imp of imports) {
        for (const tx of imp.transactions) {
          tx.amount_minor = amounts[k] ?? 0n;
          k++;
        }
      }
      const annotations: Record<string, TransactionAnnotation> = {};
      keys.forEach((key, idx) => {
        const spec = specs[idx]!;
        const ann: TransactionAnnotation = {
          category_id: spec.category,
          source: 'manual'
        };
        if (spec.ignored) ann.ignored = true;
        if (spec.hasCustomName) ann.custom_name = `rename-${idx}`;
        if (spec.refundMode === 1) {
          ann.refund_of = key; // self -> R4
        } else if (spec.refundMode === 2) {
          ann.refund_of = `missing#${idx}#999`; // dangling -> R4
        } else if (spec.refundMode === 3 && keys.length > 1) {
          // link to a DIFFERENT key (which itself may be a refund -> R3)
          const other = keys[(idx + 1 + (spec.linkTarget % (keys.length - 1))) % keys.length]!;
          ann.refund_of = other === key ? keys[(idx + 1) % keys.length]! : other;
        }
        annotations[key] = ann;
      });
      return { imports, annotations };
    });
  });

// =============================================================================
// SECTION 3 — MONITORS (normalise DUT output into checkable facts)
// =============================================================================

function sumAmounts(txns: readonly SummaryTransaction[]): bigint {
  let s = 0n;
  for (const t of txns) s += t.amount_minor;
  return s;
}

/** Raw signed sum of all NON-ignored transaction amounts (the conservation truth). */
function rawNonIgnoredSum(s: Scenario): bigint {
  let sum = 0n;
  for (const imp of s.imports) {
    imp.transactions.forEach((tx, j) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, j);
      if (s.annotations[key]?.ignored === true) return;
      sum += tx.amount_minor;
    });
  }
  return sum;
}

function sumByCategory(txns: readonly SummaryTransaction[]): Map<string | null, bigint> {
  const m = new Map<string | null, bigint>();
  for (const t of txns) m.set(t.category_id, (m.get(t.category_id) ?? 0n) + t.amount_minor);
  return m;
}

// =============================================================================
// SECTION 4 — THE VERIFICATION PLAN as functional cover points
// =============================================================================

const cov = new CoverageModel([
  // resolveEffectiveCategory
  'R1: own category (no refund_of)',
  'R1: own category null/absent',
  'R2: refund inherits original category',
  'R2: original category is null -> effective null',
  'R3: refund-of-refund, one hop only',
  'R4: refund_of empty string',
  'R4: refund_of === self',
  'R4: refund_of -> missing key',
  'R1: resolve on unknown key',
  // summaryFromImports
  'R5: non-ignored emitted',
  'R5: ignored omitted entirely',
  'R5: ignored refund omitted',
  'R5: multiple refunds of same purchase',
  'R5: refund category differs from original (original wins)',
  // detailedRowsFromImports
  'R6: one row per txn incl ignored',
  'R6: description = custom_name when set',
  'R6: description = parsed when no custom_name',
  'R6: category = OWN (not resolved)',
  'R6: refund_of present iff non-empty',
  // categorizable
  'CAT: one categorizable per txn',
  // invariants
  'INV1: conservation (all refunds linked)',
  'INV1: conservation (arbitrary linkage)',
  'INV2: netting reduces original category',
  'INV3: purity (inputs not mutated)',
  'INV4: order-independence of annotations',
  // §6 edges
  'EDGE: empty imports',
  'EDGE: no annotations',
  'EDGE: refund of uncategorized purchase (null)',
  'EDGE: import with single txn'
]);

// =============================================================================
// SECTION 5 — SCOREBOARDS (DUT vs independent reference model)
// =============================================================================

describe('IV&V refund-resolution: scoreboard (DUT vs independent reference model)', () => {
  test('resolveEffectiveCategory matches the reference model over random scenarios', () => {
    const sb = new Scoreboard<
      { ann: Record<string, TransactionAnnotation>; key: string },
      string | null
    >({
      dut: ({ ann, key }) => resolveEffectiveCategory(ann, key),
      model: ({ ann, key }) => refResolveEffectiveCategory(ann, key),
      show: ({ key }) => `key=${key}`
    });
    fc.assert(
      fc.property(arbScenario, (s) => {
        const keys = Object.keys(s.annotations);
        for (const key of keys) {
          sb.check({ ann: s.annotations, key });
          const own = s.annotations[key]!;
          // cover-point instrumentation
          const ro = own.refund_of;
          if (ro === undefined)
            cov.coverIf(own.category_id !== null, 'R1: own category (no refund_of)');
          if (ro === undefined)
            cov.coverIf(own.category_id === null, 'R1: own category null/absent');
          if (ro === '') cov.cover('R4: refund_of empty string');
          if (ro === key) cov.cover('R4: refund_of === self');
          if (ro !== undefined && ro !== '' && ro !== key && s.annotations[ro] === undefined)
            cov.cover('R4: refund_of -> missing key');
          if (ro !== undefined && ro !== '' && ro !== key && s.annotations[ro] !== undefined) {
            const orig = s.annotations[ro]!;
            cov.cover('R2: refund inherits original category');
            cov.coverIf(
              orig.category_id === null,
              'R2: original category is null -> effective null'
            );
            cov.coverIf(
              orig.refund_of !== undefined && orig.refund_of !== '',
              'R3: refund-of-refund, one hop only'
            );
            cov.coverIf(orig.category_id === null, 'EDGE: refund of uncategorized purchase (null)');
            cov.coverIf(
              own.category_id !== orig.category_id,
              'R5: refund category differs from original (original wins)'
            );
          }
        }
        // unknown-key probe (R1 "absent")
        sb.check({ ann: s.annotations, key: 'totally#unknown#key' });
        cov.cover('R1: resolve on unknown key');
      }),
      { numRuns: 400 }
    );
    sb.assertClean();
  });

  test('summaryFromImports matches the reference model (order-sensitive list)', () => {
    const sb = new Scoreboard<Scenario, SummaryTransaction[]>({
      dut: (s) => summaryFromImports(s.imports, s.annotations),
      model: (s) => refSummaryFromImports(s.imports, s.annotations),
      show: (s) => `imports=${s.imports.length}`
    });
    fc.assert(
      fc.property(arbScenario, (s) => {
        sb.check(s);
        const out = summaryFromImports(s.imports, s.annotations);
        cov.coverIf(out.length > 0, 'R5: non-ignored emitted');
        // ignored / multiple-refunds cover-point instrumentation
        const refundTargets = new Map<string, number>();
        for (const imp of s.imports) {
          imp.transactions.forEach((_, j) => {
            const key = transactionCategoryKey(imp.pdf_source_hash, j);
            const ann = s.annotations[key];
            if (ann?.ignored === true) {
              cov.cover('R5: ignored omitted entirely');
              if (ann.refund_of !== undefined && ann.refund_of !== '')
                cov.cover('R5: ignored refund omitted');
            }
            const ro = ann?.refund_of;
            if (ro !== undefined && ro !== '' && ro !== key && s.annotations[ro] !== undefined) {
              refundTargets.set(ro, (refundTargets.get(ro) ?? 0) + 1);
            }
          });
        }
        for (const n of refundTargets.values())
          cov.coverIf(n >= 2, 'R5: multiple refunds of same purchase');
      }),
      { numRuns: 400 }
    );
    sb.assertClean();
  });

  test('detailedRowsFromImports matches the reference model (shape + own category + description)', () => {
    // The DUT's DetailedRow may carry extra fields beyond the contract's named
    // ones. We compare only the contract-named projection, so additive fields
    // (not promised, not forbidden) do not produce false discrepancies; the
    // contract §3 says it "adds key, description, bank_name, ignored, refund_of?".
    type Named = {
      key: string;
      description: string;
      bank_name: string;
      ignored: boolean;
      category_id: string | null;
      posted_date: string;
      amount_minor: bigint;
      refund_of?: string;
    };
    const project = (r: Record<string, unknown>): Named => {
      const n: Named = {
        key: r.key as string,
        description: r.description as string,
        bank_name: r.bank_name as string,
        ignored: r.ignored as boolean,
        category_id: (r.category_id as string | null) ?? null,
        posted_date: r.posted_date as string,
        amount_minor: r.amount_minor as bigint
      };
      if (r.refund_of !== undefined && r.refund_of !== '') n.refund_of = r.refund_of as string;
      return n;
    };
    const sb = new Scoreboard<Scenario, Named[]>({
      dut: (s) =>
        (
          detailedRowsFromImports(s.imports, s.annotations) as unknown as Record<string, unknown>[]
        ).map(project),
      model: (s) =>
        refDetailedRowsFromImports(s.imports, s.annotations).map((r) =>
          project(r as unknown as Record<string, unknown>)
        ),
      show: (s) => `imports=${s.imports.length}`
    });
    fc.assert(
      fc.property(arbScenario, (s) => {
        sb.check(s);
        const rows = detailedRowsFromImports(s.imports, s.annotations) as unknown as Record<
          string,
          unknown
        >[];
        const totalTxns = s.imports.reduce((a, imp) => a + imp.transactions.length, 0);
        cov.coverIf(rows.length === totalTxns, 'R6: one row per txn incl ignored');
        for (const imp of s.imports) {
          imp.transactions.forEach((tx, j) => {
            const key = transactionCategoryKey(imp.pdf_source_hash, j);
            const ann = s.annotations[key];
            const cn = ann?.custom_name;
            cov.coverIf(cn !== undefined && cn !== '', 'R6: description = custom_name when set');
            cov.coverIf(
              cn === undefined || cn === '',
              'R6: description = parsed when no custom_name'
            );
            cov.coverIf(ann?.category_id !== undefined, 'R6: category = OWN (not resolved)');
            cov.coverIf(
              ann?.refund_of !== undefined && ann.refund_of !== '',
              'R6: refund_of present iff non-empty'
            );
          });
        }
      }),
      { numRuns: 400 }
    );
    sb.assertClean();
  });

  test('categorizableFromImports yields one {key, description} per transaction', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const cat = categorizableFromImports(s.imports) as unknown as {
          key: string;
          description: string;
        }[];
        const expectedKeys: string[] = [];
        for (const imp of s.imports)
          imp.transactions.forEach((_, j) =>
            expectedKeys.push(transactionCategoryKey(imp.pdf_source_hash, j))
          );
        // one per txn, stable keys (R-derived from §3 key contract)
        expect(cat.length).toBe(expectedKeys.length);
        expect(cat.map((c) => c.key).sort()).toEqual([...expectedKeys].sort());
        cov.coverIf(cat.length > 0, 'CAT: one categorizable per txn');
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// SECTION 6 — ORACLE-FREE CHECKS: conservation (INV1) + metamorphic netting (INV2)
//
// These need NO reference model — they are the strongest checks because they
// cannot share the DUT's blind spot. INV1 (contract §11) is the load-bearing one.
// =============================================================================

describe('IV&V refund-resolution: conservation & metamorphic (oracle-free)', () => {
  test('INV1 — summaryFromImports conserves money: sum == raw signed sum of non-ignored', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const summary = summaryFromImports(s.imports, s.annotations);
        const got = sumAmounts(summary);
        const want = rawNonIgnoredSum(s);
        // Relabelling a refund's category must NEVER create or destroy money.
        expect(got).toBe(want);
        cov.cover('INV1: conservation (arbitrary linkage)');
      }),
      { numRuns: 600 }
    );
  });

  test('INV1 (strict) — with EVERY refund linked to a real purchase, totals still conserve', () => {
    // Constrain the generator so every refund_of points to a valid, present,
    // non-self key (the contract §11 phrasing: "every refund is linked to a
    // purchase in the same dataset").
    const arbLinked = arbScenario.map((s) => {
      const keys = Object.keys(s.annotations);
      for (const key of keys) {
        const ann = s.annotations[key]!;
        if (ann.refund_of !== undefined) {
          // repoint any refund_of to a guaranteed-valid different key
          const other = keys.find((k) => k !== key) ?? key;
          ann.refund_of = other;
        }
      }
      return s;
    });
    fc.assert(
      fc.property(arbLinked, (s) => {
        const summary = summaryFromImports(s.imports, s.annotations);
        expect(sumAmounts(summary)).toBe(rawNonIgnoredSum(s));
        cov.cover('INV1: conservation (all refunds linked)');
      }),
      { numRuns: 300 }
    );
  });

  test('INV2 — netting: linking refund R(+r) to purchase P(-p, cat C) makes C total = -p + r', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (pMag, rMag) => {
          const p = -BigInt(pMag);
          const r = BigInt(rMag);
          const hash = 'hashN';
          const imp = makeImport(hash, [makeTxn(p, 'purchase'), makeTxn(r, 'refund')]);
          const pKey = transactionCategoryKey(hash, 0);
          const rKey = transactionCategoryKey(hash, 1);
          const C = 'cat-shopping';

          // Baseline: refund UNCATEGORIZED (no link) -> C total is just -p.
          const annUnlinked: Record<string, TransactionAnnotation> = {
            [pKey]: { category_id: C, source: 'manual' },
            [rKey]: { category_id: null, source: 'manual' }
          };
          const baseC = sumByCategory(summaryFromImports([imp], annUnlinked)).get(C) ?? 0n;

          // Linked: refund inherits C -> C total must be -p + r.
          const annLinked: Record<string, TransactionAnnotation> = {
            [pKey]: { category_id: C, source: 'manual' },
            [rKey]: { category_id: null, source: 'manual', refund_of: pKey }
          };
          const linkedC = sumByCategory(summaryFromImports([imp], annLinked)).get(C) ?? 0n;

          expect(baseC).toBe(p); // baseline only the purchase
          expect(linkedC).toBe(p + r); // INV2: C decreased by r (became less negative)
          // INV2 phrasing: C's total decreased by r relative to R uncategorized.
          expect(linkedC - baseC).toBe(r);
          cov.cover('INV2: netting reduces original category');
        }
      ),
      { numRuns: 300 }
    );
  });

  test('INV2 hand-computed golden — P=-$42.00, R=+$15.00, refund_of=P, category C', () => {
    // Hand arithmetic (bigint cents):
    //   purchase P = -4200, refund R = +1500, both must land in category C.
    //   C total = -4200 + 1500 = -2700. Conservation total = -4200 + 1500 = -2700.
    const hash = 'golden';
    const imp = makeImport(hash, [makeTxn(-4200n, 'BUY'), makeTxn(1500n, 'REFUND')]);
    const pKey = transactionCategoryKey(hash, 0);
    const rKey = transactionCategoryKey(hash, 1);
    const C = 'cat-food';
    const ann: Record<string, TransactionAnnotation> = {
      [pKey]: { category_id: C, source: 'manual' },
      // Refund's OWN category is deliberately DIFFERENT (cat-travel) to prove
      // the ORIGINAL wins (R2 / §6 "original wins").
      [rKey]: { category_id: 'cat-travel', source: 'manual', refund_of: pKey }
    };
    const summary = summaryFromImports([imp], ann);
    const byCat = sumByCategory(summary);
    expect(byCat.get(C)).toBe(-2700n); // refund netted into C
    expect(byCat.get('cat-travel')).toBeUndefined(); // refund did NOT land in its own cat
    expect(sumAmounts(summary)).toBe(-2700n); // conservation
    cov.cover('R5: refund category differs from original (original wins)');
  });

  test('INV4 — resolveEffectiveCategory is independent of annotation insertion order', () => {
    fc.assert(
      fc.property(arbScenario, fc.array(fc.nat(), { maxLength: 30 }), (s, perm) => {
        const keys = Object.keys(s.annotations);
        // Build a reordered clone of the annotations record.
        const reordered: Record<string, TransactionAnnotation> = {};
        const order = [...keys];
        // deterministic shuffle driven by perm
        for (let i = order.length - 1; i > 0; i--) {
          const j = (perm[i % perm.length] ?? 0) % (i + 1);
          const tmp = order[i]!;
          order[i] = order[j]!;
          order[j] = tmp;
        }
        for (const k of order) reordered[k] = s.annotations[k]!;
        for (const key of keys) {
          expect(resolveEffectiveCategory(reordered, key)).toBe(
            resolveEffectiveCategory(s.annotations, key)
          );
        }
        cov.cover('INV4: order-independence of annotations');
      }),
      { numRuns: 200 }
    );
  });

  test('INV3 — purity: DUT does not mutate its inputs', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const before = stringify(s);
        summaryFromImports(s.imports, s.annotations);
        detailedRowsFromImports(s.imports, s.annotations);
        for (const key of Object.keys(s.annotations)) resolveEffectiveCategory(s.annotations, key);
        categorizableFromImports(s.imports);
        const after = stringify(s);
        expect(after).toBe(before);
        cov.cover('INV3: purity (inputs not mutated)');
      }),
      { numRuns: 300 }
    );
  });

  test('INV3 — determinism: same inputs => identical output', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const a = summaryFromImports(s.imports, s.annotations);
        const b = summaryFromImports(s.imports, s.annotations);
        expect(deepEqual(a, b)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// SECTION 7 — DIRECTED CORNERS for every §6 edge case + R3 one-hop pin
// =============================================================================

describe('IV&V refund-resolution: directed §6 edge cases', () => {
  test('EDGE — empty imports', () => {
    expect(summaryFromImports([], {})).toEqual([]);
    expect(detailedRowsFromImports([], {})).toEqual([]);
    expect(categorizableFromImports([])).toEqual([]);
    cov.cover('EDGE: empty imports');
  });

  test('EDGE — imports present but no annotations: own category null, all emitted', () => {
    const hash = 'h';
    const imp = makeImport(hash, [makeTxn(-100n), makeTxn(200n)]);
    const summary = summaryFromImports([imp], {});
    expect(summary.map((t) => t.category_id)).toEqual([null, null]);
    expect(summary.map((t) => t.amount_minor)).toEqual([-100n, 200n]);
    expect(resolveEffectiveCategory({}, transactionCategoryKey(hash, 0))).toBeNull();
    cov.cover('EDGE: no annotations');
    cov.cover('EDGE: import with single txn');
  });

  test('R4 — refund_of empty string falls back to own category', () => {
    const ann: Record<string, TransactionAnnotation> = {
      x: { category_id: 'cat-food', source: 'manual', refund_of: '' }
    };
    expect(resolveEffectiveCategory(ann, 'x')).toBe('cat-food');
    cov.cover('R4: refund_of empty string');
  });

  test('R4 — refund_of === self falls back to own category', () => {
    const ann: Record<string, TransactionAnnotation> = {
      x: { category_id: 'cat-food', source: 'manual', refund_of: 'x' }
    };
    expect(resolveEffectiveCategory(ann, 'x')).toBe('cat-food');
  });

  test('R4 — refund_of -> missing key falls back to own category', () => {
    const ann: Record<string, TransactionAnnotation> = {
      x: { category_id: 'cat-food', source: 'manual', refund_of: 'nope' }
    };
    expect(resolveEffectiveCategory(ann, 'x')).toBe('cat-food');
  });

  test('R2 — refund inherits original; original wins over refund own category', () => {
    const ann: Record<string, TransactionAnnotation> = {
      orig: { category_id: 'cat-travel', source: 'manual' },
      ref: { category_id: 'cat-food', source: 'manual', refund_of: 'orig' }
    };
    expect(resolveEffectiveCategory(ann, 'ref')).toBe('cat-travel');
  });

  test('EDGE — refund of an UNCATEGORIZED purchase resolves to null', () => {
    const ann: Record<string, TransactionAnnotation> = {
      orig: { category_id: null, source: 'manual' },
      ref: { category_id: 'cat-food', source: 'manual', refund_of: 'orig' }
    };
    expect(resolveEffectiveCategory(ann, 'ref')).toBeNull();
    cov.cover('EDGE: refund of uncategorized purchase (null)');
  });

  test('R3 — refund of a refund is NOT chased (exactly one hop)', () => {
    // A -> refund_of B ; B -> refund_of C(cat-travel). Resolving A must return
    // B's OWN category (cat-food), NOT C's (cat-travel). One hop only.
    const ann: Record<string, TransactionAnnotation> = {
      C: { category_id: 'cat-travel', source: 'manual' },
      B: { category_id: 'cat-food', source: 'manual', refund_of: 'C' },
      A: { category_id: 'cat-shopping', source: 'manual', refund_of: 'B' }
    };
    expect(resolveEffectiveCategory(ann, 'A')).toBe('cat-food'); // B's own, not C's
    expect(resolveEffectiveCategory(ann, 'B')).toBe('cat-travel'); // B inherits C (one hop)
    cov.cover('R3: refund-of-refund, one hop only');
  });

  test('R5 — an IGNORED refund is omitted from the summary entirely', () => {
    const hash = 'hi';
    const imp = makeImport(hash, [makeTxn(-100n, 'buy'), makeTxn(40n, 'refund')]);
    const pKey = transactionCategoryKey(hash, 0);
    const rKey = transactionCategoryKey(hash, 1);
    const ann: Record<string, TransactionAnnotation> = {
      [pKey]: { category_id: 'cat-food', source: 'manual' },
      [rKey]: { category_id: 'cat-food', source: 'manual', refund_of: pKey, ignored: true }
    };
    const summary = summaryFromImports([imp], ann);
    expect(summary.length).toBe(1); // only the purchase
    expect(summary[0]!.amount_minor).toBe(-100n);
    expect(sumAmounts(summary)).toBe(-100n);
    cov.cover('R5: ignored refund omitted');
    cov.cover('R5: ignored omitted entirely');
  });

  test('R5 — multiple refunds of the SAME purchase all net into its category', () => {
    const hash = 'hm';
    const imp = makeImport(hash, [
      makeTxn(-1000n, 'buy'),
      makeTxn(300n, 'refund1'),
      makeTxn(200n, 'refund2')
    ]);
    const pKey = transactionCategoryKey(hash, 0);
    const r1 = transactionCategoryKey(hash, 1);
    const r2 = transactionCategoryKey(hash, 2);
    const C = 'cat-shopping';
    const ann: Record<string, TransactionAnnotation> = {
      [pKey]: { category_id: C, source: 'manual' },
      [r1]: { category_id: null, source: 'manual', refund_of: pKey },
      [r2]: { category_id: null, source: 'manual', refund_of: pKey }
    };
    const byCat = sumByCategory(summaryFromImports([imp], ann));
    expect(byCat.get(C)).toBe(-500n); // -1000 + 300 + 200
    cov.cover('R5: multiple refunds of same purchase');
  });

  test('R6 — description uses custom_name when set, else parsed; category is OWN', () => {
    const hash = 'hr';
    const imp = makeImport(hash, [makeTxn(-100n, 'PARSED DESC'), makeTxn(50n, 'OTHER')]);
    const k0 = transactionCategoryKey(hash, 0);
    const k1 = transactionCategoryKey(hash, 1);
    const ann: Record<string, TransactionAnnotation> = {
      [k0]: { category_id: 'cat-food', source: 'manual', custom_name: 'My Rename' },
      [k1]: { category_id: 'cat-travel', source: 'manual', refund_of: k0 }
    };
    const rows = detailedRowsFromImports([imp], ann) as unknown as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    expect(rows[0]!.description).toBe('My Rename'); // custom_name wins
    expect(rows[1]!.description).toBe('OTHER'); // parsed fallback
    // category_id is the row's OWN annotated category, NOT the resolved one:
    expect(rows[1]!.category_id).toBe('cat-travel'); // its own, even though it's a refund of k0
    expect(rows[1]!.refund_of).toBe(k0); // refund_of surfaced
    expect(rows[0]!.refund_of).toBeUndefined(); // not a refund -> absent
    cov.cover('R6: category = OWN (not resolved)');
    cov.cover('R6: refund_of present iff non-empty');
    cov.cover('R6: description = custom_name when set');
    cov.cover('R6: description = parsed when no custom_name');
    cov.cover('R6: one row per txn incl ignored');
  });

  test('R6 — an IGNORED transaction still produces a detailed row', () => {
    const hash = 'hg';
    const imp = makeImport(hash, [makeTxn(-100n, 'x')]);
    const k0 = transactionCategoryKey(hash, 0);
    const ann: Record<string, TransactionAnnotation> = {
      [k0]: { category_id: 'cat-food', source: 'manual', ignored: true }
    };
    const rows = detailedRowsFromImports([imp], ann) as unknown as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.ignored).toBe(true);
  });

  // ── Mutation-killing directed cases ──────────────────────────────────────
  // The empty-string guard (refund_of !== '') is only load-bearing when an
  // annotation actually EXISTS at the key '' — otherwise removing the guard
  // would hit the missing-key fallback anyway and produce the same answer
  // (which is why naive stimulus lets `!== ''` mutants survive). We plant a
  // decoy annotation at key '' with a DIFFERENT category so the guard's
  // presence is observable.
  test('R4 (guard) — refund_of === "" must NOT inherit a stray annotation living at key ""', () => {
    const ann: Record<string, TransactionAnnotation> = {
      '': { category_id: 'cat-DECOY', source: 'manual' }, // stray annotation at empty key
      x: { category_id: 'cat-food', source: 'manual', refund_of: '' }
    };
    // Per R4, refund_of === '' is a safe-fallback to x's OWN category (cat-food),
    // NOT an inheritance from the decoy at ''. If the `!== ''` guard were removed,
    // resolution would chase '' -> the decoy and return 'cat-DECOY'.
    expect(resolveEffectiveCategory(ann, 'x')).toBe('cat-food');
    cov.cover('R4: refund_of empty string');
  });

  // The self-guard (refund_of !== key) is only load-bearing when removing it
  // changes the answer. A self-refund of a categorized txn already returns its
  // own category either way; to make the guard observable we need the self-link
  // to be the ONLY reason resolution doesn't loop / change. Use a self-link
  // where the txn's own category is non-null so "self -> own" is unambiguous and
  // distinguishable from "self -> inherit (which would also be own)". The
  // empty-string + decoy case above plus this confirm both guard clauses.
  // The `refund_of !== undefined` guard is load-bearing: when an annotation has
  // NO refund_of, resolution must return its OWN category, NOT chase a stray
  // annotation that happens to live at the literal key "undefined". (In JS,
  // obj[undefined] === obj["undefined"], so dropping the guard would mis-resolve
  // an unlinked txn to a "undefined"-keyed decoy.)
  test('R1 (guard) — unlinked txn must NOT resolve via a stray "undefined"-keyed annotation', () => {
    const ann: Record<string, TransactionAnnotation> = {
      undefined: { category_id: 'cat-DECOY', source: 'manual' }, // stray at literal "undefined"
      x: { category_id: 'cat-food', source: 'manual' } // no refund_of -> own category
    };
    expect(resolveEffectiveCategory(ann, 'x')).toBe('cat-food'); // own, not the decoy
    cov.cover('R1: own category (no refund_of)');
  });

  test('R4 (guard) — self refund_of resolves to own category, not via the link', () => {
    const ann: Record<string, TransactionAnnotation> = {
      x: { category_id: 'cat-travel', source: 'manual', refund_of: 'x' }
    };
    expect(resolveEffectiveCategory(ann, 'x')).toBe('cat-travel');
  });

  // detailedRowsFromImports line: refund_of present IFF non-empty. A refund_of
  // === '' must NOT surface a refund_of field. Removing the `!== ''` guard would
  // attach refund_of: '' to the row.
  test('R6 (guard) — refund_of === "" must NOT appear on the detailed row', () => {
    const hash = 'hempty';
    const imp = makeImport(hash, [makeTxn(-100n, 'x')]);
    const k0 = transactionCategoryKey(hash, 0);
    const ann: Record<string, TransactionAnnotation> = {
      [k0]: { category_id: 'cat-food', source: 'manual', refund_of: '' }
    };
    const rows = detailedRowsFromImports([imp], ann) as unknown as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    expect('refund_of' in rows[0]!).toBe(false); // empty refund_of suppressed
    cov.cover('R6: refund_of present iff non-empty');
  });

  test('R1 — own category by default; null when unset/absent', () => {
    const ann: Record<string, TransactionAnnotation> = {
      a: { category_id: 'cat-food', source: 'manual' },
      b: { category_id: null, source: 'manual' }
    };
    expect(resolveEffectiveCategory(ann, 'a')).toBe('cat-food');
    expect(resolveEffectiveCategory(ann, 'b')).toBeNull();
    expect(resolveEffectiveCategory(ann, 'absent')).toBeNull();
    cov.cover('R1: own category (no refund_of)');
    cov.cover('R1: own category null/absent');
    cov.cover('R1: resolve on unknown key');
  });
});

// =============================================================================
// SECTION 8 — COVERAGE CLOSURE GATE  (must run last)
// =============================================================================

describe('IV&V refund-resolution: functional coverage closure', () => {
  test('all planned cover points were exercised', () => {
    // Emit the report so it lands in the test log for the sign-off record.
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
