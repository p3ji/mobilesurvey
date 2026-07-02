import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for mobilesurvey.
 * Runs against the hub (Collector, Searcher, Designer).
 */

// Some sandboxed environments pre-install a Chromium build under a fixed path that doesn't match
// the exact revision @playwright/test expects, and `playwright install` isn't available there.
// Only override when that known path exists, so this is a no-op wherever the pinned browser is
// actually installed (e.g. a normal `playwright install` in CI).
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumLaunchOptions = existsSync(SANDBOX_CHROMIUM)
  ? { executablePath: SANDBOX_CHROMIUM }
  : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5175',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'pnpm --filter @mobilesurvey/hub dev',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunchOptions },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], launchOptions: chromiumLaunchOptions },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
});
