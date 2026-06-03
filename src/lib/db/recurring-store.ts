/**
 * Persistence for the user-owned Recurring (bills + subscriptions) list
 * (spec 002-income-pockets §7.5–§7.10). Stored as plaintext JSON (reuses
 * store-crypto, like the other stores) in its own localStorage key; it now
 * SYNCS across devices via the bundle in sync/app-bundle.ts (task #79) — items
 * and sections union-merge by id — same pattern as categorization-store.
 *
 * `RecurringItem.amount_minor` / `paid_minor` are bigint cents, so we round-trip
 * bigints through the same `{ "$bigint": "<decimal>" }` sentinel as the
 * categorization blob (a plain JSON.stringify throws on bigint).
 */
import { encodeStateForStorage, decodeStateFromStorage } from './store-crypto';
import {
  DEFAULT_SECTIONS,
  SECTION_BILLS,
  SECTION_SUBSCRIPTIONS,
  type PaymentRecord,
  type RecurringItem,
  type RecurringSection
} from '../app/recurring-items';

const LS_KEY = 'mtrb.recurring';

export interface RecurringState {
  items: RecurringItem[];
  /** User-owned section list (Bills/Subscriptions + any custom). */
  sections: RecurringSection[];
}

function empty(): RecurringState {
  return { items: [], sections: [...DEFAULT_SECTIONS] };
}

/**
 * Migrate a stored item to the current shape. Two upgrades are handled:
 *   1) the single inline cycle (`paid_minor`/`paid_date`) → a `payments[]`
 *      history tagged by budget month (no past payment lost);
 *   2) the fixed `kind: 'bill'|'subscription'` → a user-owned `section_id`
 *      (bill→Bills, subscription→Subscriptions).
 */
function normalizeItem(raw: Record<string, unknown>): RecurringItem {
  const { paid_minor, paid_date, payments, kind, section_id, ...rest } = raw as {
    paid_minor?: bigint;
    paid_date?: string | null;
    payments?: PaymentRecord[];
    kind?: string;
    section_id?: string;
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
  const sectionId =
    typeof section_id === 'string' && section_id !== ''
      ? section_id
      : kind === 'subscription'
        ? SECTION_SUBSCRIPTIONS
        : SECTION_BILLS;
  return { ...(rest as unknown as RecurringItem), section_id: sectionId, payments: history };
}

/** Ensure the two built-in sections always exist (so items never orphan), and
 *  fall back to the defaults when none were stored. */
function normalizeSections(raw: unknown): RecurringSection[] {
  const list = Array.isArray(raw) ? (raw as RecurringSection[]) : [];
  if (list.length === 0) return [...DEFAULT_SECTIONS];
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const b of DEFAULT_SECTIONS) if (!byId.has(b.id)) list.push({ ...b });
  return list;
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
    return { items, sections: normalizeSections(parsed.sections) };
  } catch {
    return empty();
  }
}

/** Persist the recurring list, encrypted at rest when a session key is loaded. */
export async function saveRecurring(state: RecurringState): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, await encodeStateForStorage(JSON.stringify(state, bigintReplacer)));
}
