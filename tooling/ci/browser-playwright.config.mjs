import { fileURLToPath } from 'node:url';
import ordinary from '../../examples/react-vite-ssr/playwright.config.ts';
import reliability from '../../examples/react-vite-ssr/playwright.reliability.config.ts';

// Preserve the package-local suite, projects, assertions, retries and timeouts.
// Only the web server entry differs; subprocess specs still use server/main.js.
const suite = process.env.FLUO_BROWSER_SUITE;
if (!['ordinary', 'form', 'reliability', 'soak'].includes(suite)) {
  throw new TypeError('browser-preparation: missing FLUO_BROWSER_SUITE');
}
const config = ['reliability', 'soak'].includes(suite) ? reliability : ordinary;
const example = fileURLToPath(new URL('../../examples/react-vite-ssr/', import.meta.url));
export default {
  ...config,
  testDir: `${example}tests`,
  webServer: {
    ...config.webServer,
    cwd: example,
    command: suite === 'ordinary' ? config.webServer.command : 'node dist/form-server/main.js',
  },
};
