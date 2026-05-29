// End-to-end demo of the sub-category flow:
//   1. Open QuickAddSheet (via ?add=expense)
//   2. Open Category picker
//   3. Capture the "subcat hint" footer in the picker
//   4. Enter Edit mode → tap + next to a parent → type a sub name → submit
//   5. Exit Edit mode
//   6. Verify the sub appears indented under its parent
//   7. Tap the sub → picker closes
//   8. Verify the Category button on the form shows "Parent · Sub"
//
// Screenshots are saved per step so we can sanity-check the UX.

import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports', { recursive: true });

const browser = await chromium.launch({ headless: true });
const device = devices['Pixel 7'];
const context = await browser.newContext({ ...device });
await context.addInitScript(() => {
  try {
    localStorage.setItem('mtrb.salt', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  } catch {
    /* noop */
  }
});
const page = await context.newPage();

console.log('1. Opening QuickAddSheet...');
await page.goto('https://trackcents.github.io/today?add=expense', {
  waitUntil: 'domcontentloaded'
});
await page.waitForTimeout(3000);
await page.waitForSelector('div[role="dialog"][aria-label*="expense" i]', { timeout: 12000 });
await page.screenshot({ path: 'reports/sub-1-form.png' });

console.log('2. Opening Category picker...');
await page.click('button:has(.qas-lbl:has-text("Category"))');
await page.waitForSelector('div[role="dialog"][aria-label*="Pick a category" i]', {
  timeout: 8000
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'reports/sub-2-picker-with-hint.png' });

console.log('3. Tapping Edit...');
await page.click('button.edit-toggle');
await page.waitForTimeout(400);

// Find the Food parent row, click its + button.  Use waitForFunction so we
// don't fall over when Food isn't the first row.
console.log('4. Adding "Biryani" under Food...');
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.row')];
  for (const row of rows) {
    const name = row.querySelector('.name')?.textContent?.trim();
    if (name === 'Food') {
      const addsub = row.querySelector('.addsub');
      if (addsub) addsub.click();
      break;
    }
  }
});
await page.waitForTimeout(400);
await page.fill('.addsub-input', 'Biryani');
await page.click('.addsub-save');
await page.waitForTimeout(800);
await page.screenshot({ path: 'reports/sub-3-after-create.png' });

console.log('5. Exiting Edit mode...');
await page.click('button.edit-toggle');
await page.waitForTimeout(400);
await page.screenshot({ path: 'reports/sub-4-picker-with-biryani.png' });

console.log('6. Tapping Biryani sub...');
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.row')];
  for (const row of rows) {
    const name = row.querySelector('.name')?.textContent?.trim();
    if (name === 'Biryani') {
      row.querySelector('.row-main')?.click();
      break;
    }
  }
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'reports/sub-5-form-with-sub.png' });

// Verify the Category button text shows "Food · Biryani".
const buttonText = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.qas-dd-btn')];
  for (const b of btns) {
    const lbl = b.querySelector('.qas-lbl');
    if (lbl?.textContent?.trim() === 'Category') {
      return b.querySelector('.qas-dd-value')?.textContent?.trim() ?? '';
    }
  }
  return '';
});
console.log(`\nCategory button shows: "${buttonText}"`);
if (buttonText.includes('Food') && buttonText.includes('Biryani')) {
  console.log('✓ Sub-category picked and parent · sub displayed correctly.');
} else {
  console.log('✗ Expected "Food · Biryani", got something else.');
}

await browser.close();
