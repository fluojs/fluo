import suite from '../../fixture/playwright.config.mjs'

// Run the shared browser contract against an already running production app.
export default {
  ...suite,
  testDir: '../../tests',
  outputDir: '.test-results',
  projects: [{
    name: 'tanstack-start',
    use: { baseURL: process.env.BENCHMARK_BASE_URL ?? 'http://127.0.0.1:43813' },
  }],
  webServer: [],
}
