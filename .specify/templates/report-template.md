# Verification report template

> The final report the verifier prints (and saves to the reports dir). Output is
> the headline deliverable: a human reading this in 30 seconds must know WHAT was
> tested, WHAT was found, and whether to trust the module. Lead with the verdict,
> use the diagram + tables, keep prose to a plain-English bottom line. Write like a
> sharp engineer briefing a teammate — NOT a robotic textbook dump. Fill every
> `<...>`. Strike through (with a one-line reason) any row that doesn't apply.

---

## `<MODULE>` — verification report  ·  `<DATE>`

**VERDICT: `<✅ SIGNED OFF | ⚠️ DISCREPANCIES FOUND | ⛔ NOT SIGNED OFF>`**
`<one sentence: the headline, e.g. "Conforms to spec on all 320 checks; 100% coverage closure, 92% mutation." or "1 P0 access-control bypass — do not ship.">`

**Effort sizing:** `<tier + why, e.g. "P0 money module → full environment, ~6 min" or "trivial pure fn → 8 directed + 2 properties, ~1 min, mutation skipped on purpose">`

### Verification environment (block diagram)

```
            ┌─────────────────────────────────────────────────────────┐
            │  constrained-random + directed STIMULUS  (generator)     │
            └───────────────┬───────────────────────┬─────────────────┘
                            │                       │
                            ▼                       ▼
                   ┌──────────────┐        ┌──────────────────────┐
                   │   DUT (SUT)  │        │  reference model     │
                   │  (blind)     │        │  (independent,       │
                   └──────┬───────┘        │   from spec only)    │
                          │                └──────────┬───────────┘
                          ▼                           ▼
                   ┌──────────────────  SCOREBOARD  ──────────────────┐
                   │  compare every output → mismatches               │
                   └──────────────────────┬───────────────────────────┘
                                          ▼
        assertions/invariants  ·  functional-coverage model  ·  mutation/fault-injection
```
`<adjust the diagram to the lenses actually used — drop reference model/scoreboard if you used only oracle-free checks; add SECURITY (two-principal) or RUNTIME (Playwright) boxes when those lenses ran>`

### What I tested

| Lens | What | # cases | Result |
|---|---|---|---|
| Conformance (R1–Rn) | `<each behavioral requirement>` | `<n>` | ✅ / ❌ |
| Boundary / equivalence | `<empty, min, max, off-by-one, …>` | `<n>` | ✅ / ❌ |
| Metamorphic (oracle-free) | `<scale / translation / permutation / conservation>` | `<n>` | ✅ / ❌ |
| Scoreboard vs reference model | `<random inputs>` | `<n>` | ✅ / ❌ |
| Fuzz / malformed input | `<parsers only>` | `<n>` | ✅ / ❌ / n/a |
| Security (OWASP A01) | `<two-principal IDOR / auth / privilege>` | `<n>` | ✅ / ❌ / n/a |
| Runtime / E2E | `<critical route via Playwright>` | `<n>` | ✅ / ❌ / n/a |
| Mutation / fault-injection | `<DUT mutants + self-mutation>` | `<score>` | ✅ / ❌ / n/a |

**Functional coverage:** `<x%>` closure (`<hit>/<total>` cover points; holes: `<none|list>`).

### What I found

| # | Finding | Severity | Where (spec / input) | Status |
|---|---|---|---|---|
| D1 | `<one-line>` | `<P0 / P1 / P2>` | `<spec §+loc; minimal input>` | `<fixed / open / escalated / spec-ambiguous>` |
| — | `<"no discrepancies" if clean>` | — | — | — |

### Bottom line (plain English)

`<2–3 sentences a non-expert understands: is it correct, what's the one thing to
know, what (if anything) to do next. No jargon dumps.>`

### Honest residual (what this did NOT cover)

- `<shared-spec blind spot (Knight & Leveson) + how mitigated>`
- `<lenses not applicable / not run, and why>`
- `<anything the contract left underspecified>`
