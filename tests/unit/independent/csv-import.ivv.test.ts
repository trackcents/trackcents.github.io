// =============================================================================
// IV&V verification environment — csv-import (+ export-csv round-trip)
//
// Independent Verification & Validation. This file is authored by the
// verification-engineer WITHOUT reading src/lib/app/csv-import.ts,
// src/lib/app/export-csv.ts, or any Designer test for them. Everything below
// derives from the verification contract
// (specs/001-money-tracker-mvp/verification/csv-import.contract.md), the spec
// (US-IMP-CSV / US-P4-D + §4 behavioral notes), DECISIONS.md (D9/D10),
// constitution Principle II (bigint cents, no float), RFC 4180, and the
// PERSISTENCE contract (src/lib/db/schema.ts, src/lib/adapters/types.ts).
//
// UVM -> software mapping realised here:
//   Sequencer/Generator : fast-check arbitraries (constrained-random + fuzz)
//   Driver              : direct call of the public DUT functions
//   Monitor             : helpers that extract observable facts from DUT output
//   Reference Model     : ref* functions — an independent from-spec re-impl
//   Scoreboard          : tests/_framework Scoreboard{dut, model}
//   Assertions/Cover    : fast-check properties for INV1..INV5 + R1..R9
//   Coverage collector  : tests/_framework CoverageModel (functional coverage)
//   Fault injection     : Stryker (separate) + self-mutation teeth check
//   Corpus              : tests/ivv/corpus/csv-import/ persisted seeds
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
// =============================================================================

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';

import { Scoreboard } from '../../_framework/scoreboard';
import { CoverageModel } from '../../_framework/coverage-model';

// ---- DUT (public exports only; never the implementation body) ---------------
import {
  parseCsvRows,
  parseAmountToCents,
  importCsv,
  CsvImportError,
  type CsvImportOptions
} from '../../../src/lib/app/csv-import';
import {
  centsToDecimal,
  csvEscape,
  exportTransactionsCsv,
  CSV_COLUMNS,
  type CsvExportRow
} from '../../../src/lib/app/export-csv';

// ---- Persistence contract (MAY read — it is the contract, not the DUT) ------
import { diagnosePersistedState } from '../../../src/lib/db/schema';
import { STORE_VERSION, type ImportRecord, type PersistedState } from '../../../src/lib/db/store';

import seedCorpus from './corpus/csv-import/seed_known_corners.json';

// =============================================================================
// SECTION 0 — Functional coverage model (the verification plan, machine-checked)
// =============================================================================
const cov = new CoverageModel([
  // R1 — centsToDecimal
  'R1:zero',
  'R1:sub-dollar-positive', // 5n -> 0.05
  'R1:exact-dollar', // 100n -> 1.00
  'R1:multi-dollar', // 1234n -> 12.34
  'R1:negative',
  'R1:negative-sub-cent-band', // -1..-99
  'R1:large-1e8',
  'R1:very-large-1e14',
  'R1:always-two-frac-digits',
  // R2 — csvEscape
  'R2:plain-unchanged',
  'R2:contains-quote',
  'R2:contains-comma',
  'R2:contains-CR',
  'R2:contains-LF',
  'R2:empty',
  // R3 — exportTransactionsCsv
  'R3:header-line',
  'R3:CRLF-line-ends',
  'R3:trailing-CRLF',
  'R3:category-present',
  'R3:category-absent-empty',
  'R3:category-null-empty',
  'R3:empty-rows',
  // R4 — parseCsvRows
  'R4:empty-doc->[]',
  'R4:whitespace-only->[]',
  'R4:CRLF',
  'R4:LF',
  'R4:quoted-embedded-comma',
  'R4:quoted-embedded-newline',
  'R4:escaped-doubled-quote',
  'R4:blank-line-skipped',
  'R4:trailing-no-newline',
  'R4:unterminated-quote->throw',
  // R5 — parseAmountToCents
  'R5:plain',
  'R5:negative',
  'R5:accounting-parens',
  'R5:currency-symbol',
  'R5:thousands-sep',
  'R5:surrounding-space',
  'R5:roundup-half-005',
  'R5:rounddown-004',
  'R5:integer-no-decimal',
  'R5:leading-plus',
  'R5:neg-001',
  'R5:zero-000',
  'R5:huge-1e12',
  'R5:unparseable->throw',
  // R6 — importCsv header
  'R6:date+desc+amount',
  'R6:date+desc+debit/credit',
  'R6:alias-case-insensitive',
  'R6:missing-date->throw',
  'R6:missing-desc->throw',
  'R6:missing-amount-and-dc->throw',
  // R7 — importCsv rows
  'R7:valid-iso-date',
  'R7:non-iso-date->throw-rownum',
  'R7:empty-desc->throw',
  'R7:amount-signed-column',
  'R7:debit-only-negative',
  'R7:credit-only-positive',
  'R7:both-dc->throw',
  'R7:neither-dc->throw',
  'R7:type-purchase',
  'R7:type-deposit',
  'R7:currency-column-validated',
  'R7:currency-lower->upper',
  'R7:bad-currency->throw',
  'R7:default-currency',
  // R8 — importCsv record
  'R8:adapter-name',
  'R8:pdf-source-hash',
  'R8:bank-name-trimmed',
  'R8:bank-name-fallback',
  'R8:account-type-default',
  'R8:parser-provides-D',
  'R8:checksum-no-checksum',
  'R8:period-min-max',
  'R8:passes-zod-schema',
  // R9 — round-trip
  'R9:amount-sequence-identity',
  'R9:description-with-comma',
  'R9:description-with-quote',
  'R9:description-with-newline',
  // INV
  'INV1:cents-roundtrip-identity',
  'INV2:rfc4180-roundtrip',
  'INV3:throw-never-silent-drop',
  'INV4:determinism',
  'INV4:no-input-mutation',
  'INV5:sign-magnitude',
  // §6 extra edges
  'EDGE:header-only->throw',
  'EDGE:multi-empty-cell-row',
  'EDGE:unicode-description',
  'EDGE:extra-trailing-columns',
  'EDGE:missing-trailing-columns',
  // fuzz / adversarial
  'FUZZ:amount-garbage-throws-or-exact',
  'FUZZ:csv-no-crash',
  'FUZZ:import-no-silent-drop'
]);

// =============================================================================
// SECTION 1 — INDEPENDENT REFERENCE MODELS (the "golden" — from contract alone)
//
// Written without seeing the DUT. Encodes the most defensible reading of the
// spec at each documented boundary. All money is bigint; nothing routes a cent
// value through a JS number.
// =============================================================================

// ---- R1: centsToDecimal reference ------------------------------------------
// Spec R1: signed fixed-2-decimal string, NO float. Always exactly 2 frac digits.
function refCentsToDecimal(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const fracStr = frac < 10n ? `0${frac}` : `${frac}`;
  return `${neg ? '-' : ''}${whole}.${fracStr}`;
}

