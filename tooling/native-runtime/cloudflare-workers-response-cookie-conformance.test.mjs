import { test } from 'node:test';

import {
  runConcurrentWorkers,
  runWithWorker,
  startWorker,
} from './cloudflare-workers-response-cookie-conformance-harness.mjs';
import { expectedResponseCookies } from './response-cookie-conformance.mjs';

async function assertWorkerResponseCookieConformance() {
  await runWithWorker(startWorker(), async ({ url }) => {
    const response = await fetch(url);
    const actual = await response.json();
    const responseCookies = response.headers.getSetCookie();

    if (response.status !== 200) {
      throw new Error(`workerd returned HTTP ${response.status}`);
    }
    if (JSON.stringify(responseCookies) !== JSON.stringify(expectedResponseCookies)) {
      throw new Error(
        `workerd returned Set-Cookie headers ${JSON.stringify(responseCookies)}, expected ${JSON.stringify(expectedResponseCookies)}`,
      );
    }
    if (JSON.stringify(actual) !== JSON.stringify(expectedResponseCookies)) {
      throw new Error(`workerd returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expectedResponseCookies)}`);
    }
  });
}

test('workerd preserves ordered independent Set-Cookie fields for repeated setCookie and clearCookie calls', async () => {
  await assertWorkerResponseCookieConformance();
});

test('workerd isolates concurrent response-cookie conformance workers', async () => {
  await runConcurrentWorkers([
    () => assertWorkerResponseCookieConformance(),
    () => assertWorkerResponseCookieConformance(),
  ]);
});
