import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: 'node_modules/.cache/playwright-results',
  testDir: './tests',
  timeout: 60_000,
  use: {
    channel: 'chrome',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    headless: true,
  },
  workers: 1,
});
