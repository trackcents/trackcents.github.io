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
import type { PaymentRecord, RecurringItem } from '../app/recurring-items';

const LS_KEY = 'mtrb.recurring';

export interface RecurringState {
  items: RecurringItem[];
}

function empty(): RecurringState {
  return { items: [] };
}

/**
 * Migrate a stored item to the current shape. Older builds tracked a single
 * inline cycle (`paid_minor` / `paid_date`); the current model keeps a
 * `payments[]` history tagged by budget month. We fold any old non-zero
 * paid_minor into one payment record (attributed to the month it was paid, or
 * the due month as a fallback) so no past payment is lost on upgrade.
 */
function normalizeItem(raw: Record<string, unknown>): RecurringItem {
  const { paid_minor, paid_date, payments, ...rest } = raw as {
    paid_minor?: bigint;
    paid_date?: string | null;
    payments?: PaymentRecord[];
  } & Record<string, unknown>;

  let history: PaymentRecord[] = Array.isArray(payments) ? payments : [];
  if (history.length === 0 && typeof paid_minor === 'bigint' && paid_minor > 0n) {
    const dueDate = typeof rest.due_date === 'string' ? rest.due_date : '';
    const when = typeof paid_date === 'string' && paid_date !== '' ? paid_date : dueDate;
    history = [
      {
        month: when.slice(0, 7),
        amount_minor: paid_minor,
        paid_date: when,
        paid_from: typeof rest.paid_from === 'string' ? rest.paid_from : 'paychecks'
      }
    ];
  }
  return { ...(rest as unknown as RecurringItem), payments: history };
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
    const items = Array.isArray(parsed.items)
      ? (parsed.items as unknown as Record<string, unknown>[]).map(normalizeItem)
      : [];
    return { items };
  } catch {
    return empty();
  }
}

/** Persist the recurring list, encrypted at rest when a session key is loaded. */
export async function saveRecurring(state: RecurringState): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(state, bigintReplacer)));
}
