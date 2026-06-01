// Open the live trackcents.github.io site in a mobile Chromium, navigate
// to /today?add=expense, simulate the soft keyboard by shrinking the
// viewport, force the .keyboard-open class and dump every form field's
// position relative to the visible viewport.  Runs across a range of
// real-world phone widths so the layout is tested for every device, not
// just Pixel 7.
//
// Run: node scripts/screenshot-quickadd-keyboard.mjs

import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('reports', { recursive: true });

// Point at a local dev/preview build with BASE_URL=http://localhost:5179 to test
// unshipped changes; defaults to the live site.
const BASE_URL = process.env.BASE_URL ?? 'https://trackcents.github.io';

const browser = await chromium.launch({ headless: true });

/**
 * Each entry: name, viewport, an estimated keyboard height (matched to
 * what Gboard / iOS keyboard takes on that screen size).  Smaller phones
 * have smaller keyboards but also smaller visible areas.
 */
const TARGETS = [
  // The smallest common modern phone — if it fits here, it fits anywhere.
  { name: 'iphone-se', device: devices['iPhone SE'], keyboard: 260 },
  // Mid-range Android, common in India + US.
  { name: 'pixel-5', device: devices['Pixel 5'], keyboard: 360 },
  // Common 2024-era flagship.
  { name: 'pixel-7', device: devices['Pixel 7'], keyboard: 460 },
  // Bigger iPhone.
  { name: 'iphone-14', device: devices['iPhone 14'], keyboard: 380 },
  // Biggest mainstream iPhone (per Hemanth's ask to also cover this).
  { name: 'iphone-14-pro-max', device: devices['iPhone 14 Pro Max'], keyboard: 380 }
];

for (const { name, device, keyboard } of TARGETS) {
  if (!device) {
    console.log(`Skipping ${name}: device not in @playwright/test devices list`);
    continue;
  }
  console.log(
    `\n── ${name} (${device.viewport.width}x${device.viewport.height}, kb=${keyboard}) ──`
  );
  const context = await browser.newContext({ ...device });
  // Bypass onboarding via the salt-injection trick.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('mtrb.salt', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    } catch {
      /* noop — script-injection failures are non-fatal for screenshots */
    }
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/today?add=expense`, {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForTimeout(3000);

  // Wait for the dialog before sizing things.
  try {
    await page.waitForSelector('div[role="dialog"][aria-label*="expense" i]', { timeout: 12000 });
  } catch {
    console.log(`  dialog did not open (URL=${page.url()})`);
    await context.close();
    continue;
  }

  // Shrink the viewport to simulate the keyboard.
  await page.setViewportSize({
    width: device.viewport.width,
    height: device.viewport.height - keyboard
  });
  await page.evaluate(() => {
    // Force the keyboard-open class — Playwright's setViewportSize
    // shrinks both innerHeight and visualViewport.height together, so
    // the in-app delta check returns false.  This forces the same CSS
    // path that fires on a real device.
    const sheet = document.querySelector('.qas-sheet');
    if (sheet) sheet.classList.add('keyboard-open');
  });
  await page.waitForTimeout(600);

  const outPng = `reports/quickadd-keyboard-${name}.png`;
  await page.screenshot({ path: outPng });

  // Per-field positions vs visible viewport.
  const result = await page.evaluate(() => {
    const find = (sel) => document.querySelector(sel);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    const ddByLabel = {};
    for (const btn of document.querySelectorAll('.qas-dd-btn')) {
      const lbl = btn.querySelector('.qas-lbl');
      if (lbl) ddByLabel[lbl.textContent.trim()] = btn;
    }
    const scroll = find('.qas-scroll');
    return {
      viewportHeight: window.innerHeight,
      // The promise: the form body fits ABOVE the keyboard with no scroll.
      scrollOverflowPx: scroll ? scroll.scrollHeight - scroll.clientHeight : null,
      fields: {
        amount: box(find('.qas-amount-row')),
        category: box(ddByLabel.Category),
        account: box(ddByLabel.Account),
        paidfrom: box(find('.qas-paidfrom')),
        date: box(find('input[type="date"]')),
        time: box(find('.ti-wrap')),
        notes: box(find('textarea.qas-notes')),
        // The description box + send live in the pinned dock (always visible).
        description: box(find('.qas-dock-input')),
        send: box(find('.qas-send-btn'))
      }
    };
  });

  console.log(`  Visible viewport: ${result.viewportHeight}px`);
  const ov = result.scrollOverflowPx;
  console.log(
    `  Form fits above keyboard (no scroll): ${ov === null ? 'n/a' : ov <= 1 ? '✓ yes' : `✗ overflows by ${ov}px`}`
  );
  for (const [k, v] of Object.entries(result.fields)) {
    if (v === null) {
      console.log(`    ${k.padEnd(13)} : NOT FOUND`);
      continue;
    }
    const onScreen = v.top >= 0 && v.bottom <= result.viewportHeight && v.height > 0;
    const partial = !onScreen && v.height > 0 && v.top < result.viewportHeight && v.bottom > 0;
    const hidden = v.height === 0;
    const tag = hidden
      ? '⊘ hidden (display:none)'
      : onScreen
        ? '✓'
        : partial
          ? '~partial'
          : '✗ off-screen';
    console.log(
      `    ${k.padEnd(13)} : top=${String(v.top).padStart(4)} bottom=${String(v.bottom).padStart(4)} h=${String(v.height).padStart(3)} ${tag}`
    );
  }
  console.log(`  Screenshot: ${outPng}`);
  await context.close();
}

await browser.close();
