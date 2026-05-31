/**
 * Income Pockets (spec 002-income-pockets §2, §7.11, §7.12 slice 1-2).
 *
 * Income is NOT one combined number — it is split into named **pockets** (boxes),
 * each tracked separately and identically: `Total in · Used · Remaining · % used`.
 * Two defaults ship: 💵 Paychecks (recurring salary) and 🎁 Extra (everything that
 * arrives separately — bonus, person transfer, refund). The user may add more.
 *
 * PERIOD (v1) = calendar month, with **per-pocket carry-forward (±)** on the 1st
 * (§7.11): a pocket does NOT reset to zero each month — its end-of-month remaining
 * (positive OR negative) carries into the SAME pocket next month. So:
 *
 *   carryIn(P,M)   = remaining(P, M-1)                       (signed, cumulative)
 *   total(P,M)     = carryIn(P,M) + newIncome(P,M)
 *   remaining(P,M) = total(P,M)  − used(P,M)
 *                  = Σ_{m≤M} income(P,m) − Σ_{m≤M} used(P,m)
 *
 * which telescopes — remaining is just cumulative-income minus cumulative-used, so
 * the carry-forward is automatic and exact (no per-month "rollover write" needed).
 *
 * MONEY TRUTH (P0): all amounts are bigint cents; this module never converts to
 * float for arithmetic (only for the display-only `pctUsed`). It REUSES the same
 * per-part split routing as `summaryByFlowIntent` (categorization-glue), applied on
 * the FUNDING side: income parts fill a pocket by flow-intent; spend parts draw
 * from `annotation.paid_from`. Conservation is preserved — every part's signed
 * amount plus the remainder is accounted for, exactly as the spend summary does.
 *
 * Pure: no storage, no UI, no Date.now().
 */
import type { ImportRecord } from '../db/store';
import { transactionCategoryKey, type TransactionAnnotation } from './categorization';
import {
  SPEND_INTENTS,
  INCOME_INTENTS,
  REFUND_INTENTS,
  inferAllFlowIntents,
  type FlowIntent
} from './flow-intent';
import { flowIntentRowsFromImports, type SpendableFlowOptions } from './categorization-glue';

/** A named income box. `logo` is an emoji; `color` is an app token name. */
export interface Pocket {
  /** Stable id (e.g. 'paychecks'). Referenced by `annotation.paid_from`. */
  id: string;
  name: string;
  /** Emoji shown on the card. */
  logo: string;
  /** App colour-token name ('success' | 'accent' | …) used for the card accent. */
  color: string;
  /** Sort order on Home (lower first). */
  order: number;
}

/** The default pocket id every expense draws from until told otherwise (the 90% rule). */
export const DEFAULT_PAID_FROM = 'paychecks';

/**
 * The two pockets that ship by default (§2). Paychecks = recurring salary; Extra =
 * everything off-cadence. (Manual-only users see them renamed Pocket money / Extra
 * pocket money in the UI; the ids stay the same so routing is unaffected.)
 */
export const DEFAULT_POCKETS: Pocket[] = [
  { id: 'paychecks', name: 'Paychecks', logo: '💵', color: 'success', order: 0 },
  { id: 'extra', name: 'Extra', logo: '🎁', color: 'accent', order: 1 }
];

/**
 * Which pocket an income deposit fills, from its flow-intent (§6, §7.12 slice 1):
 *   salary                                  → Paychecks
 *   gift_in / interest_earned / cash_in     → Extra
 * Non-income intents return null (they are spend or money-movement, not a deposit
 * that fills a pocket). Pure; never amount-based.
 */
export function pocketIdForIntent(intent: FlowIntent): string | null {
  if (intent === 'salary') return 'paychecks';
  if (INCOME_INTENTS.has(intent)) return 'extra';
  return null;
}

/** Per-pocket figures for one calendar month, with carry-forward folded in. */
export interface PocketSummary {
  pocket: Pocket;
  /** Signed balance carried in from all prior months (remaining at end of M-1). */
  carryIn: bigint;
  /** New income that landed in this pocket THIS month. */
  newIncome: bigint;
  /** carryIn + newIncome — the pocket's spendable total for the month. */
  total: bigint;
  /** Expenses drawn from this pocket THIS month (positive magnitude, net of refunds). */
  used: bigint;
  /** total − used. May be negative (over-used) — shown in red, never hidden. */
  remaining: bigint;
  /** Display-only: used / total as a percent (0..>100). 0 when total ≤ 0. */
  pctUsed: number;
}

/** Internal per-pocket accumulator, split into "before this month" vs "this month". */
interface Acc {
  incomeBefore: bigint;
  usedBefore: bigint;
  incomeThis: bigint;
  usedThis: bigint;
}

