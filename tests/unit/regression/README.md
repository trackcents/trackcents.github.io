# Regression scenarios

One test file per bug we have ever caught and fixed. The point is **not** to test the code at the unit level — that's already covered elsewhere. The point is to **lock down the SPECIFIC scenario that produced the bug** so it cannot return.

## Naming convention

`bug-<YYYY-MM-DD>-<short-symptom>.test.ts`

The date is when the bug was discovered (not fixed). The short-symptom is grep-able after a year of accumulated bugs.

## What goes in each file

1. **A header comment** explaining the bug in plain English: what the user observed, what was wrong, where in the code it lived, what the root cause was, what the fix was.
2. **The minimum test that REPRODUCES the bug on un-fixed code**. If you reverted the fix today, this test must fail.
3. **The assertion that the fix HOLDS**. This may be one test or several.
4. **Coverage of any adjacent cases the bug class implies.** If the bug was "X under condition Y," tests should cover X under nearby conditions Y' and Y'' too.

## Workflow

When a bug is found in the wild:

1. Reproduce it in a failing test in this directory FIRST.
2. Fix the code.
3. Verify the test now passes.
4. The test stays forever as a regression guard.

When adding a new adapter, refactoring the FIFO engine, or touching a P0 module, the whole `tests/unit/regression/` directory runs automatically (it's part of `pnpm verify`). Any test that fails means a fix is being undone.

## Why this exists

The kinds of bugs that land here historically escaped because:

- Unit tests passed on the new code in isolation, but adding the new code broke OTHER, already-passing code (integration boundary).
- Synthetic test fixtures didn't mirror the real-world data they were supposed to represent (fixture realism).
- A subtle simplification in a model produced wrong answers on a real-world edge case the model author hadn't thought to test (model gap).

Regression scenarios add a layer that catches the SAME bug on its second appearance, even if the unit-test layer still misses it.

## Index of current regressions

| File                                                       | Bug                                                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bug-2026-05-23-chase-multi-adapter.test.ts`               | Chase Checking PDF rejected after BofA/Discover adapters added — multiple adapters' detect() matched the same statement                            |
| `bug-2026-05-23-bofa-account-summary.test.ts`              | BofA April/May real PDFs failed checksum — adapter passed synthetic fixture because the anonymizer collapsed cells; real PDF has split-cell layout |
| `bug-2026-05-23-payment-drill-fifo-stream.test.ts`         | $351.27 Discover payment drill showed wrong purchases — drill mapped to receiving statement instead of FIFO walking the card's transaction stream  |
| `bug-2026-05-23-robinhood-card-payment-descriptor.test.ts` | Robinhood detect() matched the substring "Robinhood Card" in a Chase Checking transaction descriptor — would false-positive Chase PDFs             |