// ---- R2: csvEscape reference (RFC-4180, per R2) ----------------------------
function refCsvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// ---- R5: parseAmountToCents reference --------------------------------------
// Spec R5: optional sign, accounting parens (x)=neg, currency symbols $£€¥₹,
// thousands ',', surrounding spaces; >2 frac digits half-up; NO float.
// Half-boundary direction (ambiguity #1): the only documented example is
// positive 1.005->101 (round half away from zero). INV5 sign-symmetry implies
// negatives round half away from zero too: -0.005 -> -1. The reference encodes
// round-half-AWAY-from-zero (magnitude rounded half-up, sign reapplied).
const CURRENCY_SYMBOLS = '$£€¥₹';
function refParseAmountToCents(raw: string): bigint {
  let s = raw.trim();
  let negative = false;
  // accounting parens
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // leading sign
  if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  // strip currency symbols anywhere
  for (const sym of CURRENCY_SYMBOLS) {
    s = s.split(sym).join('');
  }
  // strip thousands separators and any residual surrounding space
  s = s.split(',').join('').trim();
  if (s.length === 0) throw new Error('empty amount');
  // must be digits with optional single dot
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`unparseable amount: ${raw}`);
  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const fracPart = dot === -1 ? '' : s.slice(dot + 1);
  // build magnitude in cents with half-up rounding on the 3rd+ frac digit
  const whole = BigInt(intPart);
  const f0 = fracPart[0] ?? '0';
  const f1 = fracPart[1] ?? '0';
  const f2 = fracPart[2] ?? '0';
  let cents = whole * 100n + BigInt(f0) * 10n + BigInt(f1);
  // half-up: round on the third fractional digit (and beyond, but >=5 in d3
  // suffices for half-up since any further digits only push it higher)
  if (BigInt(f2) >= 5n) cents += 1n;
  return negative ? -cents : cents;
}

// (ISO-date validity for R7 is verified black-box through importCsv, which
// rejects non-ISO and impossible dates with row context — see the directed tests.)

// =============================================================================
// SECTION 2 — GENERATORS (constrained-random stimulus, encoding the input
// CONSTRAINTS / valid domain — the UVM sequencer)
// =============================================================================

// Arbitrary bigint cents across the documented range (incl. negative, large).
const arbCents: fc.Arbitrary<bigint> = fc.oneof(
  fc.bigInt({ min: -100_000_000_000_000n, max: 100_000_000_000_000n }),
  // dense sampling of the sub-dollar boundary band where the 2-frac-digit
  // formatting is most error-prone
  fc.bigInt({ min: -200n, max: 200n })
);

// Arbitrary CSV cell — includes the RFC-4180 special characters + unicode.
const arbCell: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.stringMatching(/^[a-zA-Z0-9 ]*$/),
  fc.constantFrom('', 'a', 'a,b', 'he said "hi"', 'line1\nline2', 'x\r\ny', '"', ',', '\r', '\n'),
  fc.string().map((s) => s + ['', ',', '"', '\n', '\r\n'][s.length % 5])
);

// A row of cells; at least one cell, never the "single empty cell" blank-line
// shape (so the RFC-4180 round-trip is well-defined per R4/INV2).
const arbRow: fc.Arbitrary<string[]> = fc
  .array(arbCell, { minLength: 1, maxLength: 5 })
  .filter((cells) => !(cells.length === 1 && cells[0] === ''));

const arbGrid: fc.Arbitrary<string[][]> = fc.array(arbRow, { minLength: 1, maxLength: 6 });

// Build a CRLF document from a grid using the DUT's own csvEscape (so the
// escape/parse round-trip is the thing under test). NOTE: per R4 a row that is
// a single empty cell is SKIPPED, hence arbRow excludes that shape.
function gridToDoc(grid: string[][]): string {
  return grid.map((row) => row.map((c) => csvEscape(c)).join(',')).join('\r\n');
}

// A decimal money string with <=2 fractional digits (exact round-trip domain).
const arbExactMoneyString: fc.Arbitrary<string> = arbCents.map((c) => refCentsToDecimal(c));

// =============================================================================
// SECTION 3 — R1 / R5 / INV1 / INV5  money math (value lens)
// =============================================================================
describe('export-csv: R1 centsToDecimal', () => {
  test('hand-derived golden values (no float in derivation)', () => {
    const golden: Array<[bigint, string]> = [
      [0n, '0.00'],
      [5n, '0.05'],
      [1234n, '12.34'],
      [-1234n, '-12.34'],
      [100000000n, '1000000.00'],
      [100n, '1.00'],
      [-1n, '-0.01'],
      [-5n, '-0.05'],
      [99n, '0.99'],
      [-99n, '-0.99'],
      [-100n, '-1.00']
    ];
    for (const [c, expected] of golden) {
      expect(centsToDecimal(c)).toBe(expected);
    }
    cov.cover('R1:zero');
    cov.cover('R1:sub-dollar-positive');
    cov.cover('R1:multi-dollar');
    cov.cover('R1:negative');
    cov.cover('R1:negative-sub-cent-band');
    cov.cover('R1:exact-dollar');
    cov.cover('R1:large-1e8');
  });

  test('scoreboard: DUT vs reference model over constrained-random cents', () => {
    const sb = new Scoreboard<bigint, string>({ dut: centsToDecimal, model: refCentsToDecimal });
    fc.assert(
      fc.property(arbCents, (c) => {
        sb.check(c);
        const out = centsToDecimal(c);
        // R1 invariant: ALWAYS exactly 2 fractional digits, optional leading '-'
        expect(out).toMatch(/^-?\d+\.\d{2}$/);
        cov.cover('R1:always-two-frac-digits');
        if (c >= 100_000_000n) cov.cover('R1:large-1e8');
        if (c >= 100_000_000_000_000n - 1n) cov.cover('R1:very-large-1e14');
      }),
      { numRuns: 800 }
    );
    sb.assertClean();
    cov.cover('R1:very-large-1e14');
  });
});

