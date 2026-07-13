import { defineConfig } from '@playwright/test';

const BROWSER_TEST_PORT = 43_006;

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  outputDir: 'node_modules/.cache/playwright-results',
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${BROWSER_TEST_PORT}`,
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'pnpm start',
    env: {
      REACT_VITE_EXAMPLE_PORT: String(BROWSER_TEST_PORT),
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: `http://127.0.0.1:${BROWSER_TEST_PORT}/assets/entry-client.js`,
  },
  workers: 1,
});
