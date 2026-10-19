import { defineConfig } from '@playwright/test';

const PORT = 4199;

/**
 * Browser end-to-end tests (`npm run e2e`).
 *
 * Playwright builds the web app and starts it together with the API on one
 * port (as in a single-service deployment), on a throwaway in-memory database
 * with a scripted AI — no real data, no AI costs. Locally it drives your
 * installed Google Chrome, so no browser download is needed; in CI it uses
 * Playwright's own Chromium (`npx playwright install chromium`).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.CI ? undefined : 'chrome',
    headless: true,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:shared && npm run build -w @catalogcraft/web && npm run e2e:server -w @catalogcraft/api',
    url: `http://localhost:${PORT}/api/v1/health/ready`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { E2E_PORT: String(PORT) },
    stdout: 'pipe',
  },
});