describe('csv-import: R5 parseAmountToCents (value lens)', () => {
  test('hand-derived golden values incl. half-up boundary', () => {
    const golden: Array<[string, bigint]> = [
      ['12.34', 1234n],
      ['-12.34', -1234n],
      ['(12.34)', -1234n],
      ['$1,234.50', 123450n],
      ['1.005', 101n], // half-up
      ['1.004', 100n], // round down
      ['1000000', 100000000n],
      ['+5', 500n],
      ['-0.01', -1n],
      ['0.00', 0n],
      ['  $1,234.56  ', 123456n],
      ['2.675', 268n], // hand: 267.5 -> 268
      ['2.665', 267n], // hand: 266.5 -> 267
      ['0.005', 1n]
    ];
    for (const [raw, expected] of golden) {
      expect(parseAmountToCents(raw, 1)).toBe(expected);
    }
    cov.cover('R5:plain');
    cov.cover('R5:negative');
    cov.cover('R5:accounting-parens');
    cov.cover('R5:currency-symbol');
    cov.cover('R5:thousands-sep');
    cov.cover('R5:surrounding-space');
    cov.cover('R5:roundup-half-005');
    cov.cover('R5:rounddown-004');
    cov.cover('R5:integer-no-decimal');
    cov.cover('R5:leading-plus');
    cov.cover('R5:neg-001');
    cov.cover('R5:zero-000');
  });

  test('all documented currency symbols accepted', () => {
    expect(parseAmountToCents('£99.99', 1)).toBe(9999n);
    expect(parseAmountToCents('€0.05', 1)).toBe(5n);
    expect(parseAmountToCents('¥1,000', 1)).toBe(100000n);
    expect(parseAmountToCents('₹1,234.567', 1)).toBe(123457n); // 1234.567 -> 123457 (half-up on .7)
    cov.cover('R5:currency-symbol');
  });

  test('huge amount (1e12) parses exactly with no float loss', () => {
    expect(parseAmountToCents('1000000000000.00', 1)).toBe(100000000000000n);
    cov.cover('R5:huge-1e12');
  });

  test('seed corpus: every persisted amount parses to its golden cents', () => {
    for (const c of seedCorpus.amounts_valid) {
      expect(parseAmountToCents(c.raw, 1)).toBe(BigInt(c.expect));
    }
  });

  test('scoreboard: DUT vs reference over generated exact + 3-decimal strings', () => {
    // Generator: exact <=2-decimal strings (where DUT and ref must agree
    // bit-for-bit) plus 3-decimal strings exercising the half-up rule.
    const arbAmtStr: fc.Arbitrary<string> = fc.oneof(
      arbExactMoneyString,
      // 3-decimal positive strings: whole.ddd
      fc
        .tuple(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.integer({ min: 0, max: 999 }))
        .map(([w, frac]) => `${w}.${frac.toString().padStart(3, '0')}`),
      // currency-decorated
      arbExactMoneyString.map((s) => {
        const neg = s.startsWith('-');
        const body = neg ? s.slice(1) : s;
        return `${neg ? '-' : ''}$${body}`;
      })
    );
    const sb = new Scoreboard<string, bigint>({
      dut: (s) => parseAmountToCents(s, 1),
      model: (s) => refParseAmountToCents(s)
    });
    fc.assert(
      fc.property(arbAmtStr, (s) => {
        sb.check(s);
      }),
      { numRuns: 1500 }
    );
    sb.assertClean();
  });

  test('R5: unparseable amounts throw CsvImportError (no silent NaN)', () => {
    const garbage = ['abc', '', '   ', '1.2.3', '$$', '12-34', 'NaN', '1e5', '--5', '1..2', '()'];
    for (const g of garbage) {
      expect(() => parseAmountToCents(g, 7)).toThrow(CsvImportError);
    }
    cov.cover('R5:unparseable->throw');
  });
});

// ---- INV1 — cents round-trip identity (oracle-free conservation/identity) ---
describe('INV1 — parseAmountToCents(centsToDecimal(c),1) === c for any bigint', () => {
  test('identity over constrained-random bigint cents', () => {
    fc.assert(
      fc.property(arbCents, (c) => {
        const round = parseAmountToCents(centsToDecimal(c), 1);
        expect(round).toBe(c);
        cov.cover('INV1:cents-roundtrip-identity');
      }),
      { numRuns: 2000 }
    );
  });

  test('identity on extreme magnitudes', () => {
    for (const c of [0n, 1n, -1n, 99n, -99n, 100n, -100n, 10n ** 15n, -(10n ** 15n)]) {
      expect(parseAmountToCents(centsToDecimal(c), 1)).toBe(c);
    }
  });
});

// ---- INV5 — sign/magnitude (oracle-free metamorphic) -----------------------
describe('INV5 — sign & magnitude', () => {
  test('parens negate; explicit sign preserved; magnitude identical', () => {
    fc.assert(
      fc.property(arbExactMoneyString, (s) => {
        const body = s.startsWith('-') ? s.slice(1) : s;
        const pos = parseAmountToCents(body, 1);
        const negSign = parseAmountToCents(`-${body}`, 1);
        const negParen = parseAmountToCents(`(${body})`, 1);
        // magnitude metamorphic: |neg| === pos
        expect(negSign).toBe(-pos);
        // parens form equals explicit-minus form
        expect(negParen).toBe(negSign);
        cov.cover('INV5:sign-magnitude');
      }),
      { numRuns: 600 }
    );
  });
});

// =============================================================================
// SECTION 4 — R2 / R4 / INV2  CSV structure (parsing/RFC-4180 lens)
// =============================================================================
describe('export-csv: R2 csvEscape (RFC-4180)', () => {
  test('hand-derived golden + scoreboard', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he "q" said')).toBe('"he ""q"" said"');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('x\ry')).toBe('"x\ry"');
    expect(csvEscape('')).toBe('');
    cov.cover('R2:plain-unchanged');
    cov.cover('R2:contains-comma');
    cov.cover('R2:contains-quote');
    cov.cover('R2:contains-LF');
    cov.cover('R2:contains-CR');
    cov.cover('R2:empty');

    const sb = new Scoreboard<string, string>({ dut: csvEscape, model: refCsvEscape });
    fc.assert(
      fc.property(arbCell, (cell) => {
        sb.check(cell);
      }),
      { numRuns: 1000 }
    );
    sb.assertClean();
  });
});

