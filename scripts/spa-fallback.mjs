// GitHub Pages SPA fallback.
//
// adapter-static emits build/index.html for the root, but GitHub Pages serves
// its OWN default 404 page for any unknown path (/today, /transactions, a
// refresh, a deep link, the installed PWA's start URL...). That default page
// has no <meta viewport>, so phones render it as a shrunk 980px desktop page —
// the "desktop site in mobile" symptom. Copying the app shell to build/404.html
// makes GitHub serve the real SPA (correct viewport, client-side routing) for
// every path instead.
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'build';
const index = join(dir, 'index.html');
const fallback = join(dir, '404.html');

if (existsSync(index)) {
  copyFileSync(index, fallback);
  console.log('SPA fallback written: build/404.html (copy of index.html)');
} else {
  console.warn('spa-fallback: build/index.html not found — skipped.');
}
