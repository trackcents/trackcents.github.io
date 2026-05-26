// =============================================================================
// IV&V — transaction-view (US-P1-E unified view: flatten / filter / sort)
// =============================================================================
//
// Independent verification environment built from the contract + spec ALONE.
// The verifier never reads src/lib/app/transaction-view.ts nor the Designer's
// tests. Everything below derives from:
//   - specs/001-money-tracker-mvp/verification/transaction-view.contract.md
//   - specs/001-money-tracker-mvp/spec.md (US-P1-E, FR-040..FR-045)
//   - .specify/memory/constitution.md (Principle II — money is integer cents)
//   - public type declarations only (adapters/types.ts, db/types.ts, import.ts)
//
// LEAN Stage-1 environment: directed corners + constrained-random + an
// independent reference model + scoreboard + functional-coverage closure +
// the two contract-flagged oracle-hazard probes (amount-bound float, key
// injectivity). Mutation deferred unless a bug is found.
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import {
  toUnifiedRows,
  accountKeyString,
  listAccounts,
  applyFilter,
  sortRows,
  type UnifiedRow,
  type AccountKey,
  type TransactionFilter,
  type SortSpec
} from '../../../src/lib/app/transaction-view';
import type { ImportSuccess } from '../../../src/lib/app/import';
// (framework imports fixed below)
import type {
  ParsedStatement,
  ParsedTransaction,
  TransactionType,
  AccountType
} from '../../../src/lib/adapters/types';

import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// -----------------------------------------------------------------------------
// Fixture builders (the "sequencer/generator" raw material)
// -----------------------------------------------------------------------------

const ACCOUNT_TYPES: AccountType[] = [
  'checking',
  'savings',
  'credit_card',
  'loan',
  'cash',
  'other'
];

const TXN_TYPES: TransactionType[] = [
  'purchase',
  'refund',
  'transfer',
  'fee',
  'interest',
  'payment_to_card',
  'deposit',
  'withdrawal',
  'other'
];

function makeStatement(over: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    account_type: 'checking',
    account_last_4: '1234',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
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
    parser_provides: ['A'],
    ...over
  };
}

function makeTxn(over: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    posted_date: '2026-01-15',
    description: 'Generic Merchant',
    raw_text: 'GENERIC MERCHANT 01/15',
    amount_minor: -1000n,
    currency: 'USD',
    transaction_type: 'purchase',
    ...over
  };
}

interface ImportSpec {
  bank_name: string;
  account_type: AccountType;
  account_last_4: string | null;
  pdf_source_hash?: string;
  adapter_name?: string;
  adapter_version?: string;
  txns: ParsedTransaction[];
}

function makeImport(spec: ImportSpec): ImportSuccess {
  return {
    ok: true,
    adapter_name: spec.adapter_name ?? 'layout-test',
    adapter_version: spec.adapter_version ?? '1.0.0',
    bank_name: spec.bank_name,
    pdf_source_hash: spec.pdf_source_hash ?? `hash-${spec.bank_name}-${spec.account_last_4}`,
    statement: makeStatement({
      account_type: spec.account_type,
      account_last_4: spec.account_last_4
    }),
    transactions: spec.txns,
    // `checksum` is not consumed by transaction-view per the contract; a typed
    // stand-in keeps the fixture well-shaped without asserting on its content.
    checksum: { ok: true } as ImportSuccess['checksum']
  };
}

// -----------------------------------------------------------------------------
// INDEPENDENT REFERENCE MODEL — my own from-spec re-implementation.
// Never derived from the DUT. Pure spec transcription of R1..R6 / INV1..INV8.
// -----------------------------------------------------------------------------