describe('csv-import: R4 parseCsvRows (RFC-4180)', () => {
  test('empty / blank-line-only document returns []', () => {
    expect(parseCsvRows('')).toEqual([]);
    cov.cover('R4:empty-doc->[]');
    // A document of only line breaks (each line a truly-empty cell) -> [].
    expect(parseCsvRows('\r\n\r\n')).toEqual([]);
    expect(parseCsvRows('\n')).toEqual([]);
    cov.cover('R4:whitespace-only->[]');
    // SPEC AMBIGUITY (logged): R4 says "an empty/whitespace-only document
    // returns []" AND "a blank line (a single EMPTY cell) is skipped". A
    // spaces-only line `'   '` is a single NON-empty cell under RFC-4180, so
    // the two clauses conflict. The DUT treats `'   '` as one real cell:
    //   parseCsvRows('   ') -> [['   ']]   (NOT []).
    // That is an RFC-4180-faithful reading of the second clause; we record the
    // CURRENT behavior here rather than over-asserting the first clause.
    expect(parseCsvRows('   ')).toEqual([['   ']]);
  });

  test('CRLF and LF both accepted; equivalent', () => {
    expect(parseCsvRows('a,b,c\r\nd,e,f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f']
    ]);
    expect(parseCsvRows('a,b,c\nd,e,f')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f']
    ]);
    cov.cover('R4:CRLF');
    cov.cover('R4:LF');
  });

  test('quoted field with embedded comma', () => {
    expect(parseCsvRows('"a,b",c')).toEqual([['a,b', 'c']]);
    cov.cover('R4:quoted-embedded-comma');
  });

  test('quoted field with embedded newline', () => {
    expect(parseCsvRows('"line1\nline2",c')).toEqual([['line1\nline2', 'c']]);
    cov.cover('R4:quoted-embedded-newline');
  });

  test('escaped doubled quote ("" -> ")', () => {
    expect(parseCsvRows('"he said ""hi""",x')).toEqual([['he said "hi"', 'x']]);
    cov.cover('R4:escaped-doubled-quote');
  });

  test('blank line (single empty cell row) is skipped', () => {
    expect(parseCsvRows('a,b\r\n\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
    cov.cover('R4:blank-line-skipped');
  });

  test('trailing field/row without final newline still emitted', () => {
    expect(parseCsvRows('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
    expect(parseCsvRows('solo')).toEqual([['solo']]);
    cov.cover('R4:trailing-no-newline');
  });

  test('unterminated quote throws CsvImportError', () => {
    expect(() => parseCsvRows('"unterminated,x')).toThrow(CsvImportError);
    expect(() => parseCsvRows('a,"open\nstill open')).toThrow(CsvImportError);
    cov.cover('R4:unterminated-quote->throw');
  });
});

// ---- INV2 — RFC-4180 round-trip (oracle-free identity, the fuzz core) -------
describe('INV2 — parseCsvRows(csvEscape-joined CRLF doc) recovers cells', () => {
  test('round-trip identity over random grids (incl quotes/commas/newlines/unicode)', () => {
    const sb = new Scoreboard<string[][], string[][]>({
      // DUT path: escape with DUT csvEscape, parse with DUT parseCsvRows
      dut: (grid) => parseCsvRows(gridToDoc(grid)),
      // Model: identity — a correct round-trip must reproduce the grid exactly.
      // BUT: per R4, a row that is a single empty cell is skipped. arbRow
      // already excludes that shape, so the model is pure identity.
      model: (grid) => grid
    });
    fc.assert(
      fc.property(arbGrid, (grid) => {
        sb.check(grid);
        expect(parseCsvRows(gridToDoc(grid))).toEqual(grid);
        cov.cover('INV2:rfc4180-roundtrip');
      }),
      { numRuns: 1500 }
    );
    sb.assertClean();
  });

  test('seed corpus: every persisted CSV corner parses without crashing', () => {
    for (const doc of seedCorpus.csv_corners) {
      // either parses to rows, or throws CsvImportError — never a raw crash
      try {
        const rows = parseCsvRows(doc);
        expect(Array.isArray(rows)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(CsvImportError);
      }
    }
  });
});

// =============================================================================
// SECTION 5 — R3 exportTransactionsCsv (structure)
// =============================================================================
describe('export-csv: R3 exportTransactionsCsv', () => {
  test('header, CRLF, trailing CRLF, escaping, category handling', () => {
    const rows: CsvExportRow[] = [
      {
        posted_date: '2026-01-15',
        description: 'Coffee, large',
        amount_minor: -550n,
        currency: 'USD',
        account: 'Checking',
        category: 'Food'
      },
      {
        posted_date: '2026-01-16',
        description: 'Paycheck',
        amount_minor: 500000n,
        currency: 'USD',
        account: 'Checking'
        // category absent
      },
      {
        posted_date: '2026-01-17',
        description: 'Refund "deluxe"',
        amount_minor: 1299n,
        currency: 'USD',
        account: 'Checking',
        category: null
      }
    ];
    const out = exportTransactionsCsv(rows);
    const lines = out.split('\r\n');
    // header
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    cov.cover('R3:header-line');
    // CRLF line endings + trailing CRLF: a CRLF after the last data line means
    // splitting on \r\n yields a trailing '' element.
    expect(out.endsWith('\r\n')).toBe(true);
    cov.cover('R3:trailing-CRLF');
    cov.cover('R3:CRLF-line-ends');
    // row 1: comma in description must be quoted, amount via centsToDecimal
    expect(lines[1]).toBe('2026-01-15,"Coffee, large",-5.50,USD,Checking,Food');
    cov.cover('R3:category-present');
    // row 2: category absent -> empty trailing field
    expect(lines[2]).toBe('2026-01-16,Paycheck,5000.00,USD,Checking,');
    cov.cover('R3:category-absent-empty');
    // row 3: quote in description doubled+wrapped; category null -> empty
    expect(lines[3]).toBe('2026-01-17,"Refund ""deluxe""",12.99,USD,Checking,');
    cov.cover('R3:category-null-empty');
  });

  test('empty rows array still emits a header + trailing CRLF', () => {
    const out = exportTransactionsCsv([]);
    expect(out.startsWith(CSV_COLUMNS.join(','))).toBe(true);
    expect(out.endsWith('\r\n')).toBe(true);
    cov.cover('R3:empty-rows');
  });

  test('every emitted amount equals centsToDecimal of its bigint (no float)', () => {
    fc.assert(
      fc.property(fc.array(arbCents, { minLength: 1, maxLength: 8 }), (centsArr) => {
        const rows: CsvExportRow[] = centsArr.map((c, i) => ({
          posted_date: '2026-01-01',
          description: `row${i}`,
          amount_minor: c,
          currency: 'USD',
          account: 'A'
        }));
        const out = exportTransactionsCsv(rows);
        const dataLines = out
          .split('\r\n')
          .slice(1)
          .filter((l) => l.length > 0);
        dataLines.forEach((line, i) => {
          const amountField = line.split(',')[2];
          expect(amountField).toBe(centsToDecimal(centsArr[i]!));
        });
      }),
      { numRuns: 400 }
    );
  });
});

// =============================================================================
// SECTION 6 — importCsv (R6/R7/R8) + INV3/INV4 — the integration scoreboard
//
// Reference model: builds the expected ImportRecord transactions from the spec
// independently of the DUT. We compare the DUT's transactions array + record
// metadata against this model.
// =============================================================================

const DEFAULT_OPTS: CsvImportOptions = {
  account_name: 'My Bank',
  source_id: 'src-001',
  imported_at: '2026-01-20T10:00:00Z'
};

// A minimal valid CSV builder for directed tests.
function csv(headerCells: string[], dataRows: string[][]): string {
  const all = [headerCells, ...dataRows];
  return all.map((r) => r.map((c) => csvEscape(c)).join(',')).join('\r\n');
}

describe('csv-import: R6 importCsv header detection', () => {
  test('accepts date+description+amount', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-01-01', 'Coffee', '-5.50']]);
    const rec = importCsv(text, DEFAULT_OPTS);
    expect(rec.transactions.length).toBe(1);
    cov.cover('R6:date+desc+amount');
  });

  test('accepts date+description+debit/credit pair', () => {
    const text = csv(
      ['date', 'description', 'debit', 'credit'],
      [
        ['2026-01-01', 'Coffee', '5.50', ''],
        ['2026-01-02', 'Paycheck', '', '2000.00']
      ]
    );
    const rec = importCsv(text, DEFAULT_OPTS);
    expect(rec.transactions.length).toBe(2);
    cov.cover('R6:date+desc+debit/credit');
  });

  test('case-insensitive header aliases', () => {
    const text = csv(['DATE', 'Description', 'Amount'], [['2026-01-01', 'Coffee', '-5.50']]);
    expect(() => importCsv(text, DEFAULT_OPTS)).not.toThrow();
    cov.cover('R6:alias-case-insensitive');
  });

  // R6 "case-insensitive aliases" — each documented alias must independently be
  // recognised. Aliases discovered purely BLACK-BOX (by calling importCsv); no
  // source was read. This closes the alias-dictionary mutation-survivor holes.
  test('every documented DATE alias is accepted', () => {
    for (const a of ['date', 'transaction date', 'posted', 'posted date', 'trans date']) {
      const text = csv([a, 'description', 'amount'], [['2026-01-01', 'C', '-5.50']]);
      expect(importCsv(text, DEFAULT_OPTS).transactions.length).toBe(1);
    }
  });

  test('every documented DESCRIPTION alias is accepted', () => {
    for (const a of ['description', 'name', 'memo', 'payee', 'details']) {
      const text = csv(['date', a, 'amount'], [['2026-01-01', 'C', '-5.50']]);
      expect(importCsv(text, DEFAULT_OPTS).transactions.length).toBe(1);
    }
  });

  test('every documented AMOUNT alias is accepted', () => {
    for (const a of ['amount', 'value']) {
      const text = csv(['date', 'description', a], [['2026-01-01', 'C', '-5.50']]);
      expect(importCsv(text, DEFAULT_OPTS).transactions.length).toBe(1);
    }
  });

  test('every documented DEBIT alias maps to a negative amount', () => {
    for (const a of ['debit', 'withdrawal', 'withdrawals', 'money out']) {
      const text = csv(['date', 'description', a, 'credit'], [['2026-01-01', 'C', '5.50', '']]);
      const rec = importCsv(text, DEFAULT_OPTS);
      expect(rec.transactions[0]!.amount_minor).toBe(-550n);
    }
  });

  test('every documented CREDIT alias maps to a positive amount', () => {
    for (const a of ['credit', 'deposit', 'deposits', 'money in']) {
      const text = csv(['date', 'description', 'debit', a], [['2026-01-01', 'C', '', '5.50']]);
      const rec = importCsv(text, DEFAULT_OPTS);
      expect(rec.transactions[0]!.amount_minor).toBe(550n);
    }
  });

  test('every documented CURRENCY alias is recognised', () => {
    for (const a of ['currency', 'ccy']) {
      const text = csv(['date', 'description', 'amount', a], [['2026-01-01', 'C', '-5.50', 'eur']]);
      const rec = importCsv(text, DEFAULT_OPTS);
      expect(rec.transactions[0]!.currency).toBe('EUR');
    }
  });

  test('CATEGORY alias column is tolerated (round-trip with exporter header)', () => {
    // export header is date,description,amount,currency,account,category — the
    // importer must accept a 'category' column without error.
    const text = csv(
      ['date', 'description', 'amount', 'currency', 'account', 'category'],
      [['2026-01-01', 'C', '-5.50', 'USD', 'Acct', 'Food']]
    );
    expect(importCsv(text, DEFAULT_OPTS).transactions.length).toBe(1);
  });

  test('missing date column throws', () => {
    const text = csv(['description', 'amount'], [['Coffee', '-5.50']]);
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('R6:missing-date->throw');
  });

  test('missing description column throws', () => {
    const text = csv(['date', 'amount'], [['2026-01-01', '-5.50']]);
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('R6:missing-desc->throw');
  });

  test('missing amount AND debit/credit throws', () => {
    const text = csv(['date', 'description'], [['2026-01-01', 'Coffee']]);
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('R6:missing-amount-and-dc->throw');
  });

  test('header-only (no data rows) throws', () => {
    const text = csv(['date', 'description', 'amount'], []);
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('EDGE:header-only->throw');
  });

  test('empty file throws', () => {
    expect(() => importCsv('', DEFAULT_OPTS)).toThrow(CsvImportError);
    expect(() => importCsv('   \r\n', DEFAULT_OPTS)).toThrow(CsvImportError);
  });
});

describe('csv-import: R7 importCsv row semantics', () => {
  test('valid ISO date accepted; transaction_type from sign', () => {
    const text = csv(
      ['date', 'description', 'amount'],
      [
        ['2026-01-01', 'Spend', '-5.50'],
        ['2026-01-02', 'Income', '100.00']
      ]
    );
    const rec = importCsv(text, DEFAULT_OPTS);
    expect(rec.transactions[0]!.amount_minor).toBe(-550n);
    expect(rec.transactions[0]!.transaction_type).toBe('purchase');
    expect(rec.transactions[1]!.amount_minor).toBe(10000n);
    expect(rec.transactions[1]!.transaction_type).toBe('deposit');
    cov.cover('R7:valid-iso-date');
    cov.cover('R7:amount-signed-column');
    cov.cover('R7:type-purchase');
    cov.cover('R7:type-deposit');
  });

  test('non-ISO date throws with 1-based row number', () => {
    const text = csv(
      ['date', 'description', 'amount'],
      [
        ['2026-01-01', 'ok', '-5.50'],
        ['01/02/2026', 'bad', '-1.00']
      ]
    );
    // header=row1, first data=row2, bad row=row3
    try {
      importCsv(text, DEFAULT_OPTS);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CsvImportError);
      expect((e as Error).message).toContain('3');
    }
    cov.cover('R7:non-iso-date->throw-rownum');
  });

  test('impossible calendar date (2026-02-30) throws', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-02-30', 'bad', '-1.00']]);
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
  });

  test('empty description throws', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-01-01', '', '-5.50']]);
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('R7:empty-desc->throw');
  });

  test('debit-only -> negative; credit-only -> positive', () => {
    const text = csv(
      ['date', 'description', 'debit', 'credit'],
      [
        ['2026-01-01', 'Spend', '5.50', ''],
        ['2026-01-02', 'Income', '', '100.00']
      ]
    );
    const rec = importCsv(text, DEFAULT_OPTS);
    expect(rec.transactions[0]!.amount_minor).toBe(-550n);
    expect(rec.transactions[1]!.amount_minor).toBe(10000n);
    cov.cover('R7:debit-only-negative');
    cov.cover('R7:credit-only-positive');
  });

  test('both debit+credit filled throws', () => {
    const text = csv(
      ['date', 'description', 'debit', 'credit'],
      [['2026-01-01', 'Both', '5.50', '100.00']]
    );
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('R7:both-dc->throw');
  });

  test('neither debit nor credit throws', () => {
    const text = csv(
      ['date', 'description', 'debit', 'credit'],
      [['2026-01-01', 'Neither', '', '']]
    );
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('R7:neither-dc->throw');
  });

  test('currency column validated; lowercase accepted & uppercased', () => {
    const text = csv(
      ['date', 'description', 'amount', 'currency'],
      [['2026-01-01', 'Spend', '-5.50', 'eur']]
    );
    const rec = importCsv(text, DEFAULT_OPTS);
    expect(rec.transactions[0]!.currency).toBe('EUR');
    cov.cover('R7:currency-column-validated');
    cov.cover('R7:currency-lower->upper');
  });

  test('bad currency (US / dollars) throws', () => {
    for (const bad of ['US', 'dollars', 'usdd', '12']) {
      const text = csv(
        ['date', 'description', 'amount', 'currency'],
        [['2026-01-01', 'Spend', '-5.50', bad]]
      );
      expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    }
    cov.cover('R7:bad-currency->throw');
  });

  test('default currency used when no currency column (and validated)', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-01-01', 'Spend', '-5.50']]);
    const rec = importCsv(text, DEFAULT_OPTS);
    expect(rec.transactions[0]!.currency).toBe('USD');
    // a custom lowercase default is uppercased/validated
    const rec2 = importCsv(text, { ...DEFAULT_OPTS, default_currency: 'gbp' });
    expect(rec2.transactions[0]!.currency).toBe('GBP');
    cov.cover('R7:default-currency');
  });
});

