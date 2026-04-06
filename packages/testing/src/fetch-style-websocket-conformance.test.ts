import { describe, expect, it } from 'vitest';

// @ts-ignore Vitest workspace alias resolution handles package test imports.
import { createBunAdapter } from '@konekti/platform-bun';
// @ts-ignore Vitest workspace alias resolution handles package test imports.
import { createCloudflareWorkerAdapter } from '@konekti/platform-cloudflare-workers';
// @ts-ignore Vitest workspace alias resolution handles package test imports.
import { createDenoAdapter } from '@konekti/platform-deno';

import { createFetchStyleWebSocketConformanceHarness } from './fetch-style-websocket-conformance.js';

describe('fetch-style websocket conformance harness', () => {
  it('fails when an adapter does not expose a fetch-style capability', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => ({
        async close() {},
        getRealtimeCapability() {
          return {
            kind: 'unsupported' as const,
            mode: 'no-op' as const,
            reason: 'still no-op',
          };
        },
        async listen() {},
      }),
      expectedReason: 'still no-op',
      name: 'test-double',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).toThrow('must expose a fetch-style realtime capability');
  });
});

describe('official fetch-style runtime websocket contract', () => {
  it('keeps Bun on the shared contract-only websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createBunAdapter(),
      expectedReason:
        'Bun exposes a fetch-style raw websocket expansion contract only. Add a runtime-specific raw websocket host before claiming support.',
      name: 'bun',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('keeps Deno on the shared contract-only websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createDenoAdapter(),
      expectedReason:
        'Deno exposes a fetch-style raw websocket expansion contract only. Add a runtime-specific raw websocket host before claiming support.',
      name: 'deno',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('keeps Cloudflare Workers on the shared contract-only websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createCloudflareWorkerAdapter(),
      expectedReason:
        'Cloudflare Workers exposes a fetch-style raw websocket expansion contract only. Add a Worker-specific raw websocket host before claiming support.',
      name: 'cloudflare-workers',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });
});
