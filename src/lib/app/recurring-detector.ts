/**
 * Recurring / subscription detection (US-P3-A) — Rocket-Money-style, but from
 * imported transactions only (no bank links). Generalizes the paycheck detector
 * to ALL merchants: a normalized descriptor seen ≥4 times at a regular cadence
 * is a recurring stream. STRUCTURE-based only (descriptor + spacing), never
 * amount — consistent with the no-amount-classification rule.  The user can
 * override.
 *
 * Quality gate (REQ-B0.4 — fix for "Weekly · overdue" lies from Western Union
 * transfers in temp3):
 *   - ≥4 occurrences  (was 2 — caught Western Union as Weekly on 2 hits)
 *   - regularity:     max gap dev ≤ 25% of median (existing)
 *   - amount stability: all magnitudes within ±35% of median; if not, the
 *     stream is "Variable" — we still surface it but the cadence claim is
 *     downgraded to 'irregular' and `next_due` is null so we don't show a
 *     fake prediction.
 *   - clean descriptor: uses `descriptorKey` (cleanDescription + uppercase) so
 *     `PPD ID:…` / `Web ID:…` / leading MM/DD don't split one merchant into N
 *     streams.
 */
import { cleanDescription } from '../util/description-clean';
import { normalizeDescriptor } from './paycheck-detector';

/**
 * Group key for recurring detection.  Apply `cleanDescription` first to strip
 * ACH plumbing (Web ID, PPD ID, leading MM/DD, trailing reference IDs), then
 * `normalizeDescriptor` to drop all remaining digits and common ACH tokens.
 * This way "Western Union Capture 614…" + "Western Union Capture 612…" and
 * "SPOTIFY P0521" + "SPOTIFY P9914" land in the same bucket.
 */
