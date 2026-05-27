// Dev-only visual check using REAL phone emulation (honors <meta viewport>).
// Usage: SHOT_BASE=http://localhost:4173 node scripts/_shot.mjs
import { chromium, devices } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:4173';
const browser = await chromium.launch();

async function shot(name, path, { demo = false } = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
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

await shot('p-today', '/today', { demo: true });
await shot('p-transactions', '/transactions', { demo: true });
await shot('p-trends', '/trends', { demo: true });
await shot('p-statements', '/', { demo: true });
await browser.close();
