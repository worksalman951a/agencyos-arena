import { defineConfig, devices } from '@playwright/test';

/**
 * Local-only Playwright config (NOT committed).
 *
 * The sandbox cannot download Playwright's browser bundle, so a
 * `@sparticuz/chromium` binary plus its bundled NSS libraries are used instead.
 * Everything else mirrors playwright.config.ts: same testDir, same base URL
 * resolution (port 3001), no webServer (the server is started separately).
 */
const APP_URL = process.env.APP_URL ?? 'http://localhost:3001';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: APP_URL,
    trace: 'off',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH ?? '/tmp/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
