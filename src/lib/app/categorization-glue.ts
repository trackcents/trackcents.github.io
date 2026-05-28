/**
 * Glue between the normalized imports and the categorization/dashboard layers.
 * Pure joins — no storage/UI. Each transaction is addressed by the stable key
 * `<pdf_source_hash>#<txIndex>` (an import is immutable by its hash, so its
 * transaction order is fixed), which is also how annotations are keyed.
 */
import type { ImportRecord } from '../db/store';
import {
  transactionCategoryKey,
  type CategorizableTransaction,
  type TransactionAnnotation
} from './categorization';
import type { SummaryTransaction } from './spending-summary';
import { SPEND_INTENTS, INCOME_INTENTS, REFUND_INTENTS, type FlowIntent } from './flow-intent';
import { cleanDescription } from '../util/description-clean';

/**
 * The category a transaction's amount counts toward in spending aggregation.
 * Normally the transaction's own annotated category. BUT if the transaction is a
 * REFUND linked to an original purchase (`refund_of`), it inherits the ORIGINAL's
 * category so the (positive) refund nets against that category instead of being
 * double-counted as income (US-P3-C). Follows the link exactly one hop — a refund
 * of a refund is not chased (and refund_of pointing at a missing/own key falls back
 * to the transaction's own category). Pure.
 */
export function resolveEffectiveCategory(
  annotations: Record<string, TransactionAnnotation>,
  key: string
): string | null {
  const ann = annotations[key];
  if (ann === undefined) return null;
  if (ann.refund_of !== undefined && ann.refund_of !== '' && ann.refund_of !== key) {
    const original = annotations[ann.refund_of];
    if (original !== undefined) return original.category_id ?? null;
  }
  return ann.category_id ?? null;
}

/** Flatten imports → {key, description} for the rule engine. */
export function categorizableFromImports(imports: ImportRecord[]): CategorizableTransaction[] {
  const out: CategorizableTransaction[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      out.push({ key: transactionCategoryKey(imp.pdf_source_hash, i), description: t.description });
    });
  }
  return out;
}

/** Join imports + annotations → {date, amount, category} for the dashboard math. */
export function summaryFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): SummaryTransaction[] {
  const out: SummaryTransaction[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      if (ann?.ignored) return; // excluded from spending/budget aggregations
      const split = ann?.split;
      if (split !== undefined && split.length > 0) {
        // Split (US-SPLIT): emit one row per part, plus a remainder row so the
        // total ALWAYS equals the transaction (conservation), even if the parts
        // don't sum to the whole. The remainder goes to the txn's own/effective
        // category.
        let partsSum = 0n;
        for (const part of split) {
          out.push({
            posted_date: t.posted_date,
            amount_minor: part.amount_minor,
            category_id: part.category_id
          });
          partsSum += part.amount_minor;
        }
        const remainder = t.amount_minor - partsSum;
        if (remainder !== 0n) {
          out.push({
            posted_date: t.posted_date,
            amount_minor: remainder,
            category_id: resolveEffectiveCategory(annotations, key)
          });
        }
        return;
      }
      out.push({
        posted_date: t.posted_date,
        amount_minor: t.amount_minor,
        // refunds inherit the original purchase's category so they net (US-P3-C)
        category_id: resolveEffectiveCategory(annotations, key)
      });
    });
  }
  return out;
}

/** A row with enough detail for a drill-down list (description + source). */
export interface DetailedRow {
  key: string;
  posted_date: string;
  /** Display name = the user's rename (custom_name) if set, else the parsed description. */
  description: string;
  amount_minor: bigint;
  category_id: string | null;
  bank_name: string;
  ignored: boolean;
  /** If set, this row is a refund of the transaction with this key (US-P3-C). */
  refund_of?: string;
}

/**
 * Flow-intent-aware projection (REQ-B0.1 / REQ-B2.2) — built by walking imports directly
 * so we can attach the flow_intent per source transaction.  Split rows
 * inherit the parent transaction's flow_intent (a split of a CC payment is
 * still cc_payment).  Splits and refunds: parent intent decides whether the
 * row is included at all.
 */
