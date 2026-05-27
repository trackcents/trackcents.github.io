// Reproduce REAL phone behavior (honors the <meta viewport>, unlike a forced
// viewport size) and measure horizontal overflow + which layout is showing.
import { chromium, devices } from '@playwright/test';
const BASE = process.env.SHOT_BASE || 'http://localhost:4173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem('mtrb.salt', 'dGVzdC1zYWx0');
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
for (const path of ['/today', '/transactions']) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1) {
        wide.push({
          tag: el.tagName,
          cls: (el.getAttribute('class') || '').slice(0, 70),
          w: Math.round(r.width)
        });
      }
    });
    wide.sort((a, b) => b.w - a.w);
    const railEl = document.querySelector('.nav-rail');
    const barEl = document.querySelector('.nav-bar');
    const disp = (el) => (el ? getComputedStyle(el).display : 'none');
    return {
      innerWidth: vw,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      viewportMeta: document.querySelector('meta[name=viewport]')?.content || 'MISSING',
      railDisplay: disp(railEl),
      barDisplay: disp(barEl),
      widest: wide.slice(0, 6)
    };
  });
  console.log('\n=== ' + path + ' ===');
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: `reports/shots/real${path.replace(/\W/g, '_')}.png` });
}
await browser.close();
