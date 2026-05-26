/**
 * Recurring / subscription detection (US-P3-A) — Rocket-Money-style, but from
 * imported transactions only (no bank links). Generalizes the paycheck detector
 * to ALL merchants: a normalized descriptor seen ≥2 times at a regular cadence is
 * a recurring stream. STRUCTURE-based only (descriptor + spacing), never amount —
 * consistent with the no-amount-classification rule. The user can override.
 */
import { normalizeDescriptor } from './paycheck-detector';

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

/**
 * Detect recurring streams from a flat list of transactions. Returns one stream
 * per recurring merchant, sorted by `next_due` ascending (soonest first; nulls last).
 */
export function detectRecurring(txns: readonly RecurringTxn[]): RecurringStream[] {
  const groups = new Map<string, RecurringTxn[]>();
  for (const t of txns) {
    if (t.amount_minor === 0n) continue;
    const key = normalizeDescriptor(t.description);
    if (key === '') continue;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [t]);
    else g.push(t);
  }

  const streams: RecurringStream[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.posted_date < b.posted_date ? -1 : 1));
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
    const last = sorted[sorted.length - 1]!;

    let confidence: 'high' | 'medium' | 'low';
    if (sorted.length >= 3 && regular && cadence !== 'irregular') confidence = 'high';
    else if (cadence !== 'irregular' && regular) confidence = 'medium';
    else confidence = 'low';

    streams.push({
      stream_key: key,
      display_name: last.description,
      direction,
      cadence,
      occurrences: sorted.length,
      last_date: last.posted_date,
      next_due: cadence === 'irregular' ? null : addDays(last.posted_date, Math.round(medGap)),
      typical_amount_minor: medianBig(magnitudes),
      confidence
    });
  }

  return streams.sort((a, b) => {
    if (a.next_due === null) return b.next_due === null ? 0 : 1;
    if (b.next_due === null) return -1;
    return a.next_due < b.next_due ? -1 : a.next_due > b.next_due ? 1 : 0;
  });
}
