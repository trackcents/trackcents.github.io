/**
 * Persistence for the user-owned Recurring (bills + subscriptions) list
 * (spec 002-income-pockets §7.5–§7.10). Local-only, encrypted at rest with the
 * same session key as the other stores (reuses store-crypto), kept separate from
 * the synced vault — same pattern + caveats as categorization-store.
 *
 * `RecurringItem.amount_minor` / `paid_minor` are bigint cents, so we round-trip
 * bigints through the same `{ "$bigint": "<decimal>" }` sentinel as the
 * categorization blob (a plain JSON.stringify throws on bigint).
 */
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';
import type { RecurringItem } from '../app/recurring-items';

const LS_KEY = 'mtrb.recurring';

export interface RecurringState {
  items: RecurringItem[];
}

function empty(): RecurringState {
  return { items: [] };
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { $bigint: value.toString() } : value;
}
function bigintReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    '$bigint' in value &&
    typeof (value as { $bigint: unknown }).$bigint === 'string'
  ) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

/** Load the recurring list; returns empty if absent, unparseable, or locked. */
export async function loadRecurring(): Promise<RecurringState> {
  if (typeof localStorage === 'undefined') return empty();
  const stored = localStorage.getItem(LS_KEY);
  if (stored === null) return empty();
  const decoded = await decodeStateFromStorage(stored);
  if (decoded.kind === 'locked') return empty();
  try {
    const parsed = JSON.parse(decoded.json, bigintReviver) as Partial<RecurringState>;
    return { items: parsed.items ?? [] };
  } catch {
    return empty();
  }
}

/** Persist the recurring list, encrypted at rest when a session key is loaded. */
export async function saveRecurring(state: RecurringState): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(state, bigintReplacer)));
}