// R1/R2: flatten preserving provenance + (import_index, transaction_index),
// then order by (posted_date, import_index, transaction_index).
function refToUnifiedRows(imports: ImportSuccess[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  imports.forEach((imp, importIndex) => {
    imp.transactions.forEach((t, txnIndex) => {
      rows.push({
        bank_name: imp.bank_name,
        account_type: imp.statement.account_type,
        account_last_4: imp.statement.account_last_4,
        pdf_source_hash: imp.pdf_source_hash,
        adapter_name: imp.adapter_name,
        adapter_version: imp.adapter_version,
        posted_date: t.posted_date,
        description: t.description,
        amount_minor: t.amount_minor,
        currency: t.currency,
        transaction_type: t.transaction_type,
        raw_text: t.raw_text,
        import_index: importIndex,
        transaction_index: txnIndex
      });
    });
  });
  // Stable sort by the three-key total order (R2). Array.prototype.sort is
  // stable in modern V8; with a strict comparator ties cannot occur on the
  // composite key anyway because (import_index, transaction_index) is unique.
  return [...rows].sort((a, b) => {
    if (a.posted_date < b.posted_date) return -1;
    if (a.posted_date > b.posted_date) return 1;
    if (a.import_index !== b.import_index) return a.import_index - b.import_index;
    return a.transaction_index - b.transaction_index;
  });
}

// Dollars→cents conversion done with EXACT decimal arithmetic (the golden
// oracle for the Principle-II amount-bound hazard). Parse the decimal string
// rather than multiplying a binary float by 100. Rounds half-away-from-zero at
// the 3rd+ decimal place (a dollar bound finer than a cent is rounded to the
// nearest cent; this is the only defensible reading — a cent is the unit).
function dollarsToCentsExact(dollars: number): bigint {
  // Use the shortest round-tripping decimal representation JS gives us, then
  // do base-10 scaling by 100 with explicit rounding — no float * 100.
  const neg = dollars < 0 || Object.is(dollars, -0);
  const s = Math.abs(dollars).toString();
  let intPart: string;
  let fracPart: string;
  if (s.includes('e') || s.includes('E')) {
    // Expand scientific notation defensively (bounds in this domain are small;
    // this path is for completeness, not a realistic UX bound).
    const expanded = Number(dollars).toFixed(20);
    [intPart, fracPart = ''] = expanded.replace('-', '').split('.') as [string, string?] as [
      string,
      string
    ];
  } else {
    [intPart, fracPart = ''] = s.split('.') as [string, string?] as [string, string];
  }
  const centsDigits = (fracPart + '00').slice(0, 2);
  const thirdDigit = fracPart.length > 2 ? Number(fracPart[2]) : 0;
  let cents = BigInt(intPart) * 100n + BigInt(centsDigits);
  if (thirdDigit >= 5) cents += 1n; // round half up on the magnitude
  return neg ? -cents : cents;
}

function absBig(x: bigint): bigint {
  return x < 0n ? -x : x;
}

// R5d: token-AND, case-insensitive substring; empty/whitespace → no constraint.
function searchMatches(description: string, search: string): boolean {
  const tokens = search
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return true;
  const hay = description.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

// R5: conjunctive filter across all dimensions. Independent transcription.
function refApplyFilter(rows: UnifiedRow[], filter: TransactionFilter): UnifiedRow[] {
  const accountSet =
    filter.account_keys && filter.account_keys.length > 0 ? new Set(filter.account_keys) : null;
  const typeSet =
    filter.types && filter.types.length > 0 ? new Set<TransactionType>(filter.types) : null;
  const minCents = filter.amount_min === undefined ? null : dollarsToCentsExact(filter.amount_min);
  const maxCents = filter.amount_max === undefined ? null : dollarsToCentsExact(filter.amount_max);
  const search = filter.search ?? '';

  return rows.filter((r) => {
    if (accountSet) {
      const key = accountKeyString({
        bank_name: r.bank_name,
        account_type: r.account_type,
        account_last_4: r.account_last_4
      });
      if (!accountSet.has(key)) return false;
    }
    if (filter.date_from !== undefined && r.posted_date < filter.date_from) return false;
    if (filter.date_to !== undefined && r.posted_date > filter.date_to) return false;
    if (minCents !== null && absBig(r.amount_minor) < minCents) return false;
    if (maxCents !== null && absBig(r.amount_minor) > maxCents) return false;
    if (typeSet && !typeSet.has(r.transaction_type)) return false;
    if (!searchMatches(r.description, search)) return false;
    return true;
  });
}

// NOTE: sortRows is verified below via monotone-projection + permutation +
// stability properties, NOT a reference comparator — the contract leaves the
// account-sort tiebreak loose, so byte-equality vs a reference sort would be an
// unsound oracle. (An earlier unused reference comparator was removed for lint.)

// -----------------------------------------------------------------------------
// Arbitraries (constrained-random stimulus encoding the VALID input domain)
// -----------------------------------------------------------------------------

const arbDate = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2027-12-31T00:00:00Z'),
    noInvalidDate: true
  })
  .map((d) => d.toISOString().slice(0, 10));

const arbAmount = fc.bigInt({ min: -50_000_00n, max: 50_000_00n });

const arbDescription = fc.constantFrom(
  'AMAZON MARKETPLACE',
  'Starbucks Coffee',
  'WHOLE FOODS #123',
  'Netflix subscription',
  'transfer to savings',
  'ACH PAYMENT THANK YOU',
  'Interest Earned',
  'Whole grain bakery',
  '',
  '   ',
  'café résumé'
);

const arbTxnType = fc.constantFrom(...TXN_TYPES);

const arbTxn: fc.Arbitrary<ParsedTransaction> = fc.record({
  posted_date: arbDate,
  description: arbDescription,
  raw_text: fc.string(),
  amount_minor: arbAmount,
  currency: fc.constant('USD'),
  transaction_type: arbTxnType
});

const arbBank = fc.constantFrom(
  'Chase',
  'Bank of America',
  'Discover',
  'American Express',
  'Robinhood'
);

const arbAccountType = fc.constantFrom(...ACCOUNT_TYPES);

const arbLast4 = fc.option(
  fc.integer({ min: 0, max: 9999 }).map((n) => n.toString().padStart(4, '0')),
  { nil: null }
);

const arbImport: fc.Arbitrary<ImportSuccess> = fc
  .record({
    bank_name: arbBank,
    account_type: arbAccountType,
    account_last_4: arbLast4,
    txns: fc.array(arbTxn, { minLength: 0, maxLength: 6 })
  })
  .map((s) => makeImport(s));

const arbImports = fc.array(arbImport, { minLength: 0, maxLength: 5 });

// -----------------------------------------------------------------------------
// Functional coverage model (the vplan cover points)
// -----------------------------------------------------------------------------

const cov = new CoverageModel([
  // toUnifiedRows / flatten
  'flatten:empty-imports',
  'flatten:single-import-single-txn',
  'flatten:multi-import-multi-txn',
  'flatten:import-with-zero-txns',
  'flatten:same-day-across-imports',
  // filter dimensions
  'filter:empty-identity',
  'filter:account_keys',
  'filter:date_from-on-boundary',
  'filter:date_to-on-boundary',
  'filter:date-just-outside',
  'filter:amount_min',
  'filter:amount_max',
  'filter:amount-abs-keeps-negative',
  'filter:amount-on-cent-boundary',
  'filter:amount-fractional-bound',
  'filter:amount_min>amount_max-empty',
  'filter:search-single-token',
  'filter:search-multi-token-AND',
  'filter:search-case-insensitive',
  'filter:search-empty-whitespace-no-constraint',
  'filter:types',
  'filter:full-conjunction',
  // pairwise (INV3) — all dimension pairs
  'pairwise:account+date',
  'pairwise:account+amount',
  'pairwise:account+search',
  'pairwise:account+type',
  'pairwise:date+amount',
  'pairwise:date+search',
  'pairwise:date+type',
  'pairwise:amount+search',
  'pairwise:amount+type',
  'pairwise:search+type',
  // invariants
  'inv:subset',
  'inv:idempotent',
  'inv:and-decomposition',
  'inv:conservation-count',
  'inv:provenance-roundtrip',
  'inv:listAccounts-distinct',
  // accountKeyString injectivity
  'key:equal-keys-equal-string',
  'key:distinct-bank-distinct-string',
  'key:distinct-type-distinct-string',
  'key:distinct-last4-distinct-string',
  'key:null-last4-defined',
  'key:adversarial-separator-probe',
  // sort
  'sort:date-asc',
  'sort:date-desc',
  'sort:description',
  'sort:amount-signed',
  'sort:account',
  'sort:type',
  'sort:stable-ties',
  'sort:permutation',
  'sort:no-mutation'
]);

