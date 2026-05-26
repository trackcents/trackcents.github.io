// Bank detector.  Identifies which BankAdapter recognizes a given PDF.
//
// Adapters self-register at module load time via `registerAdapter()`.  Routes
// that need parsing import `./index.ts` (which side-effect-imports every
// adapter), then call `detectAdapter(textSample)`.

import type { BankAdapter } from './types';

const registry: BankAdapter[] = [];

/**
 * Register an adapter.  Idempotent — registering the same adapter (by name)
 * twice is a no-op.  Order of registration does not matter; detection picks
 * the adapter whose `detect()` returns true.
 */
export function registerAdapter(adapter: BankAdapter): void {
  if (registry.some((a) => a.name === adapter.name)) return;
  registry.push(adapter);
}

/** Returns a snapshot of all registered adapters. */
export function listAdapters(): readonly BankAdapter[] {
  return [...registry];
}

export interface BankDetectionResult {
  adapter: BankAdapter;
}

/**
 * Run every registered adapter's `detect()` against a small text excerpt
 * (typically the first 4 KB of extracted text).  Returns the first match.
 *
 * Returns null if no adapter recognizes the PDF — the caller's UI should
 * surface this as "bank not supported yet" per FR-015.
 *
 * If two adapters both match, that's a registration bug — we throw to make
 * it loud and force the adapters to be more specific in their `detect()`.
 */
export function detectAdapter(textSample: string): BankDetectionResult | null {
  const matches = registry.filter((a) => a.detect(textSample));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const names = matches.map((a) => a.name).join(', ');
    throw new Error(
      `detectAdapter: ambiguous detection — ${matches.length} adapters matched: ${names}. ` +
        `Adapters must have non-overlapping detect() implementations.`
    );
  }
  return { adapter: matches[0]! };
}

/** Reset registry — used by unit tests only.  Not exported from the public surface. */
export function _resetRegistry(): void {
  registry.length = 0;
}
