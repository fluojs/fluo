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
        'Bun uses Bun.serve() with server.upgrade() for websocket handling, which is incompatible with the Node upgrade-listener model required by @konekti/websocket/node. A dedicated @konekti/websocket/bun binding is needed before raw websocket support can be claimed.',
      name: 'bun',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('keeps Deno on the shared contract-only websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createDenoAdapter(),
      expectedReason:
        'Deno uses Deno.upgradeWebSocket() for websocket handling, which is incompatible with the Node upgrade-listener model required by @konekti/websocket/node. A dedicated @konekti/websocket/deno binding is needed before raw websocket support can be claimed.',
      name: 'deno',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });

  it('keeps Cloudflare Workers on the shared contract-only websocket expansion seam', () => {
    const harness = createFetchStyleWebSocketConformanceHarness({
      createAdapter: () => createCloudflareWorkerAdapter(),
      expectedReason:
        'Cloudflare Workers uses WebSocketPair (often paired with Durable Objects) for websocket handling, which is incompatible with the Node upgrade-listener model required by @konekti/websocket/node. A dedicated @konekti/websocket/cloudflare-workers binding is needed before raw websocket support can be claimed.',
      name: 'cloudflare-workers',
    });

    expect(() => harness.assertExposesRawWebSocketExpansionContract()).not.toThrow();
  });
});
