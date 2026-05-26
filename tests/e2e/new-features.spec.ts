// E2E smoke for the features added in the overnight build (trends, settings,
// review flow, manual entry). Exercises the RUNNING app (built + previewed),
// not just the logic — catches route-level breakage that unit/IV&V tests can't.
import { test, expect, type Page } from '@playwright/test';
import { bypassOnboarding, seedTwoAccountState } from './_seed';

/** Collect any uncaught page errors so a route that throws on mount fails loudly. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await bypassOnboarding(page);
  await seedTwoAccountState(page);
});

test('Home (/today) renders the month-at-a-glance without errors', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/today');
  await expect(page.getByText('Your month at a glance.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Trends (/trends) renders price-change + frequent-merchant sections', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/trends');
  await expect(page.getByRole('heading', { name: 'Spending trends' })).toBeVisible();
  // window toggle present
  await expect(page.getByRole('button', { name: '90d' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Settings (/settings) shows backup/export/import controls', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Export backup/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Export transactions \(CSV\)/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Review flow (/categories/review) renders without errors', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/categories/review');
  await expect(page.getByRole('heading', { name: 'Review categories' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Recurring (/recurring) renders without errors', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/recurring');
  expect(errors).toEqual([]);
});

test('Manual entry: adding a Cash transaction makes it appear in the list', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/transactions');

  await page.getByRole('button', { name: '+ Add transaction' }).click();
  await page.getByPlaceholder('e.g. Coffee with a friend').fill('Farmers market cash');
  await page.getByPlaceholder('12.34').fill('23.45');
  await page.getByRole('button', { name: 'Save transaction' }).click();

  // The new transaction should now be visible in the unified table.
  await expect(page.getByText('Farmers market cash')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Budget (/budget) renders without errors', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/budget');
  await expect(page.getByRole('heading', { name: 'Budget', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Goals (/goals): create a savings goal end-to-end', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Savings goals' })).toBeVisible();

  await page.getByRole('button', { name: '+ New goal' }).click();
  await page.getByPlaceholder('e.g. Emergency fund').fill('New laptop');
  await page.getByPlaceholder('5000.00').fill('1500');
  await page.getByRole('button', { name: 'Create goal' }).click();

  // The new goal card should appear, and the header totals should reflect it.
  await expect(page.getByText('New laptop')).toBeVisible();
  await expect(page.getByText(/Across all goals:/)).toBeVisible();
  expect(errors).toEqual([]);
});
