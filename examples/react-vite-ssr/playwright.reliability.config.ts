import { defineConfig } from '@playwright/test';

const port = Number(process.env.REACT_VITE_EXAMPLE_TEST_PORT ?? 0);
const soak = process.env.FLUO_RELIABILITY_SOAK === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: soak ? 'long-session-soak.spec.ts' : [
    'long-session.spec.ts', 'long-session-ownership.spec.ts', 'long-session-cache.spec.ts',
    'background-interactions.spec.ts', 'session-transition.spec.ts',
    'product-acceptance.spec.ts', 'product-faults.spec.ts',
  ],
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: process.env.FLUO_RELIABILITY_OUTPUT ?? 'node_modules/.cache/react-reliability',
  reporter: [['list'], ['json', { outputFile: process.env.FLUO_RELIABILITY_REPORT
    ?? 'node_modules/.cache/react-reliability-report.json' }]],
  use: { baseURL: port === 0 ? undefined : `http://127.0.0.1:${port}`, headless: true, actionTimeout: 10_000, navigationTimeout: 10_000 },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--disable-gpu'] } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm start',
    env: { REACT_VITE_EXAMPLE_PORT: String(port), REACT_VITE_EXAMPLE_TEST_READY: '1' },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    ...(port === 0
      ? { wait: { stdout: /REACT_VITE_EXAMPLE_READY (?<playwright_test_base_url>http:\/\/127\.0\.0\.1:[1-9]\d*)/u } }
      : { url: `http://127.0.0.1:${port}/catalog/background` }),
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
