// Scoreboard — the software analogue of a UVM scoreboard with a reference model.
//
// A scoreboard runs the SAME stimulus through two paths and judges agreement:
//   - the DUT (design under test): the implementation being verified
//   - the reference model: an INDEPENDENT re-implementation of the spec the
//     verifier writes itself (the "golden" model), never derived from the DUT's code
// For every input, it compares outputs and records mismatches with a readable diff.
//
// Oracle caveat (Knight & Leveson): the reference model and the DUT both descend
// from the same spec, so they can share a blind spot and "agree" on a wrong
// answer. The scoreboard is therefore necessary but NOT sufficient — pair it with
// oracle-free metamorphic checks and hand-derived golden values. See the
// verification-engineer charter.
//
// Usage:
//   const sb = new Scoreboard({ dut: realFn, model: myGoldenFn, show: (i) => JSON.stringify(i) });
//   fc.assert(fc.property(arbInput, (i) => { sb.check(i); }));
//   sb.assertClean();   // throws with diffs if DUT ever disagreed with the model

export interface ScoreboardOptions<I, O> {
  /** The implementation under verification. */
  dut: (input: I) => O;
  /** The verifier's independent reference implementation of the spec. */
  model: (input: I) => O;
  /** Equality test. Defaults to a bigint-aware deep equality. */
  eq?: (expected: O, actual: O) => boolean;
  /** Render an input for the mismatch report. Defaults to bigint-aware stringify. */
  show?: (input: I) => string;
}

export interface ScoreboardMismatch {
  expected: string;
  actual: string;
  where: string;
}

export class Scoreboard<I, O> {
  private readonly mism: ScoreboardMismatch[] = [];
  private checked = 0;

  constructor(private readonly opts: ScoreboardOptions<I, O>) {}

  /** Run one input through DUT and model; record a mismatch if they disagree. */
  check(input: I): boolean {
    this.checked += 1;
    const expected = this.opts.model(input);
    const actual = this.opts.dut(input);
    const same = this.opts.eq ? this.opts.eq(expected, actual) : deepEqual(expected, actual);
    if (!same) {
      this.mism.push({
        expected: stringify(expected),
        actual: stringify(actual),
        where: this.opts.show ? this.opts.show(input) : stringify(input)
      });
    }
    return same;
  }

  get comparisons(): number {
    return this.checked;
  }

  get mismatches(): readonly ScoreboardMismatch[] {
    return this.mism;
  }

  /** Sign-off gate: throw with diffs if the DUT ever disagreed with the model. */
  assertClean(): void {
    if (this.mism.length > 0) {
      const sample = this.mism
        .slice(0, 5)
        .map(
          (m, i) =>
            `#${i + 1} input=${m.where}\n     expected(model)=${m.expected}\n     actual(dut)   =${m.actual}`
        );
      throw new Error(
        `Scoreboard: ${this.mism.length}/${this.checked} comparisons mismatched (DUT vs independent reference model):\n${sample.join('\n')}`
      );
    }
  }
}

/** Stable stringify that survives bigint (JSON.stringify throws on bigint). */
export function stringify(v: unknown): string {
  return JSON.stringify(v, (_key, val) => (typeof val === 'bigint' ? `${val}n` : val));
}

/** Deep structural equality, bigint-aware. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'bigint' || typeof b === 'bigint') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
      )
    );
  }
  return false;
}
