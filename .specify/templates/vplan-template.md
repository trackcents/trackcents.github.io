# Verification Plan: [MODULE]

> **The cover-point checklist** (the verification analogue of spec-kit's
> `tasks.md`). Each line is a scenario that MUST be exercised. A cover point
> flips `- [ ]` → `- [x]` when its bin is hit during the EXECUTE run. Because the
> state is a byte on disk, an interrupted/compacted EXECUTE pass resumes by
> re-reading this file and closing the remaining `[ ]` bins — the expensive pass
> becomes resumable. The `CoverageModel` computes closure; the runner reflects
> each closed bin back into the checkbox here.
>
> **Module**: [SRC PATH]   **Risk tier**: [P0|P1|P2|P3]   **Contract**: [CONTRACT PATH]

## Label vocabulary

`[CP]` cover-point · `[R#]`/`[INV#]` traceability to a contract requirement/invariant ·
`[MR]` metamorphic relation (oracle-free) · `[GOLD]` hand-derived golden value ·
`[FUZZ]` fuzz/adversarial · `[SEC]` security · `[E2E]` runtime/behavioral · `[MUT]` mutation/fault-injection.

## Format

`- [ ] V### [LABEL] <concrete scenario / input> — <strategy>`

## Phase V1 — Functional cover-point closure

- [ ] V001 [CP] [empty / zero-size input] — directed
- [ ] V002 [CP] [single element] — directed
- [ ] V003 [CP] [exact threshold / one-below / one-above] — boundary-value analysis
- [ ] V004 [CP] [each equivalence class of the input domain] — equivalence partitioning
- [ ] V005 [CP] [R#] [each behavioral requirement] — directed + scoreboard
- [ ] V006 [CP] [each error path: invalid input MUST fail loudly] — directed

## Phase V2 — Oracle-independent checks (Knight & Leveson mitigation)

- [ ] V010 [MR] [scale / translation / permutation / idempotence — whichever the spec implies] — metamorphic (CHECK MR SOUNDNESS: must hold for a correct impl too; stay inside the relation's validity domain)
- [ ] V011 [GOLD] [hand-derived expected value, arithmetic shown] — directed
- [ ] V012 [INV#] [conservation/balance: nothing created or lost] — REQUIRED for any value-moving / money module

## Phase V3 — Fuzz / adversarial (parsers, ingest, and untrusted input)

- [ ] V020 [FUZZ] malformed / corrupted / adversarial inputs never crash and never emit a silently-wrong result
- [ ] V021 [FUZZ] rerun persisted seed corpus; persist any newly-failing input as a seed

## Phase V4 — Security (cyber-engineer lens; for anything with auth/data-access/untrusted input)

- [ ] V030 [SEC] authorization: a user/tenant cannot read or mutate another's resource (IDOR / horizontal privilege escalation — OWASP A01)
- [ ] V031 [SEC] authentication: protected paths cannot be reached without valid auth (no login bypass; no client-side-only gate)
- [ ] V032 [SEC] no vertical privilege escalation (non-admin cannot reach admin functionality)
- [ ] V033 [SEC] injection / unsafe input handling (SQL/template/command/path traversal) — as applicable
- [ ] V034 [SEC] no secret/credential leakage in outputs, logs, or errors

## Phase V5 — Runtime / behavioral (running apps & UIs)

- [ ] V040 [E2E] the app boots and the critical user path works end-to-end (Playwright/MCP per `verif-kit.config.json`)
- [ ] V041 [E2E] reload / persistence / navigation behave as specified

## Phase V6 — Fault-injection sign-off

- [ ] V050 [MUT] mutation score on the DUT ≥ the risk-tier floor (or survivors individually justified)
- [ ] V051 [MUT] reference-model self-mutation → scoreboard FAILS as expected (bench has teeth)

**Closure rule**: sign-off requires every applicable `[CP]`/`[R#]`/`[INV#]` closed,
the security & runtime lenses applied where relevant, and the mutation gate met.
Lenses that do not apply to this module are struck through with a one-line reason,
not silently dropped.
