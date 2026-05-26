import { describe, test, expect } from 'vitest';
import {
  exportBackup,
  importBackup,
  BackupError,
  BACKUP_VERSION
} from '../../../src/lib/app/backup';
import { STORE_VERSION, type PersistedState } from '../../../src/lib/db/store';
import type { CategorizationState } from '../../../src/lib/db/categorization-store';
import { makeManualImport } from '../../../src/lib/app/manual-entry';

const state: PersistedState = {
  version: STORE_VERSION,
  imports: [
    makeManualImport(
      { posted_date: '2026-05-20', description: 'Coffee', amount_minor: -450n },
      'm1',
      '2026-05-26T00:00:00Z'
    )
  ],
  reconciliation_links: []
};

const cat: CategorizationState = {
  categories: [{ id: 'food', name: 'Food' }],
  rules: [{ id: 'r1', contains: 'COFFEE', category_id: 'food' }],
  annotations: { 'manual-m1#0': { category_id: 'food', source: 'manual', note: 'morning' } }
};

describe('backup round-trip', () => {
  test('export then import reproduces the data, bigints intact', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z');
    const restored = importBackup(text);
    expect(restored.backup_version).toBe(BACKUP_VERSION);
    expect(restored.state.imports[0]!.transactions[0]!.amount_minor).toBe(-450n);
    expect(typeof restored.state.imports[0]!.transactions[0]!.amount_minor).toBe('bigint');
    expect(restored.categorization.annotations['manual-m1#0']!.note).toBe('morning');
  });

  test('budgets + goals round-trip with bigints intact (US-P4-A/B)', () => {
    const budgets = { food: 50000n, gas: 20000n };
    const goals = [
      { id: 'g1', name: 'Emergency fund', target_minor: 1000000n, saved_minor: 250000n },
      { id: 'g2', name: 'Trip', target_minor: 300000n, saved_minor: 0n, deadline: '2026-12-31' }
    ];
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z', { budgets, goals });
    const restored = importBackup(text);
    expect(restored.budgets.food).toBe(50000n);
    expect(typeof restored.budgets.gas).toBe('bigint');
    expect(restored.goals).toHaveLength(2);
    expect(restored.goals[0]!.target_minor).toBe(1000000n);
    expect(restored.goals[1]!.deadline).toBe('2026-12-31');
  });

  test('an old backup without budgets/goals imports with empty defaults', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z'); // no extras
    // simulate a pre-P4 file by stripping the sections
    const stripped = text.replace(/,\s*"budgets":\s*\{\}/, '').replace(/,\s*"goals":\s*\[\]/, '');
    const restored = importBackup(stripped);
    expect(restored.budgets).toEqual({});
    expect(restored.goals).toEqual([]);
  });

  test('rejects a malformed budgets section', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      '"budgets": {}',
      '"budgets": [1,2,3]'
    );
    expect(() => importBackup(text)).toThrow(/budgets section is malformed/);
  });

  test('rejects a malformed goal', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z', {
      goals: [{ id: 'g1', name: 'X', target_minor: 1n, saved_minor: 0n }]
    }).replace('"name": "X"', '"name": 123');
    expect(() => importBackup(text)).toThrow(/savings goal is malformed/);
  });

  // ── Targeted rejection tests for each shape clause (kill the validation mutants;
  // no-silent-failures: every malformed sub-shape must be REFUSED, not slipped through) ──
  test('rejects budgets that is a non-object (e.g. a number)', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      '"budgets": {}',
      '"budgets": 42'
    );
    expect(() => importBackup(text)).toThrow(/budgets section is malformed/);
  });

  test('rejects budgets that is null', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      '"budgets": {}',
      '"budgets": null'
    );
    expect(() => importBackup(text)).toThrow(/budgets section is malformed/);
  });

  test('rejects a budget limit that is not an integer amount (string, not bigint)', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      '"budgets": {}',
      '"budgets": { "food": "50000" }'
    );
    expect(() => importBackup(text)).toThrow(/not an integer amount/);
  });

  const oneGoal = () =>
    exportBackup(state, cat, '2026-05-26T01:00:00Z', {
      goals: [{ id: 'g1', name: 'Trip', target_minor: 300000n, saved_minor: 0n }]
    });

  test('rejects a goal whose id is not a string', () => {
    expect(() => importBackup(oneGoal().replace('"id": "g1"', '"id": 7'))).toThrow(
      /savings goal is malformed/
    );
  });

  test('rejects a goal whose target_minor is not a bigint (plain number)', () => {
    // strip the bigint sentinel so it revives as a plain number, not a bigint
    expect(() => importBackup(oneGoal().replace('"__bigint__:300000"', '300000'))).toThrow(
      /savings goal is malformed/
    );
  });

  test('rejects a goal array element that is not an object', () => {
    expect(() =>
      importBackup(oneGoal().replace(/"goals": \[\s*\{[\s\S]*?\}\s*\]/, '"goals": ["nope"]'))
    ).toThrow(/savings goal is malformed/);
  });

  test('exported_at defaults to empty string when absent/non-string', () => {
    // remove the exported_at field entirely → the ternary must fall back to ''
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      /"exported_at": "[^"]*",\n/,
      ''
    );
    expect(importBackup(text).exported_at).toBe('');
  });
});

describe('importBackup validation (no silent restore of bad data)', () => {
  test('throws on invalid JSON', () => {
    expect(() => importBackup('{not json')).toThrow(BackupError);
  });
  test('throws when the app marker is missing', () => {
    // derive from a real (bigint-safe) export, then break the app marker
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      '"app": "money-management-tool"',
      '"app": "something-else"'
    );
    expect(() => importBackup(text)).toThrow(/not a Money Management Tool backup/);
  });
  test('throws on a newer backup_version', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      `"backup_version": ${BACKUP_VERSION}`,
      `"backup_version": ${BACKUP_VERSION + 1}`
    );
    expect(() => importBackup(text)).toThrow(/newer version/);
  });
  test('throws when the state fails the money schema', () => {
    const bad = {
      app: 'money-management-tool',
      backup_version: 1,
      exported_at: '',
      state: { version: 1, imports: [{ bank_name: '' }], reconciliation_links: [] },
      categorization: cat
    };
    expect(() => importBackup(JSON.stringify(bad))).toThrow(/schema check/);
  });
  test('throws when categorization is malformed', () => {
    const text = exportBackup(state, cat, '2026-05-26T01:00:00Z').replace(
      '"categorization": {',
      '"categorization_x": {'
    );
    expect(() => importBackup(text)).toThrow(/categorization section/);
  });
});
