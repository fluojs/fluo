import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir: 'node_modules/.cache/playwright-results',
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'pnpm start',
    reuseExistingServer: false,
    timeout: 30_000,
    url: 'http://127.0.0.1:3000/assets/entry-client.js',
  },
  workers: 1,
});
