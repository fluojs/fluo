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
  it('keeps Bun on the shared supported websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createBunAdapter(),
      expectedSupport: 'supported',
      expectedReason:
        'Bun exposes Bun.serve() + server.upgrade() request-upgrade hosting. Use @konekti/websocket/bun for the official raw websocket binding.',
      name: 'bun',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('keeps Deno on the shared supported websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createDenoAdapter(),
      expectedSupport: 'supported',
      expectedReason:
        'Deno exposes Deno.upgradeWebSocket(request) request-upgrade hosting. Use @konekti/websocket/deno for the official raw websocket binding.',
      name: 'deno',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('keeps Cloudflare Workers on the shared supported websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createCloudflareWorkerAdapter(),
      expectedSupport: 'supported',
      expectedReason:
        'Cloudflare Workers exposes WebSocketPair isolate-local request-upgrade hosting. Use @konekti/websocket/cloudflare-workers for the official raw websocket binding.',
      name: 'cloudflare-workers',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });
});
