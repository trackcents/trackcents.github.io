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
      const row: DetailedRow = {
        key,
        posted_date: t.posted_date,
        description: ann?.custom_name ?? t.description,
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
