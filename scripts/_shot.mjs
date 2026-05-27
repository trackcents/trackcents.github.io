// Dev-only visual check using REAL phone emulation (honors <meta viewport>).
import { chromium, devices } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:4173';
const browser = await chromium.launch();

async function ctxPage(init) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  return { ctx, page };
}

// 1) Onboarding currency step (fresh user -> redirected to /onboarding).
{
  const { ctx, page } = await ctxPage();
  await page.goto(BASE + '/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const start = page.getByRole('button', { name: /get started|continue without sync/i });
  if (await start.count()) {
    await start.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: 'reports/shots/onboard-currency.png', fullPage: true });
  await ctx.close();
  console.log('shot -> onboard-currency');
}

// 2) Home in INR + 3) Settings — both with salt + INR pref + demo data.
const initInr = () => {
  try {
    localStorage.setItem('mtrb.salt', 'dGVzdC1zYWx0');
    localStorage.setItem('trackcents.prefs', JSON.stringify({ currency: 'INR' }));
  } catch {
    /* ignore */
  }
};
for (const [name, path] of [
  ['today-inr', '/today'],
  ['settings-currency', '/settings']
]) {
  const { ctx, page } = await ctxPage(initInr);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const btn = page.getByRole('button', { name: /load sample data/i });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(1500);
  }
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `reports/shots/${name}.png`, fullPage: true });
  await ctx.close();
  console.log('shot ->', name);
}
await browser.close();
