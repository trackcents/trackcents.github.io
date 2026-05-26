// End-to-end tests for the Money Tracker drop-zone flow.
//
// Scope of THIS file: the failure-path branches of the import pipeline,
// which we can exercise against committed fixtures.  The committed
// `tests/fixtures/chase-credit-card/sample.pdf` is Chase's *marketing*
// sample PDF, not a real statement — its printed totals don't reconcile,
// so the checksum gate correctly refuses it.  That's the principal
// failure-path we test here.
//
// The green-path (drop a real PDF, see transactions) requires a
// checksum-consistent fixture.  We don't have one committed because:
//   - The user's real PDFs are PII and never committed (see CLAUDE.md).
//   - Synthesizing a fully-consistent PDF requires a pdf-generator
//     dependency we don't want.
// TODO: once an anonymized real fixture passes the checksum gate, add a
// green-path test here.  Until then, the failure-path coverage below is
// what we can honestly assert.

import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bypassOnboarding } from './_seed';

// These tests exercise the statements page directly, so skip the first-run
// onboarding redirect (set a stored salt before the app mounts).
test.beforeEach(async ({ page }) => {
  await bypassOnboarding(page);
});

const CHASE_SAMPLE_PDF = join(
  process.cwd(),
  'tests',
  'fixtures',
  'chase-credit-card',
  'sample.pdf'
);
const THIS_FILE = fileURLToPath(import.meta.url);

test('app boots to the empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Money Tracker/i })).toBeVisible();
  await expect(page.getByText(/No statements imported yet/i)).toBeVisible();
});

test('Chase marketing sample PDF is REFUSED by the checksum gate (known quirk)', async ({
  page
}) => {
  // The Chase official sample PDF has inconsistent printed totals — the
  // checksum equation breaks by $25 — which is precisely the situation
  // the gate exists to refuse.  This test verifies that:
  //   1. Parse and detect succeed (we DO recognize it as Chase CC)
  //   2. The checksum gate REFUSES the import
  //   3. The diff is surfaced to the user explicitly (no silent failure)
  await page.goto('/');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(CHASE_SAMPLE_PDF);

  // The failure banner should appear with a checksum diff message.
  await expect(page.getByText(/Checksum refused/i).first()).toBeVisible({
    timeout: 15_000
  });
  // The diff should mention the dollar amount and direction (high/low).
  await expect(page.getByText(/off by \$.*\b(high|low)\b/).first()).toBeVisible();

  // No statement card should be rendered.
  await expect(page.getByText(/No statements imported yet/i)).toBeVisible();
});

test('non-PDF file is silently filtered out (no error, no state change)', async ({ page }) => {
  await page.goto('/');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(THIS_FILE);

  // Give the page time to process / discard the non-PDF.
  await page.waitForTimeout(500);

  // Still on the empty state.  No error banner.
  await expect(page.getByText(/No statements imported yet/i)).toBeVisible();
  await expect(page.getByText(/Checksum refused/i)).toHaveCount(0);
});
