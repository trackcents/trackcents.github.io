# Verification Contract — money (integer-cents parse/format utilities)

> Implementation-free contract for the independent verifier. WHAT + interface, never HOW.
> Produced by the Designer; consumed by the `verification-engineer` (via `/ivv`).

## 1. Module under verification

- **Source file** (do NOT open): `src/lib/util/money.ts`
- **Public entry points**: `parseMoney`, `formatMoney`, `sumMoney`, `absMoney`
- **Risk tier**: **Core (with one Critical surface).** `parseMoney` is a **parser of
  PDF-extracted money strings** on the money path — a parse bug corrupts amounts, so it
  earns real probes. `formatMoney` is display, `sumMoney`/`absMoney` are trivial bigint
  helpers — size those small on purpose.
- **Touches**: ☑ value/money math ☑ parsing of untrusted-ish input ☐ state ☐ concurrency ☐ authz ☐ UI
- **Right-sizing note for the verifier:** this is a SMALL module. Run **Stage 1** (the
  parser hazard probes + the round-trip metamorphic + a handful of goldens) and STOP
  unless Stage 1 finds a bug. Do NOT build a heavy reference model or run a full mutation
  marathon for four small functions — the round-trip property + boundary/adversarial
  probes are the high-yield checks here. A bounded fuzz of `parseMoney` is welcome; full
  external mutation is deferred unless Stage 1 draws blood (per the staged-gate policy).

## 2. Authoritative spec sources

- `.specify/memory/constitution.md` **Principle II** — money is integer cents; floats
  FORBIDDEN; **no silent parser failures** (bad input must throw, never coerce to 0).
- `specs/001-money-tracker-mvp/data-model.md` — signed-cents convention (outflow negative,
  inflow positive).

## 3. Public interface (signatures only)

```ts
export function parseMoney(text: string): bigint;            // signed integer cents; THROWS on bad input
export function formatMoney(cents: bigint, opts?: { currency?: string }): string;
export function sumMoney(values: Iterable<bigint>): bigint;
export function absMoney(cents: bigint): bigint;
```

## 4. Behavioral requirements (the WHAT)

`parseMoney` (the star):
- **R1 — plain values:** `"$1,234.56"`→`123456n`; `"1234.56"`→`123456n`; `"$0.05"`→`5n`; `"$0"`→`0n`.
- **R2 — whole-dollars implied:** `"5"`→`500n` (no decimal ⇒ ×100).
- **R3 — fractional padding:** `".5"` and `"$0.5"`→`50n` (1 frac digit padded to 2). A bare-fraction with no whole part is valid.
- **R4 — accounting parentheses = negative:** `"($1,234.56)"`→`-123456n`.
- **R5 — explicit minus:** `"-1,234.56"`→`-123456n`. (Parens and minus together, e.g. `"(-5)"`, stay negative — never double-negate to positive.)
- **R6 — tolerant of `$`, surrounding whitespace, and a single optional symbol.**
- **R7 — THROWS (Principle II, no silent failure) on:** empty/whitespace-only; nested parens (`"(($100))"`); no-digit (`"$"`, `"-"`, `"."`, `"()"`, `"5."`); malformed comma grouping (`"1,23,456"`); 3+ fractional digits (`"1.005"` — must THROW, **not** silently truncate to `1.00`); any non-numeric junk.

`formatMoney`:
- **R8 —** `123456n`→`"$1,234.56"`; `-123456n`→`"-$1,234.56"`; `5n`→`"$0.05"`; `0n`→`"$0.00"`. Always exactly 2 fractional digits; comma-grouped whole part; leading `-` for negatives.
- **R9 — currency:** `currency:'USD'` or omitted ⇒ `$` prefix; any other/empty currency ⇒ **no** symbol.

`sumMoney` / `absMoney`:
- **R10 —** `sumMoney` returns the bigint total of the iterable (`0n` for empty). `absMoney(x)` = `|x|`.

## 5. Invariants & properties (hold for ALL valid inputs)

- **INV1 — Round-trip (the headline oracle-free check):** for every `bigint c`,
  `parseMoney(formatMoney(c)) === c`. (No shared oracle needed; this alone catches most
  parse/format defects. Test with constrained-random bigints incl. negatives, 0, and
  large magnitudes > 2^53.)
- **INV2 — No silent failure:** every input in R7's reject set THROWS; `parseMoney` NEVER
  returns `0n`/`NaN`-equivalent for unparseable input.
- **INV3 — Sign correctness:** result is negative iff (accounting parens) OR (leading
  minus); magnitude is independent of sign representation (`parseMoney("($5)") === -parseMoney("$5")`).
- **INV4 — Exactness / no float:** parsing and formatting are bigint-exact at any
  magnitude; no precision loss, no rounding (3-digit fractions are rejected, not rounded).
- **INV5 — Purity/determinism:** same input ⇒ same output; no global state; throwing is
  the only side effect.
- **INV6 — `sumMoney` order-independence & associativity:** permuting the iterable doesn't
  change the total; equals the fold of `+`.

## 6. Domain edge cases that MUST be handled

`"$0"` / `"$0.00"` / `"-$0.00"` (→ `0n`, no negative-zero artifact); `".5"`; `"5"`; `"5."` (throw);
`"1.005"` (throw, not truncate); `"1,23,456"` (throw); `"(($100))"` (throw); `"   $1,000.00  "`
(whitespace); very large `"$999,999,999,999.99"`; `formatMoney` of `0n`, large negatives,
and the comma boundary (`1000n`→`"$10.00"`, `100000n`→`"$1,000.00"`); `sumMoney([])`→`0n`.

## 7. Explicitly OUT of scope / deferred — do NOT report as bugs

- Locale/i18n formatting, thousands separators other than `,`, currencies beyond the
  `$`/no-symbol rule (R9 is the whole spec for currency here).
- Rounding modes — there are none by design; 3+ fractional digits are rejected (R7).
- Which adapter calls `parseMoney` with which raw string — that's the adapters' concern.
- A full mutation marathon (see §1 right-sizing) unless Stage 1 finds a bug.

## 8. Error contract (no silent failures)

`parseMoney` THROWS an `Error` for every R7 case (message includes the offending input).
`formatMoney`/`sumMoney`/`absMoney` are total on `bigint` input and do not throw. Define
"valid" precisely per R1–R7 and test both sides of each boundary.

## 9–10. Security / runtime
N/A — pure utilities, no authz, no UI.

## 11. Known oracle hazards

- **Lean hard on INV1 (round-trip)** — it needs no shared oracle and is the strongest
  check; a reference re-implementation of `parseMoney` risks sharing the same regex blind
  spot, so prefer round-trip + hand-computed goldens over a mirror model.
- **Fractional handling:** `".5"`→50 (pad) vs `"1.005"`→throw (reject) vs `"5."`→throw — an
  easy place for an off-by-one or silent-truncate bug; hand-derive each.
- **Sign double-counting:** `"(-5)"` must be `-5n`, not `+5n` — verify parens+minus don't cancel.
- **Negative zero:** `"-$0.00"`/`"($0)"` must yield `0n` and round-trip cleanly (bigint has
  no `-0`, but confirm `formatMoney` of any zero is `"$0.00"`, never `"-$0.00"`).
