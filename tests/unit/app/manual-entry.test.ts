import { describe, test, expect } from 'vitest';
import {
  makeManualImport,
  manualSourceHash,
  isManualImport,
  partitionManual,
  ManualEntryError,
  MANUAL_ADAPTER_NAME,
  type ManualTxnInput
} from '../../../src/lib/app/manual-entry';
import { diagnosePersistedState } from '../../../src/lib/db/schema';
import { STORE_VERSION, type ImportRecord } from '../../../src/lib/db/store';

const base: ManualTxnInput = {
  posted_date: '2026-05-20',
  description: 'Coffee with a friend',
  amount_minor: -450n
};

const make = (over: Partial<ManualTxnInput> = {}, id = 'abc') =>
  makeManualImport({ ...base, ...over }, id, '2026-05-26T00:00:00Z');

describe('makeManualImport', () => {
  test('builds a single-transaction Cash import with a stable hash', () => {
    const rec = make();
    expect(rec.pdf_source_hash).toBe(manualSourceHash('abc'));
    expect(rec.adapter_name).toBe(MANUAL_ADAPTER_NAME);
    expect(rec.bank_name).toBe('Cash');
    expect(rec.statement.account_type).toBe('cash');
    expect(rec.transactions).toHaveLength(1);
    expect(rec.transactions[0]!.amount_minor).toBe(-450n);
    expect(rec.transactions[0]!.description).toBe('Coffee with a friend');
  });

  test('derives transaction_type from sign (expense vs income)', () => {
    expect(make({ amount_minor: -1n }).transactions[0]!.transaction_type).toBe('purchase');
    expect(make({ amount_minor: 1n }).transactions[0]!.transaction_type).toBe('deposit');
  });

  test('output passes the persisted-state Zod schema (integration guard)', () => {
    const state = {
      version: STORE_VERSION,
      imports: [make()],
      reconciliation_links: []
    };
    expect(diagnosePersistedState(state)).toBeNull();
  });

  test('a custom account nickname is preserved', () => {
    expect(make({ account_nickname: 'Wallet' }).bank_name).toBe('Wallet');
  });

  test('trims description and defaults currency to USD', () => {
    const rec = make({ description: '  Lunch  ' });
    expect(rec.transactions[0]!.description).toBe('Lunch');
    expect(rec.transactions[0]!.currency).toBe('USD');
  });

  // ── No silent failures: bad input throws with context ──
  test('rejects an empty description', () => {
    expect(() => make({ description: '   ' })).toThrow(ManualEntryError);
  });
  test('rejects a zero amount', () => {
    expect(() => make({ amount_minor: 0n })).toThrow(/non-zero/);
  });
  test('rejects a non-real date', () => {
    expect(() => make({ posted_date: '2026-13-45' })).toThrow(/real ISO/);
  });
  test('rejects a malformed date format', () => {
    expect(() => make({ posted_date: '05/20/2026' })).toThrow(ManualEntryError);
  });
  test('rejects an empty id', () => {
    expect(() => makeManualImport(base, '', '2026-05-26T00:00:00Z')).toThrow(/id must be/);
  });
  test('rejects a bad currency', () => {
    expect(() => make({ currency: 'US' })).toThrow(/ISO 4217/);
  });
});

describe('isManualImport / partitionManual', () => {
  const pdfRec = { adapter_name: 'layout-chase' } as ImportRecord;
  test('isManualImport distinguishes manual from parsed', () => {
    expect(isManualImport(make())).toBe(true);
    expect(isManualImport(pdfRec)).toBe(false);
  });
  test('partitionManual splits a mixed list', () => {
    const { pdf, manual } = partitionManual([make({}, 'a'), pdfRec, make({}, 'b')]);
    expect(manual).toHaveLength(2);
    expect(pdf).toHaveLength(1);
  });
});