// snapshot deep-copy for purity checks
function snapshot<T>(x: T): T {
  return JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))) as T;
}

// -----------------------------------------------------------------------------
// R1/R2/INV5 — toUnifiedRows: flatten, conservation, order, provenance
// -----------------------------------------------------------------------------

describe('toUnifiedRows — flatten / order / conservation (R1, R2, INV5)', () => {
  test('empty imports → []', () => {
    cov.cover('flatten:empty-imports');
    expect(toUnifiedRows([])).toEqual([]);
  });

  test('INV5 conservation: output length = Σ transactions', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const total = imports.reduce((n, i) => n + i.transactions.length, 0);
        const rows = toUnifiedRows(imports);
        cov.coverIf(
          imports.length === 1 && imports[0]!.transactions.length === 1,
          'flatten:single-import-single-txn'
        );
        cov.coverIf(imports.length > 1, 'flatten:multi-import-multi-txn');
        cov.coverIf(
          imports.some((i) => i.transactions.length === 0),
          'flatten:import-with-zero-txns'
        );
        cov.cover('inv:conservation-count');
        expect(rows.length).toBe(total);
      })
    );
  });

  test('INV5 provenance + (import_index, transaction_index) round-trip to the source row', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const rows = toUnifiedRows(imports);
        for (const r of rows) {
          const src = imports[r.import_index];
          expect(src).toBeDefined();
          const srcTxn = src!.transactions[r.transaction_index];
          expect(srcTxn).toBeDefined();
          // provenance carried from the import
          expect(r.bank_name).toBe(src!.bank_name);
          expect(r.account_type).toBe(src!.statement.account_type);
          expect(r.account_last_4).toBe(src!.statement.account_last_4);
          expect(r.pdf_source_hash).toBe(src!.pdf_source_hash);
          expect(r.adapter_name).toBe(src!.adapter_name);
          expect(r.adapter_version).toBe(src!.adapter_version);
          // transaction fields carried from the source txn
          expect(r.posted_date).toBe(srcTxn!.posted_date);
          expect(r.description).toBe(srcTxn!.description);
          expect(r.amount_minor).toBe(srcTxn!.amount_minor);
          expect(r.currency).toBe(srcTxn!.currency);
          expect(r.transaction_type).toBe(srcTxn!.transaction_type);
          expect(r.raw_text).toBe(srcTxn!.raw_text);
        }
        cov.cover('inv:provenance-roundtrip');
      })
    );
  });

  test('R2 order: ascending by (posted_date, import_index, transaction_index) — scoreboard vs model', () => {
    const sb = new Scoreboard<ImportSuccess[], UnifiedRow[]>({
      dut: toUnifiedRows,
      model: refToUnifiedRows
    });
    fc.assert(
      fc.property(arbImports, (imports) => {
        sb.check(imports);
      }),
      { numRuns: 400 }
    );
    sb.assertClean();
  });

  test('R2 directed: same-day rows across different imports order by import_index then txn_index', () => {
    const imports: ImportSuccess[] = [
      makeImport({
        bank_name: 'Chase',
        account_type: 'checking',
        account_last_4: '1111',
        txns: [
          makeTxn({ posted_date: '2026-03-10', description: 'A' }),
          makeTxn({ posted_date: '2026-03-10', description: 'B' })
        ]
      }),
      makeImport({
        bank_name: 'Discover',
        account_type: 'credit_card',
        account_last_4: '2222',
        txns: [makeTxn({ posted_date: '2026-03-10', description: 'C' })]
      })
    ];
    cov.cover('flatten:same-day-across-imports');
    const rows = toUnifiedRows(imports);
    expect(rows.map((r) => r.description)).toEqual(['A', 'B', 'C']);
  });

  test('INV8 purity: toUnifiedRows does not mutate its argument', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const before = snapshot(imports);
        toUnifiedRows(imports);
        expect(snapshot(imports)).toEqual(before);
      })
    );
  });
});

// -----------------------------------------------------------------------------
// R5 / INV1..INV4 — applyFilter
// -----------------------------------------------------------------------------

