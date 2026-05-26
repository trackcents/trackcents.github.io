# Verification Contract — [MODULE OR FEATURE]

> **The only engineering artifact handed to the independent verifier.**
> Implementation-free by construction: it states WHAT the module must do and the
> interface it exposes, never HOW. The verifier authors its environment from this
> contract + the cited spec, and never reads the source. If you cannot describe a
> required behavior here without referring to the code, the behavior is
> underspecified — that is a finding waiting to happen; fix the contract (and
> likely the spec) now.
>
> Produced by: the Designer. Consumed by: the `verification-engineer` (via `/verif-kit`).

## 1. Module under verification

- **Source file(s)** (named so the verifier knows what NOT to open): `[PATH]`
- **Public entry points**: `[exported names]`
- **Risk tier** (drives which lenses + floors apply, per `verif-kit.config.json`): `[P0|P1|P2|P3]`
- **Touches** (check all that apply — selects lenses): ☐ value/money math ☐ parsing/untrusted input ☐ persistent state ☐ concurrency/async ☐ authn/authz/multi-user ☐ a running UI/app

## 2. Authoritative spec sources

List every requirements/spec/standard doc the verifier may read. These are the
source of truth; if this contract and a spec doc disagree, the spec wins and that
disagreement is itself a finding.

- `[spec path]` — [which sections]
- `[standard / RFC / domain reference, if any]`

## 3. Public interface (signatures only — interface, not implementation)

Quote the exact exported signatures and the shapes of their inputs/outputs. The
verifier tests against these and imports ONLY these names.

```
[signatures + types]
```

## 4. Behavioral requirements (the WHAT)

Numbered (`R1`, `R2`, …) so tests trace to them. Each must be observable from
inputs/outputs alone. State the requirement, not the algorithm. Include worked
examples that define the semantics exactly.

- **R1** — …
- **R2** — …

## 5. Invariants & properties (hold for ALL valid inputs)

Universal truths the verifier turns into property/metamorphic tests (`INV1`, …).
For any value-moving module, include a **conservation/balance invariant**
(nothing created or destroyed; parts re-sum to the whole).

- **INV1** — …
- **INV2** — …

## 6. Domain edge cases that MUST be handled

The corners real input will hit (empty / single / boundary / duplicates / ties /
extreme & overflow values / Unicode / time-zone / out-of-order / concurrent). The
verifier will add more from domain knowledge (and, if enabled, online research) —
these are the floor, not the ceiling.

- …

## 7. Explicitly OUT of scope / deferred — do NOT report these as bugs

Tell the verifier what NOT to test, citing the decision that defers it.

- …

## 8. Error contract (no silent failures)

How invalid input must be handled (throw? return a typed error? which message
substring?). Define "valid" precisely and require behavior on both sides of each
boundary.

- …

## 9. Security expectations (if §1 touches authn/authz/multi-user/untrusted input)

State the access-control policy in spec terms so the verifier can model it and
attack it (OWASP A01): who may read/write which resource; what requires auth;
what is admin-only; what input is untrusted. e.g. "principal A's resources are
never readable or mutable by principal B via any id/parameter."

- …

## 10. Runtime/behavioral expectations (if §1 is a running app/UI)

The critical user path(s) that must work end-to-end, and observable runtime
guarantees (boots, navigates, persists across reload, no console errors).

- …

## 11. Known oracle hazards (Knight & Leveson note)

Where deriving the "expected" answer is itself tricky and the verifier should
prefer metamorphic/hand-computed oracles — and where a metamorphic relation has a
narrow validity domain (e.g. numerical translation/scale invariance only inside
representable precision).

- …
