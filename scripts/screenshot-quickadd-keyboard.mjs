// Open the live trackcents.github.io site in a mobile Chromium, navigate
// to /today, tap the + tab, focus Description, then SHRINK the viewport
// to simulate the soft-keyboard being open. Take screenshot.
//
// Run: pnpm exec playwright test ... no, this is a standalone script.
//   node scripts/screenshot-quickadd-keyboard.mjs

import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'reports/quickadd-keyboard.png';
mkdirSync('reports', { recursive: true });

const browser = await chromium.launch({ headless: true });
// Pixel-7 sized device but with the same physical width Hemanth uses.
// We then resize the viewport HEIGHT to ~half to mimic the keyboard.
const phone = devices['Pixel 7'];
const context = await browser.newContext({
  ...phone,
  // The visualViewport API tracks this height; the keyboard-inset.ts in
  // our app writes (window.innerHeight - visualViewport.height) to a CSS
  // var. With a real keyboard you'd shrink visualViewport.height; in
  // Playwright we shrink the viewport height directly which has the
  // same effect on layout.
  viewport: { width: phone.viewport.width, height: phone.viewport.height }
});

const page = await context.newPage();

// Bypass onboarding: fake the "already set up" state by writing a salt
// into localStorage BEFORE the page loads.  The layout's isFreshUser
// check is `!hasStoredSalt() && state.imports.length === 0`; setting
// the salt key makes that false so the redirect to /onboarding never
// fires.  Salt value can be any base64-ish string — we never actually
// decrypt anything in this Playwright session.
await context.addInitScript(() => {
  try {
    localStorage.setItem('mtrb.salt', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  } catch {
    /* noop */
  }
});

// Navigate straight to /today?add=expense (the addInitScript above made
// onboarding think we already have a salt set, so it won't redirect).
console.log('Navigating to /today?add=expense...');
await page.goto('https://trackcents.github.io/today?add=expense', {
  waitUntil: 'domcontentloaded'
});
await page.waitForTimeout(3500);
console.log('Landed on:', page.url());

// Wait for the dialog now.
await page.waitForSelector('div[role="dialog"][aria-label*="expense" i]', { timeout: 15000 });

// Simulate the keyboard opening: shrink the visual viewport height.
// Pixel 7 default = 932. Realistic keyboard takes ~460. So we shrink to
// ~470.
const KB_HEIGHT = 460;
const VV_HEIGHT = phone.viewport.height - KB_HEIGHT;
await page.setViewportSize({ width: phone.viewport.width, height: VV_HEIGHT });

// Manually set --kb-inset-bottom in case visualViewport polling hasn't
// fired (Playwright doesn't fire it on viewport resize).
await page.evaluate((kb) => {
  document.documentElement.style.setProperty('--kb-inset-bottom', `${kb}px`);
}, KB_HEIGHT);

// Skip focusing Description — simulating the keyboard via --kb-inset-bottom
// + viewport resize is enough to reproduce the layout shift; we don't need
// an actual focused input.
await page.waitForTimeout(800);

console.log('Capturing screenshot...');
await page.screenshot({ path: OUT, fullPage: false });
console.log('Saved:', OUT);

// Dump every form field's position relative to the visible viewport.
const fields = await page.evaluate(() => {
  function find(sel) {
    return document.querySelector(sel);
  }
  function box(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  }
  // For label-matching, walk the DD-btn list and read the inner .qas-lbl text.
  const ddBtns = [...document.querySelectorAll('.qas-dd-btn')];
  const ddByLabel = {};
  for (const btn of ddBtns) {
    const lbl = btn.querySelector('.qas-lbl');
    if (lbl) ddByLabel[lbl.textContent.trim()] = btn;
  }
  return {
    viewportHeight: window.innerHeight,
    fields: {
      header: box(find('.qas-header')),
      'type-toggle': box(find('.qas-type-toggle')),
      amount: box(find('.qas-amount-row')),
      description: box(find('input[placeholder*="coffee today" i]')),
      category: box(ddByLabel.Category),
      account: box(ddByLabel.Account),
      date: box(find('input[type="date"]')),
      time: box(find('.ti-wrap')),
      notes: box(find('textarea.qas-notes')),
      save: box(find('.qas-save-btn'))
    }
  };
});
console.log('\nViewport:', fields.viewportHeight, 'px');
console.log('Field positions:');
for (const [k, v] of Object.entries(fields.fields)) {
  if (v === null) {
    console.log(`  ${k.padEnd(13)} : NOT FOUND`);
  } else {
    const onScreen = v.bottom <= fields.viewportHeight;
    console.log(
      `  ${k.padEnd(13)} : top=${String(v.top).padStart(4)} bottom=${String(v.bottom).padStart(4)} h=${String(v.height).padStart(3)} ${onScreen ? '✓' : '✗ HIDDEN'}`
    );
  }
}

await browser.close();
