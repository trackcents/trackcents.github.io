import { describe, test, expect } from 'vitest';
import { mergeState } from '../../../src/lib/sync/merge';
import type { PersistedState, ImportRecord } from '../../../src/lib/db/store';
import type { ReconciliationLink } from '../../../src/lib/app/reconciliation';

// Minimal stand-ins — mergeState only reads `pdf_source_hash` on imports and the
// index fields on links. The independent IV&V suite builds full generators.
const imp = (hash: string): ImportRecord => ({ pdf_source_hash: hash }) as unknown as ImportRecord;
const state = (imports: ImportRecord[], links: ReconciliationLink[] = []): PersistedState => ({
  version: 1,
  imports,
  reconciliation_links: links
});

describe('mergeState (sync union)', () => {
  test('keeps imports from both sides, deduped by pdf_source_hash, a-first', () => {
    const merged = mergeState(state([imp('A')]), state([imp('B'), imp('A')]));
    expect(merged.imports.map((i) => i.pdf_source_hash)).toEqual(['A', 'B']);
  });

  test('on a hash collision the NEWER imported_at wins (an edited manual entry propagates, not reverts)', () => {
    const stale = {
      pdf_source_hash: 'manual-1',
      imported_at: '2026-06-01T10:00:00.000Z',
      bank_name: 'old'
    } as unknown as ImportRecord;
    const edited = {
      pdf_source_hash: 'manual-1',
      imported_at: '2026-06-05T09:00:00.000Z',
      bank_name: 'edited'
    } as unknown as ImportRecord;
    // Newer wins regardless of which side it's on, and the entry isn't duplicated.
    const m1 = mergeState(state([stale]), state([edited]));
    const m2 = mergeState(state([edited]), state([stale]));
    expect(m1.imports.length).toBe(1);
    expect(m2.imports.length).toBe(1);
    expect((m1.imports[0] as unknown as { bank_name: string }).bank_name).toBe('edited');
    expect((m2.imports[0] as unknown as { bank_name: string }).bank_name).toBe('edited');
  });

  test('is idempotent: merge(s, s) keeps each import once', () => {
    const s = state([imp('A'), imp('B')]);
    expect(mergeState(s, s).imports.map((i) => i.pdf_source_hash)).toEqual(['A', 'B']);
  });

  test('merging with empty is identity', () => {
    const s = state([imp('A'), imp('B')]);
    expect(mergeState(s, state([])).imports.map((i) => i.pdf_source_hash)).toEqual(['A', 'B']);
    expect(mergeState(state([]), s).imports.map((i) => i.pdf_source_hash)).toEqual(['A', 'B']);
  });

  test('re-indexes a link to the merged imports array (not the source positions)', () => {
    // remote link points bank→index0 (Y), cc→index1 (X) in the REMOTE array.
    const link = {
      bank_import_index: 0,
      bank_transaction_index: 0,
      cc_import_index: 1,
      cc_transaction_index: 0,
      link_type: 'auto',
      confidence_score: 1
    } as ReconciliationLink;
    const local = state([imp('X')]);
    const remote = state([imp('Y'), imp('X')], [link]);
    const merged = mergeState(local, remote);
    // merged imports are local-first: X(0), Y(1). The link must now read bank=Y→1, cc=X→0.
    expect(merged.imports.map((i) => i.pdf_source_hash)).toEqual(['X', 'Y']);
    expect(merged.reconciliation_links[0]).toMatchObject({
      bank_import_index: 1,
      cc_import_index: 0
    });
  });

  test('drops a link whose endpoints do not resolve (dangling)', () => {
    const danglingLink = {
      bank_import_index: 5, // out of range
      bank_transaction_index: 0,
      cc_import_index: 0,
      cc_transaction_index: 0,
      link_type: 'auto',
      confidence_score: 1
    } as ReconciliationLink;
    const merged = mergeState(state([imp('A')], [danglingLink]), state([]));
    expect(merged.reconciliation_links).toEqual([]);
  });
});
