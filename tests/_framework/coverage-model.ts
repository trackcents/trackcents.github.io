// Functional coverage model — the software analogue of a UVM covergroup /
// functional-coverage collector.
//
// Code coverage (vitest/v8) tells you which LINES ran. Functional coverage
// tells you which SCENARIOS were exercised — the ones the verification plan
// says matter (empty input, year-boundary wrap, same-date tie, odd vs even
// count, ...). Reaching 100% line coverage while leaving a scenario bin unhit
// is a classic false-confidence trap; this model makes that gap visible and
// gates sign-off on closure.
//
// Usage:
//   const cov = new CoverageModel(['n=0', 'n=1', 'n=even', 'n=odd', 'year-wrap']);
//   ... during stimulus: cov.cover('n=odd'); cov.cover('year-wrap'); ...
//   cov.assertClosed();              // throws listing any unhit cover points
//   console.log(cov.report());

export class CoverageModel {
  private readonly counts = new Map<string, number>();

  /** Declare the cover points the verification plan requires up front. */
  constructor(bins: readonly string[] = []) {
    for (const b of bins) this.counts.set(b, 0);
  }

  /** Declare an extra cover point discovered mid-run (e.g. a cross-coverage bin). */
  declare(bin: string): void {
    if (!this.counts.has(bin)) this.counts.set(bin, 0);
  }

  /** Record one hit. Unknown bins auto-declare so nothing is silently dropped. */
  cover(bin: string): void {
    this.counts.set(bin, (this.counts.get(bin) ?? 0) + 1);
  }

  /** Convenience: cover `bin` only when `condition` holds. */
  coverIf(condition: boolean, bin: string): void {
    if (condition) this.cover(bin);
  }

  hits(bin: string): number {
    return this.counts.get(bin) ?? 0;
  }

  /** Declared cover points that were never hit. */
  holes(): string[] {
    return [...this.counts.entries()].filter(([, n]) => n === 0).map(([b]) => b);
  }

  /** Fraction of declared cover points hit at least once (1 = full closure). */
  closure(): number {
    if (this.counts.size === 0) return 1;
    const hit = [...this.counts.values()].filter((n) => n > 0).length;
    return hit / this.counts.size;
  }

  /** Human-readable coverage report, one line per cover point. */
  report(): string {
    const lines = [...this.counts.entries()].map(([b, n]) => `  ${n > 0 ? '✓' : '✗'} ${b}: ${n}`);
    const hit = this.counts.size - this.holes().length;
    return `Functional coverage: ${(this.closure() * 100).toFixed(1)}% (${hit}/${this.counts.size} cover points)\n${lines.join('\n')}`;
  }

  /** Sign-off gate: throw if closure < `min` (default = full closure). */
  assertClosed(min = 1): void {
    if (this.closure() < min) {
      throw new Error(
        `Functional coverage closure ${(this.closure() * 100).toFixed(1)}% < required ${(min * 100).toFixed(1)}%.\nUnhit cover points (add directed/biased stimulus to close):\n  ${this.holes().join('\n  ')}`
      );
    }
  }
}
