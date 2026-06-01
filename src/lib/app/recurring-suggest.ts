/**
 * Suggest recurring bills + subscriptions from imported statements (spec §7.5,
 * §7.8). The user asked us to PRE-FILL the Recurring tab — but smartly: by NAME +
 * repetition, never by amount. So we only surface charges whose descriptor is a
 * recognised bill/subscription (EMIs, loans, insurance, utilities, streaming
 * services) AND that repeat across ≥2 months. The user then edits / removes.
 *
 * This deliberately replaces the old "detect by repetition + spacing only"
 * approach (which produced nonsense like "Western Union · Weekly · $43k/yr").
 * Pure; no I/O; no Date.now() (today is injected).
 */
import type { ImportRecord } from '../db/store';
import { transactionCategoryKey, type TransactionAnnotation } from './categorization';
import { findBuiltinPattern } from './flow-intent';
import { normalizeDescriptor } from './paycheck-detector';
import { cleanDescription } from '../util/description-clean';
import { advanceDueDate, type Cadence, type RecurringKind } from './recurring-items';

/** Built-in pattern labels that are genuine recurring bills. */
const BILL_LABELS = new Set(['Loan/Installment', 'Insurance', 'Rent/Mortgage', 'Phone & Internet']);
const SUB_LABEL = 'Subscriptions';

export interface RecurringSuggestion {
  kind: RecurringKind;
  /** Display name (title-cased merchant brand). */
  name: string;
  /** Most-recent charge amount, in cents (positive). */
  amount_minor: bigint;
  cadence: Cadence;
  /** Next predicted due date (ISO), on/after today. */
  due_date: string;
  /** How many times it was seen (across statements). */
  occurrences: number;
  /** The category label it matched (Subscriptions / Insurance / …). */
  label: string;
}

/** Merchant key for grouping: the first two words of the digit-stripped descriptor. */
function merchantKey(rawDescription: string): string {
  const toks = normalizeDescriptor(cleanDescription(rawDescription)).split(/\s+/).filter(Boolean);
  return toks.slice(0, 2).join(' ');
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

interface Group {
  kind: RecurringKind;
  label: string;
  name: string;
  occ: Array<{ date: string; amount: bigint }>;
}

/**
 * Detect recurring bills + subscriptions. Returns one suggestion per merchant
 * that (a) matches a bill/subscription pattern by NAME and (b) recurs across ≥2
 * distinct months. Newest-amount, next-due predicted from the last occurrence.
 */
export function suggestRecurring(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>,
  todayIso: string
): RecurringSuggestion[] {
  const groups = new Map<string, Group>();
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      if (t.amount_minor >= 0n) return; // outflows only (a charge)
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      if (annotations[key]?.ignored === true) return;
      const hit = findBuiltinPattern(t.description, 'out');
      if (hit === null) return;
      const isSub = hit.label === SUB_LABEL;
      const isBill = BILL_LABELS.has(hit.label);
      if (!isSub && !isBill) return;
      const mk = merchantKey(t.description);
      if (mk === '') return;
      const gkey = `${hit.label}|${mk}`;
      let g = groups.get(gkey);
      if (g === undefined) {
        g = {
          kind: isSub ? 'subscription' : 'bill',
          label: hit.label,
          name: titleCase(mk),
          occ: []
        };
        groups.set(gkey, g);
      }
      g.occ.push({ date: t.posted_date, amount: -t.amount_minor });
    });
  }

  const out: RecurringSuggestion[] = [];
  for (const g of groups.values()) {
    const months = new Set(g.occ.map((o) => o.date.slice(0, 7)));
    if (months.size < 2) continue; // must recur across at least 2 months
    g.occ.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = g.occ[g.occ.length - 1]!;
    // Next due = the last charge's date rolled forward one month until it's not
    // in the past, so the suggestion lands on a future due date.
    let due = advanceDueDate(last.date, 'monthly');
    let guard = 0;
    while (due < todayIso && guard < 60) {
      due = advanceDueDate(due, 'monthly');
      guard++;
    }
    out.push({
      kind: g.kind,
      label: g.label,
      name: g.name,
      amount_minor: last.amount,
      cadence: 'monthly',
      due_date: due,
      occurrences: g.occ.length
    });
  }
  // Most-frequent first.
  out.sort((a, b) =>
    b.occurrences !== a.occurrences ? b.occurrences - a.occurrences : a.name < b.name ? -1 : 1
  );
  return out;
}