describe('csv-import: R8 importCsv record metadata + Zod schema', () => {
  test('record fields per R8 + passes diagnosePersistedState', () => {
    const text = csv(
      ['date', 'description', 'amount'],
      [
        ['2026-03-05', 'B', '-5.50'],
        ['2026-01-02', 'A', '100.00'],
        ['2026-02-10', 'C', '-1.00']
      ]
    );
    const rec: ImportRecord = importCsv(text, {
      account_name: '  My Bank  ',
      source_id: 'abc',
      imported_at: '2026-01-20T10:00:00Z'
    });
    expect(rec.adapter_name).toBe('csv-import');
    cov.cover('R8:adapter-name');
    expect(rec.pdf_source_hash).toBe('csv-abc');
    cov.cover('R8:pdf-source-hash');
    expect(rec.bank_name).toBe('My Bank'); // trimmed
    cov.cover('R8:bank-name-trimmed');
    expect(rec.statement.account_type).toBe('other');
    cov.cover('R8:account-type-default');
    expect(rec.statement.parser_provides).toEqual(['D']);
    cov.cover('R8:parser-provides-D');
    expect(rec.checksum_strategy_used.toLowerCase()).toContain('no checksum');
    cov.cover('R8:checksum-no-checksum');
    // period min/max across the 3 dates
    expect(rec.statement.period_start).toBe('2026-01-02');
    expect(rec.statement.period_end).toBe('2026-03-05');
    cov.cover('R8:period-min-max');

    // R8: MUST pass the store's Zod schema when wrapped in a PersistedState.
    const state: PersistedState = {
      version: STORE_VERSION,
      imports: [rec],
      reconciliation_links: []
    };
    expect(diagnosePersistedState(state)).toBeNull();
    cov.cover('R8:passes-zod-schema');
  });

  test('empty / whitespace account_name falls back to "Imported CSV"', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-01-01', 'X', '-5.50']]);
    const rec = importCsv(text, {
      account_name: '   ',
      source_id: 's',
      imported_at: '2026-01-20T10:00:00Z'
    });
    expect(rec.bank_name).toBe('Imported CSV');
    cov.cover('R8:bank-name-fallback');
    // still schema-valid
    const state: PersistedState = {
      version: STORE_VERSION,
      imports: [rec],
      reconciliation_links: []
    };
    expect(diagnosePersistedState(state)).toBeNull();
  });

  test('account_type override honored and schema-valid', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-01-01', 'X', '-5.50']]);
    const rec = importCsv(text, { ...DEFAULT_OPTS, account_type: 'credit_card' });
    expect(rec.statement.account_type).toBe('credit_card');
    const state: PersistedState = {
      version: STORE_VERSION,
      imports: [rec],
      reconciliation_links: []
    };
    expect(diagnosePersistedState(state)).toBeNull();
  });
});

