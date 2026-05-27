// Dev-only visual check: screenshot key screens at phone + desktop sizes.
// Usage: node scripts/_shot.mjs   (dev server must be running on :5173)
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:5173';
const browser = await chromium.launch();

async function shot(name, w, h, path = '/today', { demo = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mtrb.salt', 'dGVzdC1zYWx0');
    } catch {
      /* ignore */
    }
  });
  if (demo) {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /load sample data/i });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForTimeout(1500);
    }
  }
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `reports/shots/${name}.png`, fullPage: true });
  await ctx.close();
  console.log('shot ->', name);
}

await shot('m-today', 390, 844, '/today', { demo: true });
await shot('m-transactions', 390, 844, '/transactions', { demo: true });
await shot('d-transactions', 1440, 900, '/transactions', { demo: true });
await browser.close();
