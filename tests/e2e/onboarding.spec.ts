// Regression coverage for the first-run onboarding gate (US-P1-A).
//
// This is the test that was MISSING — the app shipped with no redirect from the
// landing page to /onboarding, so a brand-new user never saw the Google sign-in
// or passphrase setup. These tests assert the gate now works, and that an
// already-set-up / data-bearing user is NOT bounced through onboarding.

import { test, expect } from '@playwright/test';
import { seedTwoAccountState, bypassOnboarding } from './_seed';

test('a brand-new user landing on / is routed to onboarding and sees Google sign-in', async ({
  page
}) => {
  // Fresh context: no stored salt, no data → first-run user.
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('button', { name: /sign in with google/i }).first()).toBeVisible();
  // Onboarding must also offer the local-only path.
  await expect(page.getByText(/Continue without sync/i)).toBeVisible();
});

test('a fresh user hitting a deep route (/transactions) is also sent to onboarding first', async ({
  page
}) => {
  await page.goto('/transactions');
  await expect(page).toHaveURL(/\/onboarding/);
});

test('an already-onboarded user (stored salt) is NOT redirected', async ({ page }) => {
  await bypassOnboarding(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/No statements imported yet/i)).toBeVisible();
});

test('a returning user WITH data lands on Home (/today), never onboarding', async ({ page }) => {
  await seedTwoAccountState(page); // writes imports, no salt
  await page.goto('/');
  // Not sent to onboarding (data suppresses the first-run gate); Home is the
  // default landing for a returning user with data (D5).
  await expect(page).toHaveURL(/\/today$/);
  await expect(page).not.toHaveURL(/onboarding/);
  await expect(page.getByText(/Your month at a glance\./i)).toBeVisible();
});