export function summaryByFlowIntent(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>,
  flowIntents: ReadonlyMap<string, FlowIntent>
): {
  spend: SummaryTransaction[];
  income: SummaryTransaction[];
  movement: SummaryTransaction[];
  all: SummaryTransaction[];
} {
  const spend: SummaryTransaction[] = [];
  const income: SummaryTransaction[] = [];
  const movement: SummaryTransaction[] = [];
  const all: SummaryTransaction[] = [];

  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      if (ann?.ignored) return;
      const intent: FlowIntent = flowIntents.get(key) ?? 'unknown';
      const split = ann?.split;

      const baseRows: SummaryTransaction[] = [];
      if (split !== undefined && split.length > 0) {
        let partsSum = 0n;
        for (const part of split) {
          baseRows.push({
            posted_date: t.posted_date,
            amount_minor: part.amount_minor,
            category_id: part.category_id
          });
          partsSum += part.amount_minor;
        }
        const remainder = t.amount_minor - partsSum;
        if (remainder !== 0n) {
          baseRows.push({
            posted_date: t.posted_date,
            amount_minor: remainder,
            category_id: resolveEffectiveCategory(annotations, key)
          });
        }
      } else {
        baseRows.push({
          posted_date: t.posted_date,
          amount_minor: t.amount_minor,
          category_id: resolveEffectiveCategory(annotations, key)
        });
      }

      for (const r of baseRows) {
        all.push(r);
        if (SPEND_INTENTS.has(intent) || REFUND_INTENTS.has(intent)) {
          spend.push(r);
        } else if (INCOME_INTENTS.has(intent)) {
          income.push(r);
        } else {
          movement.push(r);
        }
      }
    });
  }
  return { spend, income, movement, all };
}

/**
 * Stable account_id for a given import record.  Used by transfer-detector and
 * flow-intent inference so the same Chase Checking 9535 across multiple
 * statements is one account.  Format: `<bank_name>:<account_type>:<last4>`.
 */
export function accountIdFromImport(imp: ImportRecord): string {
  const bank = imp.bank_name ?? 'unknown';
  const type = imp.statement.account_type ?? 'other';
  const last4 = imp.statement.account_last_4 ?? '----';
  return `${bank}:${type}:${last4}`;
}

/**
 * Convenience: produce a flow-intent-aware month-keyed cash-flow map (REQ-B0.1).
 * Use this in place of `netByMonth(summaryFromImports(...))` everywhere that
 * needs an HONEST spend vs income view (Home BudgetBox, Budget page totals,
 * Dashboard Money Out, Spending-by-Category-by-Month).
 *
 * Returns one CashFlow per calendar month where:
 *   - `inflow_minor`  = REAL income only (salary / gift_in / interest / cash_in)
 *   - `outflow_minor` = REAL spend net of refunds (purchase / bill_pay /
 *                       loan_payment / fees / interest_charged / cash_out /
 *                       unknown — MINUS refunds)
 *   - `net_minor`     = inflow − outflow (positive means surplus this month)
 *
 * CC payments, inter-account transfers, and investment transfers are EXCLUDED
 * from both sides — they are money movement, not life cash-flow.
 *
 * Caller may optionally pass detector outputs to sharpen classification:
 *   - `paycheckKeys`: keys flagged by paycheck-detector as recurring salary.
 *   - `transferPairKeys`: keys flagged by transfer-detector as paired moves.
 *   - `reconciledCcPayments`: keys flagged by reconciliation as bank→CC pays.
 */
export interface SpendableFlowOptions {
  paycheckKeys?: ReadonlySet<string>;
  transferPairKeys?: ReadonlySet<string>;
  reconciledCcPayments?: ReadonlySet<string>;
}

