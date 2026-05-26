// Shared helper for E2E tests that need pre-seeded persisted state.
//
// We can't drop a real PDF in the test (no checksum-passing committed
// fixture; real PDFs are PII).  Instead we use Playwright's page.evaluate()
// to call the store's saveState() with synthetic ImportSuccess data BEFORE
// navigating.  This exercises the real persistence + render path, only
// skipping PDF parsing.
//
// Each test that uses seedState() gets an isolated browser context, so
// state doesn't leak between tests.

import type { Page } from '@playwright/test';

/**
 * Mark onboarding as already completed so the first-run redirect to /onboarding
 * does NOT fire. Sets a stored salt before any app script runs (addInitScript),
 * which is what `hasStoredSalt()` checks. Use in tests that exercise the
 * statements/transactions pages directly without going through onboarding.
 * (Tests that seed data don't strictly need this — data alone suppresses the
 * redirect — but it's harmless and makes intent explicit.)
 */
export async function bypassOnboarding(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('mtrb.salt', 'dGVzdC1zYWx0LW5vdC1zZWNyZXQ='); // dummy base64; never used to decrypt plaintext seed data
  });
}

/** Seed the app with two synthetic statements (Chase Checking + Discover CC). */
export async function seedTwoAccountState(page: Page): Promise<void> {
  // Must navigate to the origin first so localStorage/OPFS are addressable.
  await page.goto('/');

  await page.evaluate(() => {
    // Build a synthetic PersistedState directly in the page context, then
    // write it via the production store API.  We import the store module
    // dynamically because Playwright's evaluate runs in the page; the module
    // has to already be loadable from a route.  Easiest path: write the JSON
    // blob to localStorage in the exact format the store deserializes.
    //
    // BIGINT note: our store uses a __bigint__: prefix to round-trip bigints
    // through JSON.  We must use the same convention here.
    const state = {
      version: 1,
      imports: [
        {
          bank_name: 'Chase',
          adapter_name: 'layout-chase-checking',
          adapter_version: '0.2.0',
          pdf_source_hash: 'seed-chase-checking-march',
          imported_at: '2026-05-23T10:00:00.000Z',
          statement: {
            account_type: 'checking',
            account_last_4: '9535',
            period_start: '2026-02-26',
            period_end: '2026-03-24',
            currency: 'USD',
            opening_balance_minor: null,
            closing_balance_minor: null,
            total_debits_minor: null,
            total_credits_minor: null,
            previous_balance_minor: null,
            statement_balance_minor: null,
            printed_transaction_count: 4,
            summary_lines: [],
            payment_due_date: null,
            statement_date: '2026-03-24',
            minimum_payment_due_minor: null,
            parser_provides: ['A']
          },
          transactions: [
            {
              posted_date: '2026-03-01',
              description: 'PAYROLL - ACME CORP',
              raw_text: 'PAYROLL - ACME CORP',
              amount_minor: '__bigint__:320000',
              currency: 'USD',
              transaction_type: 'deposit'
            },
            {
              posted_date: '2026-03-03',
              description: 'Discover E-Payment 3562 Web ID: 2510020270',
              raw_text: 'Discover E-Payment 3562',
              amount_minor: '__bigint__:-15000',
              currency: 'USD',
              transaction_type: 'payment_to_card'
            },
            {
              posted_date: '2026-03-10',
              description: 'AMAZON MKTPL',
              raw_text: 'AMAZON MKTPL',
              amount_minor: '__bigint__:-5000',
              currency: 'USD',
              transaction_type: 'purchase'
            },
            {
              posted_date: '2026-03-15',
              description: 'WHOLE FOODS AUSTIN TX',
              raw_text: 'WHOLE FOODS AUSTIN TX',
              amount_minor: '__bigint__:-7500',
              currency: 'USD',
              transaction_type: 'purchase'
            }
          ],
          checksum_strategy_used: 'A'
        },
        {
          bank_name: 'Discover',
          adapter_name: 'layout-discover-credit-card',
          adapter_version: '0.1.0',
          pdf_source_hash: 'seed-discover-march',
          imported_at: '2026-05-23T10:01:00.000Z',
          statement: {
            account_type: 'credit_card',
            account_last_4: '3562',
            period_start: '2026-02-24',
            period_end: '2026-03-23',
            currency: 'USD',
            opening_balance_minor: null,
            closing_balance_minor: null,
            total_debits_minor: null,
            total_credits_minor: null,
            previous_balance_minor: '__bigint__:15000',
            statement_balance_minor: '__bigint__:0',
            printed_transaction_count: 2,
            summary_lines: [],
            payment_due_date: null,
            statement_date: '2026-03-23',
            minimum_payment_due_minor: null,
            parser_provides: ['C']
          },
          transactions: [
            {
              posted_date: '2026-03-03',
              description: 'INTERNET PAYMENT - THANK YOU',
              raw_text: 'INTERNET PAYMENT',
              amount_minor: '__bigint__:15000',
              currency: 'USD',
              transaction_type: 'payment_to_card'
            },
            {
              posted_date: '2026-03-10',
              description: 'GOOGLE *YOUTUBE PREMIUM',
              raw_text: 'GOOGLE *YOUTUBE PREMIUM',
              amount_minor: '__bigint__:-1399',
              currency: 'USD',
              transaction_type: 'purchase'
            }
          ],
          checksum_strategy_used: 'C'
        }
      ],
      reconciliation_links: []
    };
    // The store writes its bigint-tagged JSON under this key when OPFS is unavailable.
    // In Playwright Chromium OPFS IS available, but the store reads from
    // localStorage as a fallback BEFORE attempting OPFS (see store.ts).
    // We populate localStorage so any backend path finds it.
    window.localStorage.setItem('money-tracker:state', JSON.stringify(state));
  });

  // Now navigate again so the app reads the seeded state on mount.
  await page.goto('/');
}
