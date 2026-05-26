/**
 * Full JSON backup export / import (US-PW-C) — pure logic.
 *
 * Inspired by the user's cousin's pricewatch app (Settings → export/import JSON).
 * Decision D7 (DECISIONS.md): this is a MANUAL, OFFLINE escape hatch — the user
 * exports their own already-local, already-decrypted data to a file they save
 * themselves, and can re-import it to restore or move devices with no server
 * involved. It is separate from sync: the synced Drive blob stays encrypted; the
 * backup file is plaintext-on-the-user's-own-disk by nature, and the UI warns to
 * store it safely.
 *
 * Money is bigint cents (constitution II); we use the same sentinel-string scheme
 * as the store so every bigint round-trips. The export→import round-trip is an
 * identity on valid data (verified by IV&V).
 */
import type { PersistedState } from '../db/store';
import type { CategorizationState } from '../db/categorization-store';
import type { CategoryLimits } from '../db/budget-store';
import type { SavingsGoal } from './savings-goal';
import { diagnosePersistedState } from '../db/schema';

export const BACKUP_VERSION = 1;

export interface BackupBundle {
  backup_version: number;
  exported_at: string; // ISO timestamp
  app: 'money-management-tool';
  state: PersistedState; // imports + reconciliation_links
  categorization: CategorizationState; // categories + rules + annotations
  budgets: CategoryLimits; // per-category monthly limits (US-P4-A); {} if none
  goals: SavingsGoal[]; // savings goals (US-P4-B); [] if none
}

/** Optional extra sections to include in a backup (budgets + goals). */
export interface BackupExtras {
  budgets?: CategoryLimits;
  goals?: SavingsGoal[];
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

// Same bigint sentinel as src/lib/db/store.ts so backups and the live store agree.
const BIGINT_PREFIX = '__bigint__:';

function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? `${BIGINT_PREFIX}${value.toString()}` : value;
}
function reviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_PREFIX)) {
    return BigInt(value.slice(BIGINT_PREFIX.length));
  }
  return value;
}

/**
 * Serialize the full app data to a pretty-printed, bigint-safe JSON backup string.
 * `exportedAtIso` is stamped into the bundle so the user can tell backups apart.
 */
export function exportBackup(
  state: PersistedState,
  categorization: CategorizationState,
  exportedAtIso: string,
  extras: BackupExtras = {}
): string {
  const bundle: BackupBundle = {
    backup_version: BACKUP_VERSION,
    exported_at: exportedAtIso,
    app: 'money-management-tool',
    state,
    categorization,
    budgets: extras.budgets ?? {},
    goals: extras.goals ?? []
  };
  return JSON.stringify(bundle, replacer, 2);
}

/**
 * Parse + validate a backup file. Throws `BackupError` with a clear message on a
 * wrong/garbled/newer file — never restores a partially-understood bundle.
 * Returns the validated bundle (bigints revived) on success.
 */
export function importBackup(text: string): BackupBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, reviver);
  } catch (err) {
    throw new BackupError(
      `backup import: not valid JSON (${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupError('backup import: file is not a backup object');
  }
  const b = parsed as Partial<BackupBundle>;
  if (b.app !== 'money-management-tool') {
    throw new BackupError(
      'backup import: this file is not a Money Management Tool backup (missing app marker)'
    );
  }
  if (typeof b.backup_version !== 'number') {
    throw new BackupError('backup import: missing backup_version');
  }
  if (b.backup_version > BACKUP_VERSION) {
    throw new BackupError(
      `backup import: file was written by a newer version (backup_version ${b.backup_version} > ${BACKUP_VERSION}); upgrade the app to restore it`
    );
  }
  // Validate the money-bearing state against the same Zod schema the store uses.
  const issues = diagnosePersistedState(b.state);
  if (issues !== null) {
    throw new BackupError(
      `backup import: the data failed the schema check (${issues.length} issue${
        issues.length === 1 ? '' : 's'
      }): ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '; …' : ''}`
    );
  }
  const cat = b.categorization;
  if (
    typeof cat !== 'object' ||
    cat === null ||
    !Array.isArray(cat.categories) ||
    !Array.isArray(cat.rules) ||
    typeof cat.annotations !== 'object' ||
    cat.annotations === null
  ) {
    throw new BackupError('backup import: categorization section is malformed');
  }

  // budgets + goals are OPTIONAL (older backups predate them → default empty).
  // Validate shape so a malformed section is refused rather than silently dropped.
  const budgets: CategoryLimits = {};
  if (b.budgets !== undefined) {
    if (typeof b.budgets !== 'object' || b.budgets === null || Array.isArray(b.budgets)) {
      throw new BackupError('backup import: budgets section is malformed');
    }
    for (const [k, v] of Object.entries(b.budgets)) {
      if (typeof v !== 'bigint') {
        throw new BackupError(`backup import: budget limit for "${k}" is not an integer amount`);
      }
      budgets[k] = v;
    }
  }

  let goals: SavingsGoal[] = [];
  if (b.goals !== undefined) {
    if (!Array.isArray(b.goals)) {
      throw new BackupError('backup import: goals section is malformed');
    }
    for (const g of b.goals as unknown[]) {
      if (
        typeof g !== 'object' ||
        g === null ||
        typeof (g as SavingsGoal).id !== 'string' ||
        typeof (g as SavingsGoal).name !== 'string' ||
        typeof (g as SavingsGoal).target_minor !== 'bigint' ||
        typeof (g as SavingsGoal).saved_minor !== 'bigint'
      ) {
        throw new BackupError('backup import: a savings goal is malformed');
      }
    }
    goals = b.goals as SavingsGoal[];
  }

  return {
    backup_version: b.backup_version,
    exported_at: typeof b.exported_at === 'string' ? b.exported_at : '',
    app: 'money-management-tool',
    state: b.state as PersistedState,
    categorization: cat as CategorizationState,
    budgets,
    goals
  };
}