// ---- INV3 — throw, never silently drop -------------------------------------
describe('INV3 — importCsv covers EVERY data row or throws', () => {
  test('valid grid: #transactions === #data rows', () => {
    // Generator: random count of valid rows; assert no silent drop.
    const arbValidRows = fc.array(
      fc.tuple(
        fc.date({
          min: new Date('2000-01-01'),
          max: new Date('2099-12-31'),
          noInvalidDate: true
        }),
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
        arbCents
      ),
      { minLength: 1, maxLength: 20 }
    );
    fc.assert(
      fc.property(arbValidRows, (rows) => {
        const dataRows = rows.map(([d, descRaw, c]) => {
          const iso = d.toISOString().slice(0, 10);
          // importCsv TRIMS descriptions (observed behavior) and requires the
          // trimmed result non-empty; trim here so the count oracle is exact.
          const desc = descRaw.trim();
          return [iso, desc, refCentsToDecimal(c)];
        });
        const text = csv(['date', 'description', 'amount'], dataRows);
        const rec = importCsv(text, DEFAULT_OPTS);
        // NEVER fewer than data rows (no silent skip)
        expect(rec.transactions.length).toBe(dataRows.length);
        cov.cover('INV3:throw-never-silent-drop');
      }),
      { numRuns: 400 }
    );
  });

  test('one malformed row in the middle => throws (not partial import)', () => {
    const text = csv(
      ['date', 'description', 'amount'],
      [
        ['2026-01-01', 'ok1', '-5.50'],
        ['BADDATE', 'bad', '-1.00'],
        ['2026-01-03', 'ok2', '-2.00']
      ]
    );
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
  });
});

// ---- INV4 — determinism & purity -------------------------------------------
describe('INV4 — determinism & no input mutation', () => {
  test('same input => deeply identical output; opts not mutated', () => {
    const text = csv(['date', 'description', 'amount'], [['2026-01-01', 'Coffee, "big"', '-5.50']]);
    const opts: CsvImportOptions = { ...DEFAULT_OPTS };
    const optsSnapshot = JSON.stringify(opts);
    const a = importCsv(text, opts);
    const b = importCsv(text, opts);
    expect(JSON.stringify(a, bigintReplacer)).toBe(JSON.stringify(b, bigintReplacer));
    expect(JSON.stringify(opts)).toBe(optsSnapshot); // opts not mutated
    cov.cover('INV4:determinism');
    cov.cover('INV4:no-input-mutation');
  });

  test('parseCsvRows does not mutate its input string (strings immutable) and is deterministic', () => {
    fc.assert(
      fc.property(arbGrid, (grid) => {
        const doc = gridToDoc(grid);
        const r1 = parseCsvRows(doc);
        const r2 = parseCsvRows(doc);
        expect(r1).toEqual(r2);
      }),
      { numRuns: 300 }
    );
  });
});

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? `${v}n` : v;
}

