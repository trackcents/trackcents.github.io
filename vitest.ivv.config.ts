// Dedicated Vitest config for the IV&V quarantine suite ONLY.
//
// Lives at repo root (a sibling of vitest.config.ts) ON PURPOSE: the project's
// .svelte-kit/tsconfig.json type-checks `tests/**/*.ts` but NOT root
// `vitest.*.config.ts`, so keeping this here avoids the Vite 5 (bundled by
// Vitest 2.x) vs Vite 6 PluginOption type clash that fires when a config using
// the Svelte plugin is type-checked under exactOptionalPropertyTypes. (Same
// reason vitest.config.ts is split from vite.config.ts.)
//
// The main vitest.config.ts restricts `include` to tests/unit/**, which keeps
// the quarantined IV&V tests out of the Designer's default run. This config
// runs ONLY the IV&V tests, reusing the same Svelte plugin + jsdom env.
//
// Run: pnpm exec vitest run --config vitest.ivv.config.ts
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    include: ['tests/ivv/**/*.{test,spec}.{js,ts}'],
    globals: true,
    environment: 'jsdom'
  }
});
