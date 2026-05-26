import { defineConfig, devices } from '@playwright/test';

// E2E tests use port 4173 (production preview) instead of 5173 (dev) so
// they don't fight the user's running `pnpm dev` server.  `vite preview`
// serves the built bundle, which is closer to what users actually run AND
// avoids dev-server HMR overlays that can mask test failures.
const E2E_PORT = process.env.E2E_PORT ? parseInt(process.env.E2E_PORT, 10) : 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],
  webServer: {
    command: `pnpm build && pnpm exec vite preview --port ${E2E_PORT} --strictPort`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000
  }
});