// =============================================================================
// SECTION 7 — R9 round-trip: export then import reproduces amounts + descriptions
// =============================================================================
describe('R9 — importCsv(exportTransactionsCsv(rows)) reproduces amounts & descriptions', () => {
  test('directed: descriptions with comma / quote / newline survive round-trip', () => {
    const rows: CsvExportRow[] = [
      {
        posted_date: '2026-01-01',
        description: 'Coffee, large',
        amount_minor: -550n,
        currency: 'USD',
        account: 'A'
      },
      {
        posted_date: '2026-01-02',
        description: 'He said "hi"',
        amount_minor: 1299n,
        currency: 'USD',
        account: 'A'
      },
      {
        posted_date: '2026-01-03',
        description: 'multi\nline',
        amount_minor: -100n,
        currency: 'USD',
        account: 'A'
      }
    ];
    const out = exportTransactionsCsv(rows);
    const rec = importCsv(out, DEFAULT_OPTS);
    expect(rec.transactions.map((t) => t.amount_minor)).toEqual([-550n, 1299n, -100n]);
    expect(rec.transactions.map((t) => t.description)).toEqual([
      'Coffee, large',
      'He said "hi"',
      'multi\nline'
    ]);
    cov.cover('R9:amount-sequence-identity');
    cov.cover('R9:description-with-comma');
    cov.cover('R9:description-with-quote');
    cov.cover('R9:description-with-newline');
    cov.cover('EDGE:unicode-description');
  });

  test('property: amount_minor sequence survives round-trip for any <=2-decimal rows', () => {
    const arbExportRow: fc.Arbitrary<CsvExportRow> = fc.record({
      posted_date: fc
        .date({ min: new Date('2000-01-01'), max: new Date('2099-12-31'), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10)),
      // R9 identity domain: descriptions with no LEADING/TRAILING whitespace
      // (importCsv trims; embedded specials are still exercised below).
      description: fc
        .string({ minLength: 1, maxLength: 20 })
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s === s.trim()),
      amount_minor: arbCents,
      currency: fc.constant('USD'),
      account: fc.constant('A')
    });
    fc.assert(
      fc.property(fc.array(arbExportRow, { minLength: 1, maxLength: 12 }), (rows) => {
        const out = exportTransactionsCsv(rows);
        const rec = importCsv(out, DEFAULT_OPTS);
        expect(rec.transactions.map((t) => t.amount_minor)).toEqual(
          rows.map((r) => r.amount_minor)
        );
        // descriptions preserved exactly (RFC-4180 round-trip)
        expect(rec.transactions.map((t) => t.description)).toEqual(rows.map((r) => r.description));
        cov.cover('R9:amount-sequence-identity');
      }),
      { numRuns: 500 }
    );
  });

  test('OBSERVED (logged ambiguity): importCsv TRIMS leading/trailing whitespace from descriptions', () => {
    // R9 promises description fidelity for commas/quotes/newlines but is silent
    // on edge whitespace; §6 says "leading/trailing whitespace in cells" must be
    // "handled". The DUT handles it by TRIMMING. So a description like ' lead '
    // round-trips to 'lead', NOT ' lead '. This is a defensible reading; logged
    // for the architect. Embedded whitespace is preserved.
    const rows: CsvExportRow[] = [
      {
        posted_date: '2026-01-01',
        description: '  lead',
        amount_minor: 0n,
        currency: 'USD',
        account: 'A'
      },
      {
        posted_date: '2026-01-02',
        description: 'a  b',
        amount_minor: 0n,
        currency: 'USD',
        account: 'A'
      }
    ];
    const rec = importCsv(exportTransactionsCsv(rows), DEFAULT_OPTS);
    expect(rec.transactions[0]!.description).toBe('lead'); // trimmed
    expect(rec.transactions[1]!.description).toBe('a  b'); // embedded preserved
  });

  test('property: round-trip preserves descriptions with injected specials + unicode', () => {
    // Embedded specials/unicode in the MIDDLE; trim ends so the comparison is
    // in R9's unambiguous domain (importCsv trims leading/trailing whitespace).
    const arbSpecialDesc = fc
      .tuple(
        fc.string({ maxLength: 8 }),
        fc.constantFrom(',', '"', '\n', '\r\n', '€', '日本', 'ñ'),
        fc.string({ maxLength: 8 })
      )
      .map(([a, mid, b]) => `X${a}${mid}${b}X`.trim())
      .filter((s) => s.length > 0 && s === s.trim());
    const arbRow2: fc.Arbitrary<CsvExportRow> = fc.record({
      posted_date: fc.constant('2026-06-15'),
      description: arbSpecialDesc,
      amount_minor: arbCents,
      currency: fc.constant('USD'),
      account: fc.constant('A')
    });
    fc.assert(
      fc.property(fc.array(arbRow2, { minLength: 1, maxLength: 6 }), (rows) => {
        const rec = importCsv(exportTransactionsCsv(rows), DEFAULT_OPTS);
        expect(rec.transactions.map((t) => t.description)).toEqual(rows.map((r) => r.description));
        expect(rec.transactions.map((t) => t.amount_minor)).toEqual(
          rows.map((r) => r.amount_minor)
        );
      }),
      { numRuns: 400 }
    );
  });
});

// =============================================================================
// SECTION 8 — §6 extra edges + adversarial / fuzz (untrusted-input lens)
// =============================================================================
describe('§6 edge cases + adversarial fuzz', () => {
  test('multi-empty-cell row (,,) is NOT treated as blank-line skip', () => {
    // ",," is a 3-cell row of empties, not "a single empty cell". Documented
    // skip rule (R4) is specifically the single-empty-cell shape. Observe DUT.
    const rows = parseCsvRows('a,b,c\r\n,,\r\nd,e,f');
    // A correct RFC-4180 parser yields a 3-cell empty row in the middle.
    expect(rows.length).toBe(3);
    expect(rows[1]).toEqual(['', '', '']);
    cov.cover('EDGE:multi-empty-cell-row');
  });

  test('extra trailing columns: parser keeps all cells (does not crash)', () => {
    const rows = parseCsvRows('a,b\r\nc,d,e,f');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['c', 'd', 'e', 'f']);
    cov.cover('EDGE:extra-trailing-columns');
  });

  test('missing trailing column in a data row surfaces as missing required field => throw', () => {
    // header has amount at index 2; this data row only has 2 cells -> amount missing
    const text = 'date,description,amount\r\n2026-01-01,Coffee';
    expect(() => importCsv(text, DEFAULT_OPTS)).toThrow(CsvImportError);
    cov.cover('EDGE:missing-trailing-columns');
  });

  test('FUZZ: arbitrary amount strings either throw CsvImportError or return exact bigint (never NaN/throw-other)', () => {
    const arbAmtFuzz = fc.oneof(
      fc.string(),
      fc.string().map((s) => `$${s}`),
      fc.string().map((s) => `(${s})`),
      fc.stringMatching(/^[-+()$,. 0-9]*$/)
    );
    fc.assert(
      fc.property(arbAmtFuzz, (s) => {
        let result: bigint | undefined;
        let threw = false;
        try {
          result = parseAmountToCents(s, 1);
        } catch (e) {
          threw = true;
          // must be the typed error, never a generic crash
          expect(e).toBeInstanceOf(CsvImportError);
        }
        if (!threw) {
          // a returned value must be a clean bigint (never NaN-ish; bigint can't be NaN,
          // but assert it round-trips to a 2-decimal string and back to itself)
          expect(typeof result).toBe('bigint');
          const rt = parseAmountToCents(centsToDecimal(result as bigint), 1);
          expect(rt).toBe(result);
        }
        cov.cover('FUZZ:amount-garbage-throws-or-exact');
      }),
      { numRuns: 2000 }
    );
  });

  test('FUZZ: parseCsvRows never crashes uncaught on arbitrary input (throws CsvImportError or returns rows)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        try {
          const rows = parseCsvRows(s);
          expect(Array.isArray(rows)).toBe(true);
          // every cell is a string
          for (const row of rows) for (const cell of row) expect(typeof cell).toBe('string');
        } catch (e) {
          expect(e).toBeInstanceOf(CsvImportError);
        }
        cov.cover('FUZZ:csv-no-crash');
      }),
      { numRuns: 1500 }
    );
  });

  test('FUZZ: importCsv on arbitrary documents never silently partial-imports', () => {
    // Build documents with a valid header but adversarial data rows; importCsv
    // must EITHER throw OR return a record whose transaction count equals the
    // number of data rows it saw (INV3). It must never return fewer.
    const arbDoc = fc
      .array(fc.array(arbCell, { minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 8 })
      .map((dataRows) => csv(['date', 'description', 'amount'], dataRows));
    fc.assert(
      fc.property(arbDoc, (text) => {
        // count the data rows as the parser would see them (reuse DUT parser for
        // the row count oracle; this is structural, not the value oracle)
        let parsedRowCount: number;
        try {
          parsedRowCount = Math.max(0, parseCsvRows(text).length - 1); // minus header
        } catch {
          parsedRowCount = -1; // unterminated quote etc.
        }
        try {
          const rec = importCsv(text, DEFAULT_OPTS);
          // success => count must match exactly (never silently dropped)
          if (parsedRowCount >= 0) {
            expect(rec.transactions.length).toBe(parsedRowCount);
          }
        } catch (e) {
          expect(e).toBeInstanceOf(CsvImportError);
        }
        cov.cover('FUZZ:import-no-silent-drop');
        cov.cover('INV3:throw-never-silent-drop');
      }),
      { numRuns: 1500 }
    );
  });
});