/**
 * Per-pocket month math (§7.12 slice 2). For the target calendar `month`
 * (`'YYYY-MM'`), returns one `PocketSummary` per pocket (ordered by `pocket.order`)
 * with carry-forward (±) from all earlier months already folded in.
 *
 * Routing, per transaction (mirrors `summaryByFlowIntent`'s split handling):
 *   - ignored annotations are skipped entirely;
 *   - the transaction is broken into its split parts (+ a remainder part so the
 *     signed total is conserved), each part carrying its own effective intent;
 *   - an INCOME part adds its (positive) amount to `pocketIdForIntent(intent)`;
 *   - a SPEND/REFUND part adds its outflow magnitude (−amount) to the pocket named
 *     by `annotation.paid_from` (default Paychecks) — a refund is a negative draw,
 *     so it gives money back, exactly like the spend summary nets refunds;
 *   - MOVEMENT parts (cc_payment / transfer_self / investment_out) touch no pocket.
 *
 * Months AFTER `month` are ignored. Income/draws whose target pocket no longer
 * exists fall back to the first pocket so no money silently vanishes.
 *
 * Pure. `opts` accepts the same detector keys as `spendableFlowByMonth` so the
 * intent inference can be sharpened later (slice 7) without changing this signature.
 */
export function pocketSummariesForMonth(
  imports: ImportRecord[],
  annotations: Record<string, TransactionAnnotation>,
  month: string,
  pockets: Pocket[],
  opts: SpendableFlowOptions = {}
): PocketSummary[] {
  const ordered = [...pockets].sort((a, b) => a.order - b.order);
  // Defensive: an empty pocket list would lose all routing — fall back to defaults.
  const list = ordered.length > 0 ? ordered : [...DEFAULT_POCKETS];
  const known = new Set(list.map((p) => p.id));
  const firstId = list[0]!.id;
  const resolvePocket = (id: string | null): string =>
    id !== null && known.has(id) ? id : firstId;

  // Compute flow-intents exactly as the spend summary does (same inputs → same
  // bucketing), so a pocket's "used" reconciles with "Spent" for that month.
  const rows = flowIntentRowsFromImports(imports, annotations);
  const context: SpendableFlowOptions = {};
  if (opts.reconciledCcPayments !== undefined)
    context.reconciledCcPayments = opts.reconciledCcPayments;
  if (opts.transferPairKeys !== undefined) context.transferPairKeys = opts.transferPairKeys;
  if (opts.paycheckKeys !== undefined) context.paycheckKeys = opts.paycheckKeys;
  const intents = inferAllFlowIntents(rows, context);

  const acc = new Map<string, Acc>();
  for (const p of list) {
    acc.set(p.id, { incomeBefore: 0n, usedBefore: 0n, incomeThis: 0n, usedThis: 0n });
  }

  for (const imp of imports) {
    imp.transactions.forEach((t, i) => {
      const key = transactionCategoryKey(imp.pdf_source_hash, i);
      const ann = annotations[key];
      if (ann?.ignored === true) return;

      const txMonth = t.posted_date.slice(0, 7);
      if (txMonth > month) return; // future month — not counted in this view
      const isThis = txMonth === month;

      const parentIntent: FlowIntent = intents.get(key) ?? 'unknown';
      const paidFrom = resolvePocket(ann?.paid_from ?? DEFAULT_PAID_FROM);

      // Break into parts identically to summaryByFlowIntent: each split part keeps
      // its own intent; a remainder part (parent − Σparts) keeps the parent intent,
      // so the transaction's signed total is conserved.
      const parts: Array<{ amount: bigint; intent: FlowIntent }> = [];
      const split = ann?.split;
      if (split !== undefined && split.length > 0) {
        let partsSum = 0n;
        for (const part of split) {
          parts.push({
            amount: part.amount_minor,
            intent: (part.flow_intent as FlowIntent | undefined) ?? parentIntent
          });
          partsSum += part.amount_minor;
        }
        const remainder = t.amount_minor - partsSum;
        if (remainder !== 0n) parts.push({ amount: remainder, intent: parentIntent });
      } else {
        parts.push({ amount: t.amount_minor, intent: parentIntent });
      }

      for (const { amount, intent } of parts) {
        if (INCOME_INTENTS.has(intent)) {
          const pid = resolvePocket(pocketIdForIntent(intent));
          const a = acc.get(pid)!;
          if (isThis) a.incomeThis += amount;
          else a.incomeBefore += amount;
        } else if (SPEND_INTENTS.has(intent) || REFUND_INTENTS.has(intent)) {
          const a = acc.get(paidFrom)!;
          // Outflows are negative cents; "used" is positive magnitude. A refund is a
          // positive amount → a NEGATIVE draw → it gives the pocket money back.
          if (isThis) a.usedThis += -amount;
          else a.usedBefore += -amount;
        }
        // MOVEMENT intents: no pocket effect.
      }
    });
  }

  return list.map((pocket) => {
    const a = acc.get(pocket.id)!;
    const carryIn = a.incomeBefore - a.usedBefore;
    const newIncome = a.incomeThis;
    const total = carryIn + newIncome;
    const used = a.usedThis;
    const remaining = total - used;
    const pctUsed = total > 0n ? clampPct((Number(used) / Number(total)) * 100) : 0;
    return { pocket, carryIn, newIncome, total, used, remaining, pctUsed };
  });
}

/** Clamp a percent to [0, 999] for display (a wildly over-used pocket caps the bar). */
function clampPct(p: number): number {
  if (!Number.isFinite(p) || p < 0) return 0;
  return p > 999 ? 999 : Math.round(p);
}

/** Find a pocket by id (or undefined). Pure helper for callers. */
export function findPocket(pockets: Pocket[], id: string): Pocket | undefined {
  return pockets.find((p) => p.id === id);
}
