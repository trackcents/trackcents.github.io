// Separate from vite.config.ts because Vitest 2.x bundles Vite 5 types
// internally, but we have Vite 6 installed.  Splitting the configs avoids
// the type-mismatch between PluginOption from different Vite majors.
//
// Vitest still reads vite.config.ts at runtime for plugins (see
// https://vitest.dev/config/#configuration), but the type-checker only
// sees what's in this file.

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // ── Risk-tiered coverage thresholds (per CLAUDE.md verification rules) ──
      //
      // Per-file (not global) so that a high-coverage area can't compensate for
      // a low-coverage P0 module.  A money-handling file dropping below its
      // floor MUST fail CI even if average coverage is still high.
      //
      // RATCHET PATTERN: thresholds are set just BELOW current actuals so any
      // regression fails CI.  When new tests push actuals up, RAISE the floor
      // in the same commit.  Never lower a threshold to make CI green; either
      // add tests or write a justification in the PR description.
      //
      // Adapter and route source coverage IS measured but not gated here —
      // route .svelte files are covered by E2E, and adapter coverage is
      // gated by the synthetic-fixture + env-gated real-PDF tests instead.
      thresholds: {
        perFile: true,
        // ── P0 (money truth) — strictest floor ──
        'src/lib/util/money.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        'src/lib/util/card-payment.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        'src/lib/app/checksum.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        'src/lib/app/transaction-stream.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        'src/lib/app/reconciliation.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        'src/lib/app/payment-drill.ts': {
          lines: 95,
          branches: 65,
          functions: 100,
          statements: 95
        },
        'src/lib/app/transaction-view.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        'src/lib/app/paycheck-detector.ts': {
          lines: 95,
          branches: 85,
          functions: 100,
          statements: 95
        },
        'src/lib/app/budget-window.ts': {
          lines: 95,
          branches: 90,
          functions: 100,
          statements: 95
        },
        // ── P1 (ingestion truth) — bank adapter parsers ──
        // The synthetic fixture tests cover the math; the env-gated
        // real-PDF tests in `*.local-validation.test.ts` cover layout.
        // We measure but only enforce floors where coverage is currently
        // achievable from synthetic fixtures alone.
        'src/lib/adapters/chase-credit-card/adapter.ts': {
          lines: 80,
          branches: 70,
          functions: 90
        },
        'src/lib/adapters/chase-checking/adapter.ts': {
          lines: 80,
          branches: 70,
          functions: 90
        },
        'src/lib/adapters/amex/adapter.ts': { lines: 80, branches: 60, functions: 90 },
        'src/lib/adapters/bofa-credit-card/adapter.ts': {
          lines: 80,
          branches: 70,
          functions: 90
        },
        'src/lib/adapters/discover-credit-card/adapter.ts': {
          lines: 80,
          branches: 70,
          functions: 90
        },
        'src/lib/adapters/robinhood-credit-card/adapter.ts': {
          lines: 80,
          branches: 65,
          functions: 90
        }
      },
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/**/*.spec.ts',
        'src/lib/**/types.ts',
        'src/lib/**/schema-sql.ts',
        'src/lib/db/store.ts',
        'src/lib/app/import.ts',
        'src/lib/app/load-store.ts',
        'src/lib/pdf/**',
        'src/lib/util/date.ts',
        'src/lib/util/hash.ts',
        'src/lib/util/ulid.ts',
        'src/lib/util/anonymize.ts',
        'src/lib/adapters/index.ts',
        'src/lib/adapters/detector.ts',
        'src/lib/adapters/_layout/**'
      ]
    }
  }
});
