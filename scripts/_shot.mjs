// Dev-only visual check. Drives from the ROOT (which always serves) via
// client-side navigation, so it works even when a sub-path hard-load 404s.
import { chromium, devices } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:4173';
const browser = await chromium.launch();

// 1) Onboarding currency step: a fresh user at root is client-redirected to
//    /onboarding; on Android there's no iOS install gate -> sign-in step.
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800); // allow client redirect to /onboarding
  const start = page.getByRole('button', { name: /get started|continue without sync/i });
  if (await start.count()) {
    await start.first().click();
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: 'reports/shots/onboard-currency.png', fullPage: true });
  await ctx.close();
  console.log('shot -> onboard-currency');
}

// 2) Home with INR display currency + demo data (navigate via the bottom bar).
{
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mtrb.salt', 'dGVzdC1zYWx0');
      localStorage.setItem('trackcents.prefs', JSON.stringify({ currency: 'INR' }));
    } catch {
      /* ignore */
    }
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const btn = page.getByRole('button', { name: /load sample data/i });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(1500);
  }
  const home = page.locator('.nav-bar a[href="/today"]');
  if (await home.count()) {
    await home.first().click();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: 'reports/shots/today-inr.png', fullPage: true });
  await ctx.close();
  console.log('shot -> today-inr');
}
await browser.close();