function streamKey(raw: string): string {
  return normalizeDescriptor(cleanDescription(raw));
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'irregular';

export interface RecurringTxn {
  posted_date: string; // ISO YYYY-MM-DD
  amount_minor: bigint; // signed
  description: string;
}

export interface RecurringStream {
  /** Normalized descriptor key (what we grouped on). */
  stream_key: string;
  /** A representative human-readable description (the most recent original). */
  display_name: string;
  direction: 'inflow' | 'outflow';
  cadence: Cadence;
  occurrences: number;
  last_date: string;
  /** Predicted next charge date (last + median gap), or null if irregular. */
  next_due: string | null;
  /** Median magnitude (positive) of the charges. */
  typical_amount_minor: bigint;
  confidence: 'high' | 'medium' | 'low';
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
  return Math.round(ms / 86_400_000);
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
function medianBig(nums: bigint[]): bigint {
  if (nums.length === 0) return 0n;
  const s = [...nums].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as bigint) : ((s[m - 1] as bigint) + (s[m] as bigint)) / 2n;
}

function classifyCadence(medianGap: number): Cadence {
  if (medianGap >= 6 && medianGap <= 8) return 'weekly';
  if (medianGap >= 12 && medianGap <= 16) return 'biweekly';
  if (medianGap >= 26 && medianGap <= 33) return 'monthly';
  return 'irregular';
}

export interface RecurringOptions {
  /** Minimum occurrences before a stream is reported. Default 4 (REQ-B0.4).
   *  The IV&V suite passes 2 to lock the legacy detector's behaviour. */
  minOccurrences?: number;
  /** Enable amount-stability gate (REQ-B0.4).  Default true. */
  requireAmountStable?: boolean;
}

/**
 * Detect recurring streams from a flat list of transactions. Returns one stream
 * per recurring merchant, sorted by `next_due` ascending (soonest first; nulls last).
 */
export function detectRecurring(
  txns: readonly RecurringTxn[],
  opts: RecurringOptions = {}
): RecurringStream[] {
  const minOcc = opts.minOccurrences ?? 4;
  const requireStable = opts.requireAmountStable ?? true;
  const groups = new Map<string, RecurringTxn[]>();
  for (const t of txns) {
    if (t.amount_minor === 0n) continue;
    // REQ-B0.4: use the cleaned + uppercased descriptor so ACH metadata
    // (PPD ID:..., Web ID:..., leading MM/DD) doesn't split one merchant
    // into multiple streams.  Without this, three Western Union charges with
    // three different "Capture <ref>" suffixes look like three different
    // merchants — and a stream that should never qualify for cadence detection
    // ends up in the Recurring list.
    const key = streamKey(t.description);
    if (key === '') continue;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [t]);
    else g.push(t);
  }

  const streams: RecurringStream[] = [];
  for (const [key, group] of groups) {
    // REQ-B0.4: default minimum is 4 occurrences (was ≥2).  Two data points
    // cannot honestly establish a cadence — that's what put "05/18 Payment
    // To Chase Card" into the Recurring view as "Weekly · overdue" in the
    // screenshots.  The IV&V suite passes minOccurrences=2 to keep its
    // legacy scoreboard intact.
    if (group.length < minOcc) continue;
    // Total order with a deterministic tiebreak: same-date ties used to leave the
    // "last" pick (and thus display_name) to input order, so rotating the input
    // could change the output — the IV&V permutation-invariance property caught it.
    // Tiebreak is for ORDERING only (date → description → amount), never to infer
    // a transaction's meaning from its amount.
    const sorted = [...group].sort((a, b) => {
      if (a.posted_date !== b.posted_date) return a.posted_date < b.posted_date ? -1 : 1;
      if (a.description !== b.description) return a.description < b.description ? -1 : 1;
      return a.amount_minor < b.amount_minor ? -1 : a.amount_minor > b.amount_minor ? 1 : 0;
    });
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1]!.posted_date, sorted[i]!.posted_date));
    }
    const medGap = median(gaps);
    if (medGap <= 0) continue; // same-day duplicates, not a cadence
    const cadence = classifyCadence(medGap);

    // Regularity: how tightly the gaps cluster around the median.
    const maxDev = gaps.length ? Math.max(...gaps.map((g) => Math.abs(g - medGap))) : Infinity;
    const regular = maxDev <= Math.max(4, medGap * 0.25);

    const positives = sorted.filter((t) => t.amount_minor > 0n).length;
    const direction: 'inflow' | 'outflow' = positives > sorted.length / 2 ? 'inflow' : 'outflow';
    const magnitudes = sorted.map((t) => (t.amount_minor < 0n ? -t.amount_minor : t.amount_minor));
    const medMag = medianBig(magnitudes);
    const last = sorted[sorted.length - 1]!;

    // REQ-B0.4: amount stability.  All magnitudes must be within ±35% of the
    // median; otherwise the stream is "variable" and we don't make a cadence
    // claim or predict next_due.  This prevents the "Robinhood Card Payment
    // monthly · in 9 days · $1,156" lie that averaged a $345 + $1,968 pair.
    let amountStable = true;
    if (requireStable && medMag > 0n) {
      // Bound = medMag * 0.35.  Bigint math: multiply numerator and denom.
      const upperBound = (medMag * 135n) / 100n;
      const lowerBound = (medMag * 65n) / 100n;
      for (const m of magnitudes) {
        if (m > upperBound || m < lowerBound) {
          amountStable = false;
          break;
        }
      }
    }

    const effectiveCadence: Cadence = amountStable ? cadence : 'irregular';

    let confidence: 'high' | 'medium' | 'low';
    if (sorted.length >= 3 && regular && amountStable && effectiveCadence !== 'irregular')
      confidence = 'high';
    else if (effectiveCadence !== 'irregular' && regular && amountStable) confidence = 'medium';
    else confidence = 'low';

    streams.push({
      stream_key: key,
      display_name: last.description,
      direction,
      cadence: effectiveCadence,
      occurrences: sorted.length,
      last_date: last.posted_date,
      next_due:
        effectiveCadence === 'irregular' ? null : addDays(last.posted_date, Math.round(medGap)),
      typical_amount_minor: medMag,
      confidence
    });
  }

  return streams.sort((a, b) => {
    if (a.next_due === null) return b.next_due === null ? 0 : 1;
    if (b.next_due === null) return -1;
    return a.next_due < b.next_due ? -1 : a.next_due > b.next_due ? 1 : 0;
  });
}
