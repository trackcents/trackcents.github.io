// E2E tests covering the user flows that unit tests cannot:
//   - The site OPENS in a browser (not just compiles).
//   - Navigation between routes works.
//   - Pre-seeded state renders in the unified-view table.
//   - Filter chips actually narrow the row count.
//   - Reload preserves state.
//
// These tests prove the running app works — which is what unit tests don't.
// They start a fresh `vite preview` server (port 4173, NOT the user's
// running 5173 dev server) and run against the built bundle.

import { test, expect } from '@playwright/test';
import { seedTwoAccountState, bypassOnboarding } from './_seed';

// All flows here use the app past onboarding (some seed data, some not), so
// suppress the first-run redirect to /onboarding for the whole file.
test.beforeEach(async ({ page }) => {
  await bypassOnboarding(page);
});

test('app boots and the top nav links between Statements and Transactions', async ({ page }) => {
  await page.goto('/');

  // Scope to the top <nav> so we don't match in-body links with same text.
  const nav = page.getByRole('navigation').first();

  await expect(nav.getByRole('link', { name: 'Statements', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Transactions', exact: true })).toBeVisible();

  await nav.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole('heading', { name: /All transactions/i })).toBeVisible();

  await page
    .getByRole('navigation')
    .first()
    .getByRole('link', { name: 'Statements', exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /Money Tracker/i })).toBeVisible();
});

test('/transactions empty state shows "no statements yet" message when no imports', async ({
  page
}) => {
  await page.goto('/transactions');
  // No state seeded → the empty-state message appears with a Back-to-Statements link.
  await expect(page.getByText(/No statements imported yet/i)).toBeVisible();
});

test('/transactions with seeded state renders the unified table with rows from BOTH accounts', async ({
  page
}) => {
  await seedTwoAccountState(page);
  await page.goto('/transactions');

  // The table must show transactions from both Chase Checking and Discover.
  await expect(page.getByRole('heading', { name: /All transactions/i })).toBeVisible();

  // Fixture has 4 Chase + 2 Discover = 6 rows total.  The expand rows are
  // not visible by default, so visible <tr> in tbody == 6.
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(6, { timeout: 5_000 });

  // The matched-count badge in the FilterBar header reads "6 of 6 transactions".
  await expect(page.getByText('6 of 6')).toBeVisible();
});

test('filter chip narrows the table to just the selected account', async ({ page }) => {
  await seedTwoAccountState(page);
  await page.goto('/transactions');

  // Click the Chase Checking chip in the FilterBar.
  await page.getByRole('button', { name: /Chase\s+Checking/ }).click();

  // Now only the 4 Chase rows should be visible.
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(4, { timeout: 5_000 });

  // And the matched-count says "4 of 6 transactions".
  await expect(page.getByText('4 of 6')).toBeVisible();
});

test('search input filters by description text (case-insensitive)', async ({ page }) => {
  await seedTwoAccountState(page);
  await page.goto('/transactions');

  // Type into the search box.
  await page.getByLabel(/Search description/i).fill('amazon');

  // Debounce is 200ms; wait for the row count to settle.
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(1, { timeout: 5_000 });

  // The visible row should be the AMAZON one.
  await expect(rows.first()).toContainText(/AMAZON/i);
});

test('clicking a row expands provenance details inline', async ({ page }) => {
  await seedTwoAccountState(page);
  await page.goto('/transactions');

  // Find the description button on the AMAZON row and click it.
  const amazonRow = page.locator('table tbody tr', { hasText: 'AMAZON MKTPL' }).first();
  await amazonRow.getByRole('button', { name: /AMAZON MKTPL/ }).click();

  // The expanded provenance row should now show parser + PDF hash.
  await expect(page.getByText(/seed-chase-checking-march/)).toBeVisible();
  await expect(page.getByText(/layout-chase-checking/)).toBeVisible();
});

test('reload after seeding preserves the imported statements', async ({ page }) => {
  await seedTwoAccountState(page);
  // Navigate to transactions to confirm rows are loaded.
  await page.goto('/transactions');
  await expect(page.locator('table tbody tr')).toHaveCount(6);

  // Now reload the page and re-verify — persistence survived the reload.
  await page.reload();
  await expect(page.locator('table tbody tr')).toHaveCount(6);
});

test('Statements page (reached via nav) shows the Chase and Discover cards after seeding', async ({
  page
}) => {
  await seedTwoAccountState(page);
  // A full load of `/` with data lands on Home (/today) by design (D5). The
  // Statements/import page stays reachable via the nav link — exercise that path.
  await page.goto('/today');
  await page.getByRole('link', { name: 'Statements' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Both bank-name headings should appear in the statement card list.
  await expect(page.getByRole('heading', { name: /Chase/i }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Discover/i }).first()).toBeVisible();

  // Header summary: "1 bank · 1 credit card · 1 matched" (the Chase->Discover payment matches).
  await expect(page.getByText(/1\s+bank/i)).toBeVisible();
  await expect(page.getByText(/1\s+credit card/i)).toBeVisible();
});
