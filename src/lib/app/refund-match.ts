/**
 * Refund ↔ purchase matching (spec 002-income-pockets §7.6 — returns).
 *
 * A refund is the reversal of a specific purchase. The app already classifies a
 * positive credit-card row as a `refund` (flow-intent), which nets that category;
 * this module goes one step further and SUGGESTS which original purchase each
 * refund belongs to, so the user can LINK them (`refund_of`). Linking makes the
 * refund net the original's exact category and powers the "$X returned of $Y"
 * per-purchase tracking — including PARTIAL returns ($120 refunded of a $300 buy).
 *
 * Matching is STRUCTURAL, never amount-based-as-a-guess:
 *   - same order / reference number in the descriptor → `high` (e.g. Amazon
 *     prints "Order Number 114-2788…" on BOTH the charge and the credit);
 *   - else same merchant brand + the refund ≤ the purchase + the refund is on or
 *     after the purchase, within a window → `medium` (the user confirms).
 * Works for ALL vendors, not just Amazon. Pure; no I/O; no Date.now().
 */
import type { ImportRecord } from '../db/store';
import { transactionCategoryKey, type TransactionAnnotation } from './categorization';
import { flowIntentRowsFromImports } from './categorization-glue';
import { inferAllFlowIntents, REFUND_INTENTS, SPEND_INTENTS } from './flow-intent';
import { normalizeDescriptor } from './paycheck-detector';
import { cleanDescription } from '../util/description-clean';

/** Max days a refund can trail its purchase and still be considered a match. */
const MATCH_WINDOW_DAYS = 120;

export interface RefundLink {
  refundKey: string;
  purchaseKey: string;
  confidence: 'high' | 'medium';
  /** Positive magnitudes. */
  refundAmount: bigint;
  purchaseAmount: bigint;
  merchant: string;
  refundDate: string;
  purchaseDate: string;
}

/**
 * Pull an order / reference number from a descriptor, or null. Handles
 * "Order Number 114-2788003-…", "Order# 123-456", "CONF#25ri1myrc". Uppercased.
 */
export function extractOrderRef(description: string): string | null {
  const orderRe = /order\s*(?:number|no\.?|#)?\s*[:#]?\s*([0-9][0-9-]{5,})/i;
  const confRe = /conf\s*#?\s*([a-z0-9]{6,})/i;
  const m = orderRe.exec(description) ?? confRe.exec(description);
  return m && m[1] !== undefined ? m[1].toUpperCase() : null;
}

/** The merchant "brand" key for loose matching — the first word of the cleaned,
 *  digit-stripped descriptor (AMAZON MKTPLACE / Amazon.com → "AMAZON"). */
function merchantKey(description: string): string {
  const norm = normalizeDescriptor(cleanDescription(description));
  return norm.split(/\s+/)[0] ?? '';
}

function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(
    Number.parseInt(a.slice(0, 4), 10),
    Number.parseInt(a.slice(5, 7), 10) - 1,
    Number.parseInt(a.slice(8, 10), 10)
  );
  const tb = Date.UTC(
    Number.parseInt(b.slice(0, 4), 10),
    Number.parseInt(b.slice(5, 7), 10) - 1,
    Number.parseInt(b.slice(8, 10), 10)
  );
  return Math.round((tb - ta) / 86_400_000);
}

interface Row {
  key: string;
  date: string;
  /** Positive magnitude. */
  mag: bigint;
  desc: string;
  merchant: string;
  orderRef: string | null;
}

/**
 * Suggest refund → purchase links for every refund that the user hasn't linked
 * yet (no `refund_of`) and hasn't ignored. Best match per refund: an order-ref
 * hit wins (high); otherwise the same-merchant purchase whose amount is closest
 * to (and ≥) the refund and is nearest in time (medium). Deterministic.
 */
export function suggestRefundLinks(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): RefundLink[] {
  const rows = flowIntentRowsFromImports(imports, annotations);
  const intents = inferAllFlowIntents(rows, {});

  const purchases: Row[] = [];
  const refunds: Row[] = [];
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      if (ann?.ignored === true) return;
      const intent = intents.get(key) ?? 'unknown';
      const row: Row = {
        key,
        date: t.posted_date,
        mag: t.amount_minor < 0n ? -t.amount_minor : t.amount_minor,
        desc: t.description,
        merchant: merchantKey(t.description),
        orderRef: extractOrderRef(t.description)
      };
      if (t.amount_minor < 0n && SPEND_INTENTS.has(intent)) {
        purchases.push(row);
      } else if (t.amount_minor > 0n && REFUND_INTENTS.has(intent)) {
        // Only suggest for refunds the user hasn't already linked.
        if (ann?.refund_of === undefined || ann.refund_of === '') refunds.push(row);
      }
    });
  }

  const out: RefundLink[] = [];
  // Oldest refund first → deterministic.
  refunds.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  for (const r of refunds) {
    let best: { p: Row; confidence: 'high' | 'medium'; score: number } | null = null;
    for (const p of purchases) {
      if (p.key === r.key) continue;
      const gap = daysBetween(p.date, r.date);
      if (gap < 0 || gap > MATCH_WINDOW_DAYS) continue; // refund must be on/after the purchase
      if (p.mag < r.mag) continue; // can't refund more than was purchased

      const orderHit = r.orderRef !== null && p.orderRef !== null && r.orderRef === p.orderRef;
      const merchantHit = r.merchant !== '' && r.merchant === p.merchant;
      if (!orderHit && !merchantHit) continue;

      // Prefer order-ref; then closest amount; then closest date.
      const confidence: 'high' | 'medium' = orderHit ? 'high' : 'medium';
      const amountGap = Number(p.mag - r.mag);
      const score = (orderHit ? 0 : 1_000_000_000) + amountGap * 1000 + gap;
      if (best === null || score < best.score) best = { p, confidence, score };
    }
    if (best !== null) {
      out.push({
        refundKey: r.key,
        purchaseKey: best.p.key,
        confidence: best.confidence,
        refundAmount: r.mag,
        purchaseAmount: best.p.mag,
        merchant: best.p.merchant,
        refundDate: r.date,
        purchaseDate: best.p.date
      });
    }
  }
  return out;
}

/**
 * Total refunded (positive cents) per purchase key, from refunds the user HAS
 * linked (`refund_of`). Drives the "$X returned of $Y" tag on a purchase, and
 * supports multiple partial refunds stacking onto one purchase.
 */
export function returnedByPurchase(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      if (ann?.refund_of === undefined || ann.refund_of === '') return;
      const mag = t.amount_minor < 0n ? -t.amount_minor : t.amount_minor;
      out.set(ann.refund_of, (out.get(ann.refund_of) ?? 0n) + mag);
    });
  }
  return out;
}
