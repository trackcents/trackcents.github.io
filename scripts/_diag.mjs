// Measure horizontal overflow at iPhone-15 logical width, driving from the root
// (which always serves) via client navigation + sample data.
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE || 'http://localhost:4173';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});
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

async function measure(label, navHref) {
  if (navHref) {
    const link = page.locator(`.nav-bar a[href="${navHref}"]`);
    if (await link.count()) {
      await link.first().click();
      await page.waitForTimeout(1000);
    }
  }
  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 0.5 || r.right > vw + 0.5) {
        wide.push({
          tag: el.tagName,
          cls: (el.getAttribute('class') || '').slice(0, 55),
          w: Math.round(r.width),
          right: Math.round(r.right)
        });
      }
    });
    wide.sort((a, b) => b.right - a.right);
    return {
      innerWidth: vw,
      docScrollWidth: document.documentElement.scrollWidth,
      overflowBy: document.documentElement.scrollWidth - vw,
      widest: wide.slice(0, 6)
    };
  });
  console.log('\n=== ' + label + ' ===');
  console.log(JSON.stringify(info, null, 1));
}

await measure('home (/today)', '/today');
await measure('transactions', '/transactions');
await browser.close();
