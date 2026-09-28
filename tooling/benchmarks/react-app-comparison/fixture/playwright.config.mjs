import { defineConfig } from '@playwright/test';

const apps = ['fluo', 'next', 'react-router', 'tanstack-start'];
const port = (index) => 32141 + index;

export default defineConfig({
  testDir: '../tests',
  testMatch: 'apps-browser.spec.mjs',
  outputDir: '../apps/.test-results',
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
  projects: apps.map((name, index) => ({
    name,
    use: { baseURL: `http://127.0.0.1:${port(index)}` },
  })),
  webServer: apps.flatMap((name, index) => (
    process.env.BENCHMARK_ONLY_APP && process.env.BENCHMARK_ONLY_APP !== name ? [] : [{
    command: `pnpm --ignore-workspace --dir apps/${name} start`,
    cwd: new URL('../', import.meta.url).pathname,
    env: { PORT: String(port(index)) },
    url: `http://127.0.0.1:${port(index)}/`,
    reuseExistingServer: Boolean(process.env.BENCHMARK_ONLY_APP),
    timeout: 120_000,
    }]
  )),
});
