import { createFetchStyleWebSocketConformanceHarness } from '@fluojs/testing/fetch-style-websocket-conformance';
import { expect, it } from 'vitest';

import { createCloudflareWorkerAdapter } from './adapter.js';

it('reports the supported fetch-style websocket contract through the package conformance harness', () => {
  const harness = createFetchStyleWebSocketConformanceHarness({
    createAdapter: () => createCloudflareWorkerAdapter(),
    expectedReason:
      'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @fluojs/websockets/cloudflare-workers for the official raw websocket binding.',
    expectedSupport: 'supported',
    name: 'cloudflare-workers',
  });

  expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
});