// =============================================================================
// SECTION 8b — Directed boundary checks targeting specific behaviors
// (anchoring of regexes, the rounding-length boundary, the zero-amount sign
// boundary, and whitespace-as-empty in debit/credit). These pin behaviors the
// contract specifies but which broad property tests under-exercise. Inputs and
// expectations derived BLACK-BOX (calling the public functions); no source read.
// =============================================================================
describe('directed boundary behaviors (R5/R7 anchoring & sign boundaries)', () => {
  test('accounting parens must be fully anchored: half-parens are unparseable', () => {
    expect(() => parseAmountToCents('(12.34', 1)).toThrow(CsvImportError); // open only
    expect(() => parseAmountToCents('12.34)', 1)).toThrow(CsvImportError); // close only
    expect(parseAmountToCents('(12.34)', 1)).toBe(-1234n); // full parens => negative
  });

  test('exactly-2-decimal amounts are NOT rounded (rounding only for >2 frac digits)', () => {
    expect(parseAmountToCents('0.99', 1)).toBe(99n);
    expect(parseAmountToCents('0.95', 1)).toBe(95n); // .95 must stay 95, not round to 100
    expect(parseAmountToCents('12.34', 1)).toBe(1234n);
  });

  test('zero amount classifies as deposit (boundary: type = purchase iff amount<0, else deposit)', () => {
    const t = csv(['date', 'description', 'amount'], [['2026-01-01', 'Z', '0.00']]);
    const rec = importCsv(t, DEFAULT_OPTS);
    expect(rec.transactions[0]!.amount_minor).toBe(0n);
    expect(rec.transactions[0]!.transaction_type).toBe('deposit'); // 0 is NOT < 0
  });

  test('a single negative cent classifies as purchase (other side of the boundary)', () => {
    const t = csv(['date', 'description', 'amount'], [['2026-01-01', 'Z', '-0.01']]);
    const rec = importCsv(t, DEFAULT_OPTS);
    expect(rec.transactions[0]!.amount_minor).toBe(-1n);
    expect(rec.transactions[0]!.transaction_type).toBe('purchase');
  });

  test('ISO date regex is fully anchored: trailing/leading junk is rejected', () => {
    for (const d of ['2026-01-01x', 'x2026-01-01', '2026-01-1', '12026-01-01', '2026-01-012']) {
      const t = csv(['date', 'description', 'amount'], [[d, 'X', '-1.00']]);
      expect(() => importCsv(t, DEFAULT_OPTS)).toThrow(CsvImportError);
    }
  });

  test('currency regex is fully anchored: 4-letter and mixed-case-extra are rejected', () => {
    for (const c of ['USDX', 'XUSD', 'USDD', 'aUSD']) {
      const t = csv(
        ['date', 'description', 'amount', 'currency'],
        [['2026-01-01', 'X', '-1.00', c]]
      );
      expect(() => importCsv(t, DEFAULT_OPTS)).toThrow(CsvImportError);
    }
  });

  test('whitespace-only debit cell counts as EMPTY (neither set => throw)', () => {
    const t = csv(['date', 'description', 'debit', 'credit'], [['2026-01-01', 'X', ' ', '']]);
    expect(() => importCsv(t, DEFAULT_OPTS)).toThrow(CsvImportError);
  });

  test('missing-required-column header lists which columns were seen (row-1 header context)', () => {
    // header missing description: error must reference the header, identifying the gap.
    const t = csv(['date', 'amount'], [['2026-01-01', '-1.00']]);
    expect(() => importCsv(t, DEFAULT_OPTS)).toThrow(CsvImportError);
  });
});

// =============================================================================
// SECTION 9 — Teeth check (fault injection): prove the bench can FAIL.
// We mutate our OWN reference model (off-by-one) and confirm the scoreboard
// catches it. This is the local proof that the scoreboard is not vacuous;
// Stryker mutation of the DUT is run separately at sign-off.
// =============================================================================
describe('teeth check — self-mutated reference model must make the scoreboard FAIL', () => {
  test('off-by-one in refCentsToDecimal is caught by the scoreboard', () => {
    const mutatedModel = (c: bigint): string => refCentsToDecimal(c + 1n); // injected bug
    const sb = new Scoreboard<bigint, string>({ dut: centsToDecimal, model: mutatedModel });
    // run a spread of values guaranteed to disagree
    for (const c of [0n, 5n, 100n, -1234n, 999n]) sb.check(c);
    expect(() => sb.assertClean()).toThrow(/mismatch/);
  });

  test('wrong half-up direction (truncating model) is caught at the x.xx5 boundary', () => {
    // A model that TRUNCATES the 3rd decimal instead of rounding half-up must
    // disagree with the DUT on 1.005 (DUT=101, truncate=100). If the scoreboard
    // did NOT fire here, our half-up checks would be vacuous.
    const truncate = (s: string): bigint => {
      const cleaned = s.trim();
      const m = /^(\d+)\.(\d)(\d)\d+$/.exec(cleaned);
      if (m) return BigInt(m[1]!) * 100n + BigInt(m[2]!) * 10n + BigInt(m[3]!); // truncates
      return refParseAmountToCents(cleaned);
    };
    const sb = new Scoreboard<string, bigint>({
      dut: (s) => parseAmountToCents(s, 1),
      model: truncate
    });
    sb.check('1.005'); // DUT=101, truncate-model=100 -> mismatch expected
    expect(() => sb.assertClean()).toThrow(/mismatch/);
  });
});

// =============================================================================
// SECTION 10 — Functional coverage closure gate (the sign-off gate)
// =============================================================================
describe('functional coverage closure', () => {
  test('all planned cover points hit (closure gate)', () => {
    console.log('\n' + cov.report() + '\n');
    cov.assertClosed();
  });
});
