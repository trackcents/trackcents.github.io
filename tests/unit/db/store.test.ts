// Persistence store tests — jsdom uses localStorage backend (no OPFS in tests).
//
// Covers: round-trip with bigint-safe serialization, idempotency on same hash,
// removal, clear-all, version forward-compat refusal, and reconciliation-link
// orphan cleanup when a statement is removed.

import { beforeEach, describe, expect, test } from 'vitest';
import {
  addImport,
  clearState,
  deserializeState,
  loadState,
  removeImport,
  saveState,
  serializeState,
  setReconciliationLinks,
  STORE_VERSION,
  type ImportRecord,
  type PersistedState
} from '../../../src/lib/db/store';
import type { ParsedStatement, ParsedTransaction } from '../../../src/lib/adapters/types';
import type { ReconciliationLink } from '../../../src/lib/app/reconciliation';

beforeEach(async () => {
  await clearState();
});

function mkStatement(): ParsedStatement {
  return {
    account_type: 'credit_card',
    account_last_4: '1797',
    period_start: '2026-02-14',
    period_end: '2026-03-13',
    currency: 'USD',
    opening_balance_minor: null,
    closing_balance_minor: null,
    total_debits_minor: 50000n,
    total_credits_minor: 200000n,
    statement_balance_minor: 150000n,
    previous_balance_minor: 300000n,
    printed_transaction_count: 2,
    summary_lines: [
      { label: 'Previous Balance', amount_minor: 300000n },
      { label: 'New Balance', amount_minor: 150000n }
    ],
    payment_due_date: '2026-04-10',
    statement_date: '2026-03-13',
    minimum_payment_due_minor: 2500n,
    parser_provides: ['B', 'C', 'D']
  };
}

function mkTransaction(amount: bigint, desc = 'Test'): ParsedTransaction {
  return {
    posted_date: '2026-03-01',
    description: desc,
    raw_text: desc,
    amount_minor: amount,
    currency: 'USD',
    transaction_type: amount < 0n ? 'purchase' : 'payment_to_card'
  };
}

function mkRecord(hash = 'hash-1'): ImportRecord {
  return {
    bank_name: 'Chase',
    adapter_name: 'layout-chase-credit-card',
    adapter_version: '0.2.0',
    pdf_source_hash: hash,
    imported_at: '2026-05-23T12:00:00Z',
    statement: mkStatement(),
    transactions: [mkTransaction(-25000n, 'Coffee'), mkTransaction(200000n, 'Payment Thank You')],
    checksum_strategy_used: 'B+C+D'
  };
}

describe('serializeState / deserializeState — bigint safety', () => {
  test('round-trips bigint amount_minor exactly', () => {
    const state: PersistedState = {
      version: STORE_VERSION,
      imports: [mkRecord('h1')],
      reconciliation_links: []
    };
    const text = serializeState(state);
    const round = deserializeState(text);
    expect(round.imports[0]!.transactions[0]!.amount_minor).toBe(-25000n);
    expect(round.imports[0]!.transactions[1]!.amount_minor).toBe(200000n);
    expect(round.imports[0]!.statement.previous_balance_minor).toBe(300000n);
    expect(typeof round.imports[0]!.transactions[0]!.amount_minor).toBe('bigint');
  });

  test('handles million-dollar amounts (no precision loss)', () => {
    const state: PersistedState = {
      version: STORE_VERSION,
      imports: [
        {
          ...mkRecord('h-million'),
          transactions: [mkTransaction(123456789n, 'Big purchase')]
        }
      ],
      reconciliation_links: []
    };
    const round = deserializeState(serializeState(state));
    expect(round.imports[0]!.transactions[0]!.amount_minor).toBe(123456789n);
  });

  test('refuses to load state with a forward version', () => {
    const forward = JSON.stringify({
      version: STORE_VERSION + 99,
      imports: [],
      reconciliation_links: []
    });
    expect(() => deserializeState(forward)).toThrow(/version/);
  });

  test('null bigint fields survive round-trip as null', () => {
    const state: PersistedState = {
      version: STORE_VERSION,
      imports: [
        {
          ...mkRecord('h-null'),
          statement: { ...mkStatement(), opening_balance_minor: null, closing_balance_minor: null }
        }
      ],
      reconciliation_links: []
    };
    const round = deserializeState(serializeState(state));
    expect(round.imports[0]!.statement.opening_balance_minor).toBeNull();
    expect(round.imports[0]!.statement.closing_balance_minor).toBeNull();
  });
});

