import { readFileSync } from 'node:fs';

import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import * as runtimeWeb from '@fluojs/runtime/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CloudflareWorkerHttpApplicationAdapter,
  createCloudflareWorkerAdapter,
  type CloudflareWorkerExecutionContext,
  type CloudflareWorkerWebSocket,
  type CloudflareWorkerWebSocketBinding,
  type CloudflareWorkerWebSocketPair,
} from './adapter.js';

const WEBSOCKET_RECONFIGURATION_MESSAGE =
  'Cloudflare Workers websocket binding must be configured before listen() starts accepting Worker requests.';

function createExecutionContext(
  waitUntil: (promise: Promise<unknown>) => void = () => undefined,
): CloudflareWorkerExecutionContext {
  return { waitUntil };
}

function createMockWorkerWebSocket(): CloudflareWorkerWebSocket {
  return {
    accept() {},
    addEventListener() {},
    close() {},
    readyState: 1,
    removeEventListener() {},
    send() {},
  };
}

function createWebSocketPairStub() {
  return vi.fn<() => CloudflareWorkerWebSocketPair>(() => ({
    0: createMockWorkerWebSocket(),
    1: createMockWorkerWebSocket(),
  }));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('@fluojs/platform-cloudflare-workers lifecycle regressions', () => {
  it('keeps public Worker seam declarations on public package barrels while runtime values use internal seams', () => {
    const source = readFileSync(new URL('./adapter.ts', import.meta.url), 'utf8');

    expect(source).toMatch(
      /import \{\s*createFetchStyleHttpAdapterRealtimeCapability,\s*\} from '@fluojs\/http\/internal';/s,
    );
    expect(source).toMatch(
      /import type \{[\s\S]*Dispatcher,[\s\S]*HttpApplicationAdapter,[\s\S]*\} from '@fluojs\/http';/,
    );
    expect(source).not.toMatch(/type Dispatcher,[\s\S]*from '@fluojs\/http\/internal'/);
    expect(source).not.toContain('BootstrapHttpAdapterApplicationOptions');
    expect(source).not.toContain("from '@fluojs/runtime/internal/request-response-factory'");
  });

  it('keeps Worker README lifecycle and public API claims mirrored across English and Korean docs', () => {
    const englishReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const koreanReadme = readFileSync(new URL('../README.ko.md', import.meta.url), 'utf8');
    const sharedPublicSymbols = [
      'CloudflareWorkerHttpApplicationAdapter',
      'CloudflareWorkerHandler',
      'CloudflareWorkerApplication',
      'CloudflareWorkerEntrypoint',
      'CloudflareWorkerWebSocketBinding',
      'CloudflareWorkerWebSocketPair',
      'CloudflareWorkerWebSocketUpgradeResult',
    ];
    const pairedLifecycleClaims = [
      ['executionContext.waitUntil(...)', 'executionContext.waitUntil(...)'],
      ['SSE (`text/event-stream`) response bodies', 'SSE(`text/event-stream`) response body'],
      ['WebSocket upgrades', 'WebSocket upgrade'],
      ['Cloudflare Workers adapter cannot listen while shutdown is still draining.',
        'Cloudflare Workers adapter cannot listen while shutdown is still draining.'],
      ['bounded 10-second drain window', '최대 10초의 bounded drain window'],
      ['JSON `503` shutdown response', 'JSON `503` shutdown response'],
      ['public seam', 'public seam'],
      ['Changesets', 'Changesets'],
    ];

    for (const symbol of sharedPublicSymbols) {
      expect(englishReadme).toContain(symbol);
      expect(koreanReadme).toContain(symbol);
    }

    for (const [englishClaim, koreanClaim] of pairedLifecycleClaims) {
      expect(englishReadme).toContain(englishClaim);
      expect(koreanReadme).toContain(koreanClaim);
    }
  });

  it('rejects Worker websocket binding reconfiguration after the listen boundary even after close', async () => {
    const adapter = new CloudflareWorkerHttpApplicationAdapter({
      createWebSocketPair: createWebSocketPairStub(),
    });
    const initialBinding = {
      fetch: vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async () => new Response(null, { status: 426 })),
    };
    const replacementBinding = {
      fetch: vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async () => new Response(null, { status: 426 })),
    };

    adapter.configureWebSocketBinding(initialBinding);
    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(204);
      },
    });
    await adapter.close();

    expect(() => adapter.configureWebSocketBinding(replacementBinding)).toThrow(
      WEBSOCKET_RECONFIGURATION_MESSAGE,
    );
    expect(() => adapter.configureWebSocketBinding(undefined)).toThrow(WEBSOCKET_RECONFIGURATION_MESSAGE);
    expect(() => adapter.configureWebSocketBinding(initialBinding)).not.toThrow();
  });

  it('releases waitUntil and close drains when an SSE response body is canceled', async () => {
    const adapter = createCloudflareWorkerAdapter();
    const waitUntilPromises: Array<Promise<unknown>> = [];
    let cancelReason: unknown;
    let closeSettled = false;
    const streamingResponse = new Response(new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReason = reason;
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    }), {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });

    vi.spyOn(runtimeWeb, 'dispatchWebRequest').mockResolvedValue(streamingResponse);
    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(200);
      },
    });

    const response = await adapter.fetch(
      new Request('https://worker.test/sse'),
      {},
      createExecutionContext((promise) => { waitUntilPromises.push(promise); }),
    );
    const closePromise = adapter.close().then(() => {
      closeSettled = true;
    });

    if (!response.body) {
      throw new Error('Expected an SSE response body.');
    }

    const reader = response.body.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    expect(closeSettled).toBe(false);

    await reader.cancel('client-disconnected');
    await waitUntilPromises[0];
    await closePromise;

    expect(cancelReason).toBe('client-disconnected');
    expect(closeSettled).toBe(true);
  });

  it('clears fake shutdown timeout handles when the close drain settles before timeout', async () => {
    vi.useFakeTimers();

    const adapter = createCloudflareWorkerAdapter();
    const deferred = createDeferred<void>();

    try {
      await adapter.listen({
        async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
          await deferred.promise;
          response.setStatus(204);
        },
      });

      const responsePromise = adapter.fetch(new Request('https://worker.test/drain'), {}, createExecutionContext());
      await Promise.resolve();
      const closePromise = adapter.close();

      deferred.resolve();

      await responsePromise;
      await closePromise;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      deferred.resolve();
      await adapter.close();
      vi.useRealTimers();
    }
  });

  it('keeps close draining for an in-flight websocket upgrade while concurrent upgrades get shutdown JSON', async () => {
    const createWebSocketPair = createWebSocketPairStub();
    const adapter = new CloudflareWorkerHttpApplicationAdapter({ createWebSocketPair });
    const upgradeDeferred = createDeferred<void>();
    let closeSettled = false;
    const bindingFetch = vi.fn<CloudflareWorkerWebSocketBinding['fetch']>(async (request, host) => {
      const upgraded = host.upgrade(request);
      await upgradeDeferred.promise;
      return upgraded.response;
    });

    adapter.configureWebSocketBinding({ fetch: bindingFetch });
    await adapter.listen({
      async dispatch(_request: FrameworkRequest, response: FrameworkResponse) {
        response.setStatus(200);
      },
    });

    const upgradePromise = adapter.fetch(
      new Request('https://worker.test/chat', { headers: { upgrade: 'websocket' } }),
      {},
      createExecutionContext(),
    );
    await Promise.resolve();

    const closePromise = adapter.close().then(() => {
      closeSettled = true;
    });
    await Promise.resolve();

    const concurrentUpgrade = await adapter.fetch(
      new Request('https://worker.test/chat', { headers: { upgrade: 'websocket' } }),
      {},
      createExecutionContext(),
    );

    expect(concurrentUpgrade.status).toBe(503);
    expect(closeSettled).toBe(false);
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    expect(createWebSocketPair).toHaveBeenCalledTimes(1);

    upgradeDeferred.resolve();

    await expect(upgradePromise).resolves.toHaveProperty('status', 101);
    await closePromise;
    expect(closeSettled).toBe(true);
  });
});