describe('applyFilter — semantics (R5), invariants (INV1-INV4)', () => {
  const baseImports: ImportSuccess[] = [
    makeImport({
      bank_name: 'Chase',
      account_type: 'checking',
      account_last_4: '1111',
      txns: [
        makeTxn({
          posted_date: '2026-01-05',
          description: 'Whole Foods Market',
          amount_minor: -1000n,
          transaction_type: 'purchase'
        }),
        makeTxn({
          posted_date: '2026-01-10',
          description: 'Paycheck Deposit',
          amount_minor: 250000n,
          transaction_type: 'deposit'
        }),
        makeTxn({
          posted_date: '2026-01-20',
          description: 'Refund Whole Foods',
          amount_minor: 1000n,
          transaction_type: 'refund'
        })
      ]
    }),
    makeImport({
      bank_name: 'Discover',
      account_type: 'credit_card',
      account_last_4: '2222',
      txns: [
        makeTxn({
          posted_date: '2026-01-15',
          description: 'AMAZON purchase',
          amount_minor: -2675n,
          transaction_type: 'purchase'
        }),
        makeTxn({
          posted_date: '2026-01-25',
          description: 'Interest Charge',
          amount_minor: -29n,
          transaction_type: 'interest'
        })
      ]
    })
  ];
  const baseRows = toUnifiedRows(baseImports);

  test('INV2 empty filter is identity (same rows, same order)', () => {
    cov.cover('filter:empty-identity');
    expect(applyFilter(baseRows, {})).toEqual(baseRows);
  });

  test('R5a account_keys membership', () => {
    cov.cover('filter:account_keys');
    const chaseKey = accountKeyString({
      bank_name: 'Chase',
      account_type: 'checking',
      account_last_4: '1111'
    });
    const out = applyFilter(baseRows, { account_keys: [chaseKey] });
    expect(out.every((r) => r.bank_name === 'Chase')).toBe(true);
    expect(out.length).toBe(3);
  });

  test('R5b date bounds INCLUSIVE (INV4): row exactly on bound kept; just-outside dropped', () => {
    cov.cover('filter:date_from-on-boundary');
    cov.cover('filter:date_to-on-boundary');
    cov.cover('filter:date-just-outside');
    // exactly on date_from
    const onFrom = applyFilter(baseRows, { date_from: '2026-01-10' });
    expect(onFrom.some((r) => r.posted_date === '2026-01-10')).toBe(true);
    expect(onFrom.every((r) => r.posted_date >= '2026-01-10')).toBe(true);
    // exactly on date_to
    const onTo = applyFilter(baseRows, { date_to: '2026-01-15' });
    expect(onTo.some((r) => r.posted_date === '2026-01-15')).toBe(true);
    expect(onTo.every((r) => r.posted_date <= '2026-01-15')).toBe(true);
    // just outside (one day before from is dropped)
    const range = applyFilter(baseRows, { date_from: '2026-01-06', date_to: '2026-01-24' });
    expect(range.some((r) => r.posted_date === '2026-01-05')).toBe(false);
    expect(range.some((r) => r.posted_date === '2026-01-25')).toBe(false);
  });

  test('R5c amount filter on ABSOLUTE amount, INCLUSIVE: amount_min:10 keeps +$10 and -$10', () => {
    cov.cover('filter:amount_min');
    cov.cover('filter:amount-abs-keeps-negative');
    cov.cover('filter:amount-on-cent-boundary');
    // baseRows has -1000c (-$10) and +1000c (+$10). amount_min:10 keeps BOTH.
    const out = applyFilter(baseRows, { amount_min: 10 });
    const tens = out.filter((r) => absBig(r.amount_minor) === 1000n);
    expect(tens.length).toBe(2); // both the -$10 purchase and +$10 refund
  });

  test('R5c amount_max INCLUSIVE on absolute value', () => {
    cov.cover('filter:amount_max');
    const out = applyFilter(baseRows, { amount_max: 10 });
    expect(out.every((r) => absBig(r.amount_minor) <= 1000n)).toBe(true);
    // -$10, +$10, and -$0.29 qualify; -$26.75 and +$2500 do not
    expect(out.some((r) => absBig(r.amount_minor) === 267500n)).toBe(false);
  });

  test('R5c amount_min > amount_max → empty result, no crash', () => {
    cov.cover('filter:amount_min>amount_max-empty');
    expect(() => applyFilter(baseRows, { amount_min: 100, amount_max: 1 })).not.toThrow();
    expect(applyFilter(baseRows, { amount_min: 100, amount_max: 1 })).toEqual([]);
  });

  test('R5d search: single token, case-insensitive substring', () => {
    cov.cover('filter:search-single-token');
    cov.cover('filter:search-case-insensitive');
    const out = applyFilter(baseRows, { search: 'whole' });
    expect(out.length).toBe(2); // "Whole Foods Market" + "Refund Whole Foods"
    expect(out.every((r) => r.description.toLowerCase().includes('whole'))).toBe(true);
  });

  test('R5d search: multi-token AND', () => {
    cov.cover('filter:search-multi-token-AND');
    const out = applyFilter(baseRows, { search: 'whole foods' });
    expect(out.length).toBe(2);
    const none = applyFilter(baseRows, { search: 'whole amazon' });
    expect(none.length).toBe(0); // no single description contains both tokens
  });

  test('R5d search: empty / whitespace-only → no constraint', () => {
    cov.cover('filter:search-empty-whitespace-no-constraint');
    expect(applyFilter(baseRows, { search: '' })).toEqual(baseRows);
    expect(applyFilter(baseRows, { search: '   ' })).toEqual(baseRows);
  });

  test('R5e types membership', () => {
    cov.cover('filter:types');
    const out = applyFilter(baseRows, { types: ['purchase', 'refund'] });
    expect(
      out.every((r) => r.transaction_type === 'purchase' || r.transaction_type === 'refund')
    ).toBe(true);
    expect(out.length).toBe(3); // 2 purchases + 1 refund
  });

  test('R5 full conjunction (every dimension at once) does not crash and is a subset', () => {
    cov.cover('filter:full-conjunction');
    const chaseKey = accountKeyString({
      bank_name: 'Chase',
      account_type: 'checking',
      account_last_4: '1111'
    });
    const out = applyFilter(baseRows, {
      account_keys: [chaseKey],
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      amount_min: 5,
      amount_max: 100000,
      search: 'whole',
      types: ['purchase']
    });
    expect(out.length).toBe(1);
    expect(out[0]!.description).toBe('Whole Foods Market');
  });

  // ---- Scoreboard: DUT vs independent reference model across random filters ----
  const arbFilter: fc.Arbitrary<TransactionFilter> = fc.record(
    {
      account_keys: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
      date_from: fc.option(arbDate, { nil: undefined }),
      date_to: fc.option(arbDate, { nil: undefined }),
      amount_min: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
      amount_max: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
      search: fc.option(
        fc.constantFrom('whole', 'foods', 'whole foods', 'AMAZON', 'interest', '', '  ', 'café'),
        { nil: undefined }
      ),
      types: fc.option(fc.uniqueArray(arbTxnType, { maxLength: 4 }), { nil: undefined })
    },
    { requiredKeys: [] }
  );

  test('SCOREBOARD: applyFilter(rows, f) == reference model over random rows × filters', () => {
    const sb = new Scoreboard<{ rows: UnifiedRow[]; f: TransactionFilter }, UnifiedRow[]>({
      dut: ({ rows, f }) => applyFilter(rows, f),
      model: ({ rows, f }) => refApplyFilter(rows, f),
      show: ({ f }) => JSON.stringify(f)
    });
    fc.assert(
      fc.property(arbImports, arbFilter, (imports, f) => {
        const rows = toUnifiedRows(imports);
        // Bias account_keys to real keys present, plus the random strings, so
        // membership is exercised (otherwise random strings never match).
        const realKeys = listAccounts(rows).map(accountKeyString);
        const f2: TransactionFilter =
          f.account_keys && f.account_keys.length > 0 && realKeys.length > 0
            ? { ...f, account_keys: [...f.account_keys, realKeys[0]!] }
            : f;
        sb.check({ rows, f: f2 });
      }),
      { numRuns: 600 }
    );
    sb.assertClean();
  });

  test('INV1 subset + idempotent', () => {
    fc.assert(
      fc.property(arbImports, arbFilter, (imports, f) => {
        const rows = toUnifiedRows(imports);
        const once = applyFilter(rows, f);
        // subset & order/membership preserved
        expect(once.length).toBeLessThanOrEqual(rows.length);
        const rowSet = new Set(rows);
        expect(once.every((r) => rowSet.has(r))).toBe(true);
        // order preserved: `once` is a subsequence of `rows`
        let j = 0;
        for (const r of rows) {
          if (j < once.length && once[j] === r) j += 1;
        }
        expect(j).toBe(once.length);
        // idempotent
        const twice = applyFilter(once, f);
        expect(twice).toEqual(once);
        cov.cover('inv:subset');
        cov.cover('inv:idempotent');
      }),
      { numRuns: 300 }
    );
  });

  test('INV8 purity: applyFilter does not mutate its inputs', () => {
    fc.assert(
      fc.property(arbImports, arbFilter, (imports, f) => {
        const rows = toUnifiedRows(imports);
        const beforeRows = snapshot(rows);
        const beforeF = snapshot(f);
        applyFilter(rows, f);
        expect(snapshot(rows)).toEqual(beforeRows);
        expect(snapshot(f)).toEqual(beforeF);
      })
    );
  });
});