describe('loadState / saveState', () => {
  test('returns empty state when nothing persisted', async () => {
    const state = await loadState();
    expect(state.imports).toEqual([]);
    expect(state.reconciliation_links).toEqual([]);
  });

  test('saves and loads round-trip', async () => {
    await saveState({
      version: STORE_VERSION,
      imports: [mkRecord('h1'), mkRecord('h2')],
      reconciliation_links: []
    });
    const loaded = await loadState();
    expect(loaded.imports).toHaveLength(2);
    expect(loaded.imports[0]!.pdf_source_hash).toBe('h1');
    expect(loaded.imports[1]!.pdf_source_hash).toBe('h2');
  });

  test('clearState wipes persisted data', async () => {
    await saveState({
      version: STORE_VERSION,
      imports: [mkRecord('h1')],
      reconciliation_links: []
    });
    await clearState();
    const loaded = await loadState();
    expect(loaded.imports).toEqual([]);
  });
});

describe('addImport — idempotency', () => {
  test('adds a new record', async () => {
    const state = await addImport(mkRecord('h-new'));
    expect(state.imports).toHaveLength(1);
    expect(state.imports[0]!.pdf_source_hash).toBe('h-new');
  });

  test('replaces existing record with same hash (no duplicate)', async () => {
    await addImport(mkRecord('h-same'));
    const updated: ImportRecord = {
      ...mkRecord('h-same'),
      transactions: [mkTransaction(-99999n, 'Updated')]
    };
    const state = await addImport(updated);
    expect(state.imports).toHaveLength(1);
    expect(state.imports[0]!.transactions[0]!.amount_minor).toBe(-99999n);
  });

  test('appends multiple distinct hashes in order', async () => {
    await addImport(mkRecord('h-a'));
    await addImport(mkRecord('h-b'));
    const state = await addImport(mkRecord('h-c'));
    expect(state.imports.map((i) => i.pdf_source_hash)).toEqual(['h-a', 'h-b', 'h-c']);
  });
});

describe('removeImport', () => {
  test('removes the matching import and leaves others', async () => {
    await addImport(mkRecord('h-a'));
    await addImport(mkRecord('h-b'));
    const state = await removeImport('h-a');
    expect(state.imports.map((i) => i.pdf_source_hash)).toEqual(['h-b']);
  });

  test('is a no-op if the hash is not present', async () => {
    await addImport(mkRecord('h-a'));
    const state = await removeImport('h-nonexistent');
    expect(state.imports).toHaveLength(1);
  });

  test('cleans up reconciliation links that reference the removed import', async () => {
    // Pretend we have two imports (indices 0 and 1) and a link 0 → 1.
    await addImport(mkRecord('h-bank'));
    await addImport(mkRecord('h-cc'));
    const link: ReconciliationLink = {
      bank_import_index: 0,
      bank_transaction_index: 0,
      cc_import_index: 1,
      cc_transaction_index: 0,
      link_type: 'auto',
      confidence_score: 1.0,
      matched_amount_minor: 50000n,
      matched_date: '2026-03-01'
    };
    await setReconciliationLinks([link]);

    const state = await removeImport('h-cc');
    // The link pointing at the now-gone CC import must be cleaned up so the
    // UI doesn't render a dangling "→ See what this paid for" badge.
    expect(state.reconciliation_links).toEqual([]);
  });
});

describe('setReconciliationLinks', () => {
  test('overwrites the link set wholesale', async () => {
    await addImport(mkRecord('h-1'));
    const link: ReconciliationLink = {
      bank_import_index: 0,
      bank_transaction_index: 0,
      cc_import_index: 0,
      cc_transaction_index: null,
      link_type: 'auto',
      confidence_score: 0.85,
      matched_amount_minor: 1000n,
      matched_date: '2026-03-01'
    };
    let state = await setReconciliationLinks([link]);
    expect(state.reconciliation_links).toHaveLength(1);
    state = await setReconciliationLinks([]);
    expect(state.reconciliation_links).toEqual([]);
  });
});

