// Dev-only visual check: screenshot key screens at phone + desktop sizes.
// Usage: node scripts/_shot.mjs   (dev server must be running on :5173)
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:5173';
const browser = await chromium.launch();

async function shot(name, w, h, path = '/today', opener) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // Bypass the first-run onboarding redirect so the app shell renders.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mtrb.salt', 'dGVzdC1zYWx0');
    } catch {
      /* ignore */
    }
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (opener) await opener(page);
  await page.screenshot({ path: `reports/shots/${name}.png` });
  await ctx.close();
  console.log('shot ->', name);
}

await shot('today-desktop', 1440, 900);
await shot('today-mobile', 390, 844);
await shot('more-mobile', 390, 844, '/today', async (p) => {
  await p.getByRole('button', { name: 'More' }).click();
  await p.waitForTimeout(350);
});
await browser.close();