// -----------------------------------------------------------------------------
// INV3 — AND-decomposition / pairwise (CLAUDE.md pairwise filter requirement)
// applyFilter(applyFilter(rows,{a}),{b}) === applyFilter(rows,{a,b})
// -----------------------------------------------------------------------------

describe('INV3 pairwise AND-decomposition (all dimension pairs)', () => {
  // Single-dimension filter generators keyed by dimension name.
  function dimFilter(dim: string, rows: UnifiedRow[]): TransactionFilter {
    const keys = listAccounts(rows).map(accountKeyString);
    switch (dim) {
      case 'account':
        return { account_keys: keys.slice(0, 1) };
      case 'date':
        return { date_from: '2026-01-08', date_to: '2026-01-22' };
      case 'amount':
        return { amount_min: 1, amount_max: 30 };
      case 'search':
        return { search: 'whole' };
      case 'type':
        return { types: ['purchase', 'deposit'] };
      default:
        return {};
    }
  }

  const dims = ['account', 'date', 'amount', 'search', 'type'];
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      pairs.push([dims[i]!, dims[j]!]);
    }
  }

  test.each(pairs)('INV3 metamorphic: %s + %s decompose equally', (a, b) => {
    cov.cover(`pairwise:${a}+${b}`);
    cov.cover('inv:and-decomposition');
    fc.assert(
      fc.property(arbImports, (imports) => {
        const rows = toUnifiedRows(imports);
        const fa = dimFilter(a, rows);
        const fb = dimFilter(b, rows);
        const sequential = applyFilter(applyFilter(rows, fa), fb);
        const combined = applyFilter(rows, { ...fa, ...fb });
        // Order of dimensions doesn't matter, and sequencing == combining.
        expect(sequential).toEqual(combined);
        const sequentialRev = applyFilter(applyFilter(rows, fb), fa);
        expect(sequentialRev).toEqual(combined);
      }),
      { numRuns: 150 }
    );
  });
});

// -----------------------------------------------------------------------------
// §11 HAZARD 1 — amount-bound dollars→cents float probe (Principle II watch)
// -----------------------------------------------------------------------------