// ── Concurrent-write race regression ────────────────────────────────────────
// On 2026-05-23 a real bug caused dropped statements to disappear after
// page reload: addImport and the link-autosave $effect both ran
// load-modify-save concurrently.  Both read the empty state; the second
// writer overwrote the first writer's import with `imports=[]`.
//
// We fixed it by removing the autosave (links are recomputed on load).
// These tests guard the underlying invariant: when multiple writes race,
// no write silently destroys another's data.
describe('concurrent-write race regression', () => {
  test('parallel addImport calls all survive (no lost updates)', async () => {
    // Fire many addImport calls concurrently.  At minimum, the union of
    // results across all calls must include every hash we tried to write.
    // (Last-writer-wins is acceptable per-FIELD; what's NOT acceptable is
    // entire records vanishing.)
    const records = Array.from({ length: 5 }, (_, i) => mkRecord(`race-${i}`));
    const results = await Promise.all(records.map((r) => addImport(r)));

    // Every individual call must have returned a state including its own record.
    for (let i = 0; i < records.length; i++) {
      expect(results[i]!.imports.some((r) => r.pdf_source_hash === `race-${i}`)).toBe(true);
    }
    // After all settle, loadState must return every record (eventually consistent).
    // NB: with load-modify-save semantics this CAN lose records on a real OPFS,
    // but the test still asserts the contract.  If this ever flakes in CI, the
    // fix is a serializing mutex inside store.ts, not relaxing the assertion.
    const final = await loadState();
    const finalHashes = new Set(final.imports.map((r) => r.pdf_source_hash));
    for (let i = 0; i < records.length; i++) {
      expect(finalHashes.has(`race-${i}`), `race-${i} should be persisted`).toBe(true);
    }
  });

  test('addImport followed by setReconciliationLinks preserves the imported record', async () => {
    // Sequential — the exact pattern that handleFile + the old autosave
    // followed before we removed the autosave.  Should always preserve the
    // import.  (The old bug made it CONCURRENT not sequential; this is the
    // contract for the sequential variant.)
    await addImport(mkRecord('seq-1'));
    await setReconciliationLinks([]);
    const final = await loadState();
    expect(final.imports.some((r) => r.pdf_source_hash === 'seq-1')).toBe(true);
  });

  test('addImport, then concurrent addImport + setReconciliationLinks — import survives', async () => {
    // The actual race pattern that bit us.
    await addImport(mkRecord('initial'));
    await Promise.all([addImport(mkRecord('new-import')), setReconciliationLinks([])]);
    const final = await loadState();
    expect(final.imports.some((r) => r.pdf_source_hash === 'initial')).toBe(true);
    expect(final.imports.some((r) => r.pdf_source_hash === 'new-import')).toBe(true);
  });
});

describe('Persistence robustness', () => {
  test('corrupt JSON in storage degrades to empty state (no crash)', async () => {
    // Simulate file corruption by writing garbage directly.
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('money-tracker:state', '{this is not valid json');
    }
    // loadState must not throw.
    const state = await loadState();
    expect(state.imports).toEqual([]);
  });

  test('orphan reconciliation links survive a round-trip even if their imports were deleted', async () => {
    // Edge case: links reference indices into imports[].  If a record was
    // removed but links weren't cleaned (race or pre-fix data), loading
    // shouldn't crash — the UI uses link.cc_import_index lookups that
    // gracefully return undefined.
    await saveState({
      version: 1,
      imports: [],
      reconciliation_links: [
        {
          bank_import_index: 0,
          bank_transaction_index: 0,
          cc_import_index: 1,
          cc_transaction_index: 0,
          link_type: 'auto',
          confidence_score: 1.0,
          matched_amount_minor: 1000n,
          matched_date: '2026-03-01'
        }
      ]
    });
    const state = await loadState();
    expect(state.imports).toEqual([]);
    // Orphan links are kept on disk; the UI filters them out at render time.
    expect(state.reconciliation_links).toHaveLength(1);
  });

  test('state with very large amounts (multi-million dollar) round-trips exactly', async () => {
    // BigInt is the contract — but the serializer / deserializer have been
    // wrong before.  Pin the exact value.
    const big = 999_999_999_99n; // $999,999,999.99
    await addImport({ ...mkRecord('huge'), transactions: [mkTransaction(-big, 'House')] });
    const state = await loadState();
    expect(state.imports[0]!.transactions[0]!.amount_minor).toBe(-big);
  });
});
