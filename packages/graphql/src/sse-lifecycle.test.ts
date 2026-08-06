import { Server } from 'node:http';

import { Inject, Scope } from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { createNodeHttpAdapter } from '@fluojs/runtime/node';
import { describe, expect, it, vi } from 'vitest';

import { Resolver, Subscription } from './decorators.js';
import { GraphqlModule } from './module.js';
import type { GraphQLContext } from './types.js';

describe('GraphQL SSE lifecycle', () => {
  it('finalizes the AsyncIterable and destroys its request scope once when the client aborts', async () => {
    // Given
    let iteratorFinalizations = 0;
    let providerTeardowns = 0;
    let requestAbortObserved = false;
    const expectExactlyOnceAbortLifecycle = (): void => {
      expect(requestAbortObserved).toBe(true);
      expect(iteratorFinalizations).toBe(1);
      expect(providerTeardowns).toBe(1);
    };
    let releaseResolver: (() => void) | undefined;
    const resolverRelease = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });

    @Inject()
    @Scope('request')
    class SseRequestLifecycleProbe {
      onDestroy(): void {
        providerTeardowns += 1;
      }
    }

    @Inject(SseRequestLifecycleProbe)
    @Scope('request')
    @Resolver('SseAbortLifecycleResolver')
    class SseAbortLifecycleResolver {
      constructor(probe: SseRequestLifecycleProbe) {
        void probe;
      }

      @Subscription()
      async *blockingEvents(_input: undefined, context: GraphQLContext): AsyncGenerator<string, void, void> {
        const requestSignal = context.request.signal;

        if (!requestSignal) {
          throw new Error('Expected the Node HTTP request to expose an abort signal.');
        }

        const clientAbort = new Promise<void>((resolve) => {
          if (requestSignal.aborted) {
            requestAbortObserved = true;
            resolve();
            return;
          }

          requestSignal.addEventListener('abort', () => {
            requestAbortObserved = true;
            resolve();
          }, { once: true });
        });

        try {
          yield 'connected';
          await Promise.race([clientAbort, resolverRelease]);
        } finally {
          iteratorFinalizations += 1;
        }
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        GraphqlModule.forRoot({
          resolvers: [SseAbortLifecycleResolver],
        }),
      ],
      providers: [SseRequestLifecycleProbe, SseAbortLifecycleResolver],
    });

    const adapter = createNodeHttpAdapter({ port: 0, shutdownTimeoutMs: 100 });
    const app = await FluoFactory.create(AppModule, { adapter });

    try {
      await app.listen();

      const server = adapter.getServer?.();

      if (!(server instanceof Server)) {
        throw new Error('Expected the Node HTTP adapter to expose its server.');
      }

      const address = server.address();

      if (!address || typeof address === 'string') {
        throw new Error('Expected the Node HTTP adapter to expose its assigned port.');
      }

      const clientController = new AbortController();
      const response = await fetch(
        `http://127.0.0.1:${String(address.port)}/graphql?query=${encodeURIComponent('subscription { blockingEvents }')}`,
        {
          headers: {
            accept: 'text/event-stream',
          },
          method: 'GET',
          signal: clientController.signal,
        },
      );
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Expected the SSE response body to expose a reader.');
      }

      const firstChunk = await reader.read();

      if (firstChunk.done) {
        throw new Error('Expected the SSE subscription to remain open after its first event.');
      }

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(new TextDecoder().decode(firstChunk.value)).toContain('blockingEvents');

      // When
      clientController.abort();

      // Then
      await vi.waitFor(expectExactlyOnceAbortLifecycle);
    } finally {
      releaseResolver?.();
      await app.close();
    }

    expectExactlyOnceAbortLifecycle();
  });
});