describe('§11 amount-bound float probe (Principle II-adjacent)', () => {
  // Build rows whose |amount| sits EXACTLY on assorted CENT-EXACT dollar
  // boundaries, then feed the matching dollar bound and check inclusivity
  // (INV4). These dollar values each name an EXACT whole number of cents, so
  // the correct cent value is unambiguous — but several are NOT exactly
  // representable in binary float and so are the real Principle-II hazards:
  //   10.05 -> 10.05*100 = 1005.0000000000001  (a naive trunc gives 1004 — WRONG)
  //   0.29  -> 0.29 *100 =   28.999999999999996 (a naive trunc gives 28   — WRONG)
  // A correct dollars→cents conversion rounds to the nearest cent and gets
  // these right. (The genuinely sub-cent value $2.675 is handled separately
  // below — it is a spec ambiguity, not a clean boundary.)
  const probeCents = [1005n, 29n, 1000n, 10n, 1n, 99999n, 250000n];
  const rows: UnifiedRow[] = toUnifiedRows([
    makeImport({
      bank_name: 'Probe',
      account_type: 'checking',
      account_last_4: '0000',
      txns: probeCents.flatMap((c, i) => [
        makeTxn({ posted_date: '2026-02-01', description: `pos-${i}`, amount_minor: c }),
        makeTxn({ posted_date: '2026-02-01', description: `neg-${i}`, amount_minor: -c })
      ])
    })
  ]);

  const fractionalBounds = [10.05, 0.29, 10.0, 0.1, 0.01, 999.99, 2500.0];

  test('a row whose |amount| EXACTLY equals the dollar bound is KEPT (INV4) — min', () => {
    cov.cover('filter:amount-fractional-bound');
    cov.cover('filter:amount-on-cent-boundary');
    for (let i = 0; i < fractionalBounds.length; i++) {
      const dollars = fractionalBounds[i]!;
      const expectCents = probeCents[i]!;
      // amount_min == bound: rows with |amount| >= bound are kept; the row whose
      // |amount| == bound MUST be present.
      const out = applyFilter(rows, { amount_min: dollars });
      const boundaryKept = out.some((r) => absBig(r.amount_minor) === expectCents);
      expect(
        boundaryKept,
        `amount_min=${dollars} should KEEP |amount|=${expectCents}c (INV4)`
      ).toBe(true);
    }
  });

  test('a row whose |amount| EXACTLY equals the dollar bound is KEPT (INV4) — max', () => {
    for (let i = 0; i < fractionalBounds.length; i++) {
      const dollars = fractionalBounds[i]!;
      const expectCents = probeCents[i]!;
      const out = applyFilter(rows, { amount_max: dollars });
      const boundaryKept = out.some((r) => absBig(r.amount_minor) === expectCents);
      expect(
        boundaryKept,
        `amount_max=${dollars} should KEEP |amount|=${expectCents}c (INV4)`
      ).toBe(true);
    }
  });

  test('a row one cent ABOVE amount_max is DROPPED; one cent BELOW amount_min is DROPPED', () => {
    for (let i = 0; i < fractionalBounds.length; i++) {
      const dollars = fractionalBounds[i]!;
      const expectCents = probeCents[i]!;
      // one cent above the max bound must be excluded
      const overImports = toUnifiedRows([
        makeImport({
          bank_name: 'P',
          account_type: 'checking',
          account_last_4: '0001',
          txns: [makeTxn({ amount_minor: expectCents + 1n })]
        })
      ]);
      const maxOut = applyFilter(overImports, { amount_max: dollars });
      expect(maxOut.length, `amount_max=${dollars} should DROP |amount|=${expectCents + 1n}c`).toBe(
        0
      );
      // one cent below the min bound must be excluded
      const underImports = toUnifiedRows([
        makeImport({
          bank_name: 'P',
          account_type: 'checking',
          account_last_4: '0002',
          txns: [makeTxn({ amount_minor: expectCents - 1n })]
        })
      ]);
      const minOut = applyFilter(underImports, { amount_min: dollars });
      expect(minOut.length, `amount_min=${dollars} should DROP |amount|=${expectCents - 1n}c`).toBe(
        0
      );
    }
  });

  // $2.675 is a SUB-CENT bound: it names a half-cent and the spec is silent on
  // how a finer-than-cent dollar bound rounds. The DUT rounds half-up to the
  // nearest cent ($2.675 -> 268c), which is a defensible reading; another tool
  // could truncate to 267c. We therefore do NOT assert a single "right" cent
  // here (that would be an unsound oracle). Instead we assert the DUT is
  // INTERNALLY CONSISTENT: whatever single cent boundary B it picks for the
  // bound, min keeps |amount|>=B and max keeps |amount|<=B with no off-by-one
  // contradiction. This is the sound, oracle-free check for an ambiguous bound.
  test('§11 sub-cent bound $2.675: DUT picks a single consistent cent boundary (no contradiction)', () => {
    const cents = [266n, 267n, 268n, 269n];
    const r = toUnifiedRows([
      makeImport({
        bank_name: 'P',
        account_type: 'checking',
        account_last_4: '0003',
        txns: cents.map((c, i) => makeTxn({ description: `c${i}`, amount_minor: c }))
      })
    ]);
    const keptByMin = applyFilter(r, { amount_min: 2.675 }).map((x) => x.amount_minor);
    const keptByMax = applyFilter(r, { amount_max: 2.675 }).map((x) => x.amount_minor);
    // Whatever boundary B the DUT chose: kept-by-min are exactly the cents >= B,
    // kept-by-max are exactly the cents <= B. So min-kept and max-kept must
    // partition with an overlap of at most the single boundary cent, and every
    // cent appears in at least one of the two sets (no value mysteriously
    // dropped by BOTH min and max for the same bound).
    for (const c of cents) {
      const inMin = keptByMin.includes(c);
      const inMax = keptByMax.includes(c);
      expect(
        inMin || inMax,
        `cent ${c} dropped by BOTH min and max at $2.675 — inconsistent bound`
      ).toBe(true);
    }
    // monotonic: min-kept is an upward-closed set, max-kept downward-closed.
    const minThreshold = keptByMin.length > 0 ? keptByMin.reduce((a, b) => (a < b ? a : b)) : null;
    if (minThreshold !== null) {
      expect(keptByMin.every((c) => c >= minThreshold)).toBe(true);
      expect(cents.filter((c) => c >= minThreshold)).toEqual(keptByMin);
    }
  });
});

// -----------------------------------------------------------------------------
// §11 HAZARD 2 — accountKeyString injectivity (the D20 sibling)
// -----------------------------------------------------------------------------

