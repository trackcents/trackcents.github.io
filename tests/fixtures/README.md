# Golden PDF fixtures

This directory holds anonymized real bank/credit-card statements used as regression test fixtures, per [constitution Principle VIII](../../.specify/memory/constitution.md#viii-one-statement-validation-per-bank).

## Layout

Every supported bank has one subdirectory:

```
tests/fixtures/
└── <bank-slug>/
    ├── sample.pdf       # Anonymized real statement (committed)
    └── expected.json    # The exact ParseResult our adapter must produce
```

The bank slug is a kebab-case identifier matching the adapter name without the `layout-` prefix. Examples:

- `chase/` for Chase Bank parser (`layout-chase` adapter)
- `bofa-checking/` for Bank of America checking (`layout-bofa-checking` adapter)
- `capital-one-credit/` for Capital One credit card (`layout-capital-one-credit` adapter)

## Required: anonymize before committing

PDFs in this directory are real bank statements with sensitive details removed. Before committing a new fixture:

1. **Names** → `ACCOUNT HOLDER` (in headers AND inside transaction descriptions)
2. **Address** → `ADDRESS REDACTED`
3. **Phone / email** → `CONTACT REDACTED`
4. **Account numbers** → keep just last 4 digits, replace the rest with `X`. So `4532-1289-7766-1234` becomes `XXXX-XXXX-XXXX-1234`.
5. **SSN / tax ID** if present → remove entirely.

The fixture must keep all transaction lines, dates, amounts, and printed totals EXACTLY as they appear in the real statement. Anonymization removes identifying details, not financial data.

## Generating expected.json

After dropping a new `sample.pdf` into `<bank-slug>/`, regenerate the expected output:

```powershell
pnpm gen:fixture <bank-slug>
```

This runs the matching adapter against the PDF and writes `expected.json` byte-for-byte. CI then asserts the snapshot never drifts.

If the adapter's output changes intentionally (e.g., new field added), regenerate the fixture and review the diff carefully before committing.

## Checksum gate

For every fixture, the multi-level checksum gate (see [research.md §R13](../../specs/001-money-tracker-mvp/research.md)) MUST pass — at least one of Level A (balance reconciliation), Level B (aggregate totals), or Level C (credit-card balance equation) must validate the parsed transactions against the printed statement. This is enforced as a CI test on every PR per constitution Principle II.
