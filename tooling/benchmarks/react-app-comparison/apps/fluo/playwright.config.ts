import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests',
  testMatch: 'apps-browser.spec.mjs',
  workers: 1,
  outputDir: './dist/playwright-results',
  use: { baseURL: process.env.BENCHMARK_BASE_URL },
});
