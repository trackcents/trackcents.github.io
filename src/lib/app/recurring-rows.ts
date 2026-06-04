/**
 * Surface PAID recurring bills/subscriptions as rows in the Transactions ledger
 * (Hemanth: "whatever I marked as paid in recurring is not showing up in
 * transactions"). Each PaymentRecord becomes one read-only UnifiedRow.
 *
 * These rows are DISPLAY-ONLY on the /transactions route. They are NOT real
 * imports, so:
 *   - they do NOT feed the pocket / dashboard math (those already count recurring
 *     payments once, via pocketSummariesForMonth's recurringPayments arg — see the
 *     bug-1 fix), so there is no double-count;
 *   - the table renders them read-only (no categorise / rename / split / delete);
 *     a recurring payment is managed (or un-paid) on the Recurring tab.
 *
 * They're tagged `adapter_name === RECURRING_ADAPTER_NAME` so the table and the
 * route handlers can recognise + special-case them.
 */
import type { UnifiedRow } from './transaction-view';
import type { RecurringItem, RecurringSection } from './recurring-items';

export const RECURRING_ADAPTER_NAME = 'recurring';

/** True for a synthetic recurring-payment row (vs a real imported transaction). */
export function isRecurringRow(r: Pick<UnifiedRow, 'adapter_name'>): boolean {
  return r.adapter_name === RECURRING_ADAPTER_NAME;
}

/** Build one read-only ledger row per recorded payment across all (non-archived)
 *  recurring items. `currency` is the app display currency (recurring items don't
 *  store one). */
export function recurringPaymentRows(
  items: readonly RecurringItem[],
  sections: readonly RecurringSection[],
  currency: string
): UnifiedRow[] {
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const rows: UnifiedRow[] = [];
  for (const item of items) {
    if (item.archived === true) continue;
    item.payments.forEach((p, i) => {
      const date =
        typeof p.paid_date === 'string' && p.paid_date.length >= 10
          ? p.paid_date.slice(0, 10)
          : `${p.month}-01`;
      rows.push({
        bank_name: 'Recurring',
        account_type: 'other',
        account_last_4: null,
        pdf_source_hash: `recurring-${item.id}`,
        adapter_name: RECURRING_ADAPTER_NAME,
        adapter_version: '1.0.0',
        posted_date: date,
        description: item.name,
        amount_minor: -p.amount_minor, // money OUT (payments are stored positive)
        currency,
        transaction_type: 'purchase',
        raw_text: item.name,
        import_index: -1,
        transaction_index: i,
        recurring_label: sectionName.get(item.section_id) ?? 'Recurring'
      });
    });
  }
  return rows;
}