export function spendableFlowByMonth(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>,
  opts: SpendableFlowOptions = {}
): Map<string, { inflow_minor: bigint; outflow_minor: bigint; net_minor: bigint }> {
  const rows = flowIntentRowsFromImports(imports, annotations);
  const context: {
    reconciledCcPayments?: ReadonlySet<string>;
    transferPairKeys?: ReadonlySet<string>;
    paycheckKeys?: ReadonlySet<string>;
  } = {};
  if (opts.reconciledCcPayments !== undefined)
    context.reconciledCcPayments = opts.reconciledCcPayments;
  if (opts.transferPairKeys !== undefined) context.transferPairKeys = opts.transferPairKeys;
  if (opts.paycheckKeys !== undefined) context.paycheckKeys = opts.paycheckKeys;
  const intents = inferAllFlowIntents(rows, context);
  const { spend, income } = summaryByFlowIntent(imports, annotations, intents);

  const monthKey = (iso: string): string => iso.slice(0, 7);

  const spendByMonth = new Map<string, { out: bigint; refunds: bigint }>();
  for (const t of spend) {
    const m = monthKey(t.posted_date);
    const cur = spendByMonth.get(m) ?? { out: 0n, refunds: 0n };
    if (t.amount_minor < 0n) cur.out += -t.amount_minor;
    else cur.refunds += t.amount_minor;
    spendByMonth.set(m, cur);
  }
  const incomeByMonth = new Map<string, bigint>();
  for (const t of income) {
    if (t.amount_minor > 0n) {
      const m = monthKey(t.posted_date);
      incomeByMonth.set(m, (incomeByMonth.get(m) ?? 0n) + t.amount_minor);
    }
  }

  const allMonths = new Set<string>([...spendByMonth.keys(), ...incomeByMonth.keys()]);
  const result = new Map<
    string,
    { inflow_minor: bigint; outflow_minor: bigint; net_minor: bigint }
  >();
  for (const m of allMonths) {
    const s = spendByMonth.get(m) ?? { out: 0n, refunds: 0n };
    const inflow = incomeByMonth.get(m) ?? 0n;
    // Net spend (positive magnitude): gross outflow minus refunds, floored at 0
    // — a "negative spend month" (refunds exceed real spend) is reported as 0,
    // not as negative spend.
    let outflow = s.out - s.refunds;
    if (outflow < 0n) outflow = 0n;
    result.set(m, { inflow_minor: inflow, outflow_minor: outflow, net_minor: inflow - outflow });
  }
  return result;
}

import { inferAllFlowIntents } from './flow-intent';

/** Build the row shape `inferAllFlowIntents` expects, from raw imports. */
export function flowIntentRowsFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): Array<{
  key: string;
  posted_date: string;
  description: string;
  amount_minor: bigint;
  account_id: string;
  is_credit_card_row: boolean;
  user_intent?: FlowIntent;
}> {
  const out: Array<{
    key: string;
    posted_date: string;
    description: string;
    amount_minor: bigint;
    account_id: string;
    is_credit_card_row: boolean;
    user_intent?: FlowIntent;
  }> = [];
  for (const imp of imports) {
    const account_id = accountIdFromImport(imp);
    const is_credit_card_row = imp.statement.account_type === 'credit_card';
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      if (ann?.ignored) return;
      const row: {
        key: string;
        posted_date: string;
        description: string;
        amount_minor: bigint;
        account_id: string;
        is_credit_card_row: boolean;
        user_intent?: FlowIntent;
      } = {
        key,
        posted_date: t.posted_date,
        description: t.description,
        amount_minor: t.amount_minor,
        account_id,
        is_credit_card_row
      };
      if (ann?.flow_intent !== undefined) row.user_intent = ann.flow_intent as FlowIntent;
      out.push(row);
    });
  }
  return out;
}

/** Join imports + annotations → detailed rows (for the chart drill-down list). */
export function detailedRowsFromImports(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): DetailedRow[] {
  const out: DetailedRow[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      // REQ-B0.3: strip ACH metadata (Web ID, PPD ID, leading MM/DD,
      // trailing reference IDs) at the display layer so every downstream
      // surface that reads `description` (Home Recent, Spending Trends,
      // Recurring, Transactions list) shows clean merchant text.  User's
      // custom_name (if set) always wins.
      const row: DetailedRow = {
        key,
        posted_date: t.posted_date,
        description: ann?.custom_name ?? cleanDescription(t.description),
        amount_minor: t.amount_minor,
        category_id: ann?.category_id ?? null,
        bank_name: imp.bank_name,
        ignored: ann?.ignored ?? false
      };
      if (ann?.refund_of !== undefined && ann.refund_of !== '') row.refund_of = ann.refund_of;
      out.push(row);
    });
  }
  return out;
}