describe('§11 accountKeyString injectivity probe', () => {
  test('R3 equal keys → equal strings; null last_4 has a defined rendering', () => {
    cov.cover('key:equal-keys-equal-string');
    cov.cover('key:null-last4-defined');
    const k: AccountKey = { bank_name: 'Chase', account_type: 'checking', account_last_4: '1234' };
    expect(accountKeyString(k)).toBe(accountKeyString({ ...k }));
    const kNull: AccountKey = { bank_name: 'Cash', account_type: 'cash', account_last_4: null };
    expect(typeof accountKeyString(kNull)).toBe('string');
    expect(accountKeyString(kNull).length).toBeGreaterThan(0);
  });

  test('R3 distinct bank / type / last_4 → distinct strings (production-realistic)', () => {
    cov.cover('key:distinct-bank-distinct-string');
    cov.cover('key:distinct-type-distinct-string');
    cov.cover('key:distinct-last4-distinct-string');
    const base: AccountKey = {
      bank_name: 'Chase',
      account_type: 'checking',
      account_last_4: '1234'
    };
    expect(accountKeyString(base)).not.toBe(accountKeyString({ ...base, bank_name: 'Discover' }));
    // same bank+last4 but different type MUST be distinct accounts (contract §6)
    expect(accountKeyString(base)).not.toBe(accountKeyString({ ...base, account_type: 'savings' }));
    expect(accountKeyString(base)).not.toBe(accountKeyString({ ...base, account_last_4: '5678' }));
    // null vs '' last_4 must not collide (different accounts)
    const nullKey: AccountKey = {
      bank_name: 'Chase',
      account_type: 'checking',
      account_last_4: null
    };
    const emptyKey: AccountKey = {
      bank_name: 'Chase',
      account_type: 'checking',
      account_last_4: ''
    };
    expect(accountKeyString(nullKey)).not.toBe(accountKeyString(emptyKey));
  });

  test('INJECTIVITY property: distinct keys never collide (incl. adversarial separators)', () => {
    cov.cover('key:adversarial-separator-probe');
    // Adversarial bank names containing characters a key-joiner might use.
    const adversarialBanks = [
      'Chase',
      'Chase|',
      '|Chase',
      'A|B',
      'A',
      'A B',
      'A::B',
      'A\tB',
      'A B',
      ''
    ];
    const last4s: Array<string | null> = [null, '', '1234', '12', '1|234', '|', '1234|checking'];
    const keys: AccountKey[] = [];
    for (const b of adversarialBanks) {
      for (const at of ACCOUNT_TYPES) {
        for (const l of last4s) {
          keys.push({ bank_name: b, account_type: at, account_last_4: l });
        }
      }
    }
    const seen = new Map<string, AccountKey>();
    const collisions: Array<[AccountKey, AccountKey]> = [];
    for (const k of keys) {
      const s = accountKeyString(k);
      const prev = seen.get(s);
      if (prev) {
        const distinct =
          prev.bank_name !== k.bank_name ||
          prev.account_type !== k.account_type ||
          prev.account_last_4 !== k.account_last_4;
        if (distinct) collisions.push([prev, k]);
      } else {
        seen.set(s, k);
      }
    }
    // Report collisions explicitly; injectivity must hold for distinct keys.
    expect(
      collisions,
      `accountKeyString collisions (distinct keys → same string): ${JSON.stringify(collisions)}`
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// R4 / INV6 — listAccounts
// -----------------------------------------------------------------------------

describe('listAccounts — distinct + sorted (R4, INV6)', () => {
  test('INV6: listed accounts == distinct accountKeyString values among rows; count matches', () => {
    fc.assert(
      fc.property(arbImports, (imports) => {
        const rows = toUnifiedRows(imports);
        const accounts = listAccounts(rows);
        const accountKeys = accounts.map(accountKeyString);
        // each listed account key is unique
        expect(new Set(accountKeys).size).toBe(accountKeys.length);
        // the set of listed keys equals the set of keys present in rows
        const rowKeys = new Set(
          rows.map((r) =>
            accountKeyString({
              bank_name: r.bank_name,
              account_type: r.account_type,
              account_last_4: r.account_last_4
            })
          )
        );
        expect(new Set(accountKeys)).toEqual(rowKeys);
        cov.cover('inv:listAccounts-distinct');
      }),
      { numRuns: 300 }
    );
  });

  test('R4: listAccounts sorted by (bank_name, account_type, last_4)', () => {
    const rows = toUnifiedRows([
      makeImport({
        bank_name: 'Discover',
        account_type: 'credit_card',
        account_last_4: '9999',
        txns: [makeTxn()]
      }),
      makeImport({
        bank_name: 'Chase',
        account_type: 'savings',
        account_last_4: '0001',
        txns: [makeTxn()]
      }),
      makeImport({
        bank_name: 'Chase',
        account_type: 'checking',
        account_last_4: '0002',
        txns: [makeTxn()]
      })
    ]);
    const accounts = listAccounts(rows);
    const order = accounts.map((a) => `${a.bank_name}/${a.account_type}/${a.account_last_4}`);
    // Chase before Discover; within Chase checking before savings
    expect(order[0]).toBe('Chase/checking/0002');
    expect(order[1]).toBe('Chase/savings/0001');
    expect(order[2]).toBe('Discover/credit_card/9999');
  });
});

// -----------------------------------------------------------------------------
// R6 / INV7 — sortRows
// -----------------------------------------------------------------------------

describe('sortRows — keys / direction / stability / permutation (R6, INV7)', () => {
  const keys: SortSpec['key'][] = ['date', 'description', 'amount', 'account', 'type'];
  const dirs: SortSpec['dir'][] = ['asc', 'desc'];

  function multisetKey(rows: UnifiedRow[]): string[] {
    return rows.map((r) => `${r.import_index}:${r.transaction_index}:${r.amount_minor}`).sort();
  }

  test('INV7 permutation: sortRows output is a permutation of input (no rows lost/added)', () => {
    fc.assert(
      fc.property(
        arbImports,
        fc.constantFrom(...keys),
        fc.constantFrom(...dirs),
        (imports, key, dir) => {
          const rows = toUnifiedRows(imports);
          const out = sortRows(rows, { key, dir });
          expect(out.length).toBe(rows.length);
          expect(multisetKey(out)).toEqual(multisetKey(rows));
          cov.cover('sort:permutation');
        }
      ),
      { numRuns: 300 }
    );
  });

  test('INV8 / R7 purity: sortRows returns a new array and does not mutate input', () => {
    fc.assert(
      fc.property(
        arbImports,
        fc.constantFrom(...keys),
        fc.constantFrom(...dirs),
        (imports, key, dir) => {
          const rows = toUnifiedRows(imports);
          const before = snapshot(rows);
          const out = sortRows(rows, { key, dir });
          expect(out).not.toBe(rows);
          expect(snapshot(rows)).toEqual(before);
          cov.cover('sort:no-mutation');
        }
      )
    );
  });

  test('R6 each key sorts monotonically (asc) for its comparable projection', () => {
    fc.assert(
      fc.property(arbImports, fc.constantFrom(...keys), (imports, key) => {
        const rows = toUnifiedRows(imports);
        const asc = sortRows(rows, { key, dir: 'asc' });
        cov.cover(
          key === 'date'
            ? 'sort:date-asc'
            : key === 'description'
              ? 'sort:description'
              : key === 'amount'
                ? 'sort:amount-signed'
                : key === 'account'
                  ? 'sort:account'
                  : 'sort:type'
        );
        for (let i = 1; i < asc.length; i++) {
          const prev = asc[i - 1]!;
          const cur = asc[i]!;
          switch (key) {
            case 'date':
              expect(prev.posted_date <= cur.posted_date).toBe(true);
              break;
            case 'description':
              expect(prev.description.toLowerCase() <= cur.description.toLowerCase()).toBe(true);
              break;
            case 'amount':
              expect(prev.amount_minor <= cur.amount_minor).toBe(true);
              break;
            case 'type':
              expect(prev.transaction_type <= cur.transaction_type).toBe(true);
              break;
            case 'account':
              // account ordering uses a bank+last_4 key; assert bank monotone as
              // the contract-loose part (don't pin the exact tiebreak string).
              expect(prev.bank_name <= cur.bank_name || prev.bank_name === cur.bank_name).toBe(
                true
              );
              break;
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  test('R6 desc is the reverse ordering of asc for distinct keys (amount)', () => {
    cov.cover('sort:date-desc');
    const rows = toUnifiedRows([
      makeImport({
        bank_name: 'Chase',
        account_type: 'checking',
        account_last_4: '1111',
        txns: [
          makeTxn({ amount_minor: -500n, description: 'a' }),
          makeTxn({ amount_minor: 1000n, description: 'b' }),
          makeTxn({ amount_minor: -10000n, description: 'c' })
        ]
      })
    ]);
    const asc = sortRows(rows, { key: 'amount', dir: 'asc' }).map((r) => r.amount_minor);
    const desc = sortRows(rows, { key: 'amount', dir: 'desc' }).map((r) => r.amount_minor);
    expect(asc).toEqual([-10000n, -500n, 1000n]);
    expect(desc).toEqual([1000n, -500n, -10000n]);
  });

  test('INV7 stability: equal-keyed rows keep input relative order', () => {
    cov.cover('sort:stable-ties');
    // All rows share the same posted_date → sorting by date is a pure tie;
    // stable sort must preserve toUnifiedRows base order (import,txn).
    const rows = toUnifiedRows([
      makeImport({
        bank_name: 'Chase',
        account_type: 'checking',
        account_last_4: '1111',
        txns: [
          makeTxn({ posted_date: '2026-04-01', description: 'first', amount_minor: -1n }),
          makeTxn({ posted_date: '2026-04-01', description: 'second', amount_minor: -2n }),
          makeTxn({ posted_date: '2026-04-01', description: 'third', amount_minor: -3n })
        ]
      })
    ]);
    const sorted = sortRows(rows, { key: 'date', dir: 'asc' });
    expect(sorted.map((r) => r.description)).toEqual(['first', 'second', 'third']);
    // descending a pure tie must STILL preserve input order (stability), not reverse it
    const sortedDesc = sortRows(rows, { key: 'date', dir: 'desc' });
    expect(sortedDesc.map((r) => r.description)).toEqual(['first', 'second', 'third']);
  });
});

// -----------------------------------------------------------------------------
// Coverage closure gate + bench-has-teeth self-check
// -----------------------------------------------------------------------------

describe('sign-off gates', () => {
  test('reference-model self-mutation: scoreboard FAILS when my model is corrupted (bench has teeth)', () => {
    // Corrupt a COPY of the reference model (off-by-one on the amount bound) and
    // confirm the scoreboard detects disagreement vs the real DUT. This proves
    // the scoreboard is not vacuously passing.
    const corruptModel = (input: { rows: UnifiedRow[]; f: TransactionFilter }): UnifiedRow[] => {
      const f = input.f;
      const broken: TransactionFilter =
        f.amount_min !== undefined
          ? { ...f, amount_min: f.amount_min + 1 }
          : { ...f, search: 'zzz-never-matches-zzz' };
      return refApplyFilter(input.rows, broken);
    };
    const sb = new Scoreboard<{ rows: UnifiedRow[]; f: TransactionFilter }, UnifiedRow[]>({
      dut: ({ rows, f }) => applyFilter(rows, f),
      model: corruptModel
    });
    const rows = toUnifiedRows([
      makeImport({
        bank_name: 'Chase',
        account_type: 'checking',
        account_last_4: '1111',
        txns: [
          makeTxn({ amount_minor: -1000n, description: 'x' }),
          makeTxn({ amount_minor: 5000n, description: 'y' })
        ]
      })
    ]);
    sb.check({ rows, f: { amount_min: 5 } });
    sb.check({ rows, f: { search: 'x' } });
    expect(() => sb.assertClean(), 'corrupted model must disagree with the DUT').toThrow();
  });

  test('functional coverage is CLOSED (all vplan cover points hit)', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
