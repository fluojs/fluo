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
    let iteratorReturns = 0;
    let providerTeardowns = 0;
    let requestAbortObserved = false;
    const expectExactlyOnceAbortLifecycle = (): void => {
      expect(requestAbortObserved).toBe(true);
      expect(iteratorFinalizations).toBe(1);
      expect(iteratorReturns).toBe(1);
      expect(providerTeardowns).toBe(1);
    };

    class BlockingSseIterator implements AsyncIterableIterator<string> {
      private completed = false;
      private deliveredFirstEvent = false;
      private pendingNext: ((result: IteratorResult<string, void>) => void) | undefined;

      [Symbol.asyncIterator](): AsyncIterableIterator<string> {
        return this;
      }

      next(): Promise<IteratorResult<string, void>> {
        if (this.completed) {
          return Promise.resolve({ done: true, value: undefined });
        }

        if (!this.deliveredFirstEvent) {
          this.deliveredFirstEvent = true;
          return Promise.resolve({ done: false, value: 'connected' });
        }

        return new Promise((resolve) => {
          this.pendingNext = resolve;
        });
      }

      return(): Promise<IteratorResult<string, void>> {
        iteratorReturns += 1;

        if (!this.completed) {
          iteratorFinalizations += 1;
          this.release();
        }

        return Promise.resolve({ done: true, value: undefined });
      }

      release(): void {
        if (this.completed) {
          return;
        }

        this.completed = true;
        this.pendingNext?.({ done: true, value: undefined });
        this.pendingNext = undefined;
      }
    }

    let activeIterator: BlockingSseIterator | undefined;

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
      blockingEvents(_input: undefined, context: GraphQLContext): AsyncIterable<string> {
        const requestSignal = context.request.signal;

        if (!requestSignal) {
          throw new Error('Expected the Node HTTP request to expose an abort signal.');
        }

        if (requestSignal.aborted) {
          requestAbortObserved = true;
        } else {
          requestSignal.addEventListener('abort', () => {
            requestAbortObserved = true;
          }, { once: true });
        }

        activeIterator = new BlockingSseIterator();
        return activeIterator;
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
    const clientController = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const waitForClientOperation = async <T>(operation: Promise<T>, description: string): Promise<T> => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutRejection = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          clientController.abort();
          reject(new Error(`Timed out waiting for ${description}.`));
        }, 2_000);
      });

      try {
        return await Promise.race([operation, timeoutRejection]);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    };

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

      const response = await waitForClientOperation(
        fetch(
          `http://127.0.0.1:${String(address.port)}/graphql?query=${encodeURIComponent('subscription { blockingEvents }')}`,
          {
            headers: {
              accept: 'text/event-stream',
            },
            method: 'GET',
            signal: clientController.signal,
          },
        ),
        'the GraphQL SSE response',
      );
      reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Expected the SSE response body to expose a reader.');
      }

      const decoder = new TextDecoder();
      const eventBoundary = /\r?\n\r?\n/;
      let buffer = '';
      let dataFrame: string | undefined;

      while (!dataFrame) {
        const chunk = await waitForClientOperation(reader.read(), 'a complete GraphQL SSE data frame');

        if (chunk.done) {
          throw new Error('Expected a GraphQL SSE data frame before the response stream closed.');
        }

        buffer += decoder.decode(chunk.value, { stream: true });

        if (buffer.length > 64 * 1024) {
          throw new Error('Expected buffered GraphQL SSE frames to fit within 64 KiB.');
        }

        let boundary = eventBoundary.exec(buffer);

        while (boundary) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);

          if (frame.split(/\r?\n/).some((line) => line.startsWith('data:'))) {
            dataFrame = frame;
            break;
          }

          boundary = eventBoundary.exec(buffer);
        }
      }

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(dataFrame).toContain('blockingEvents');

      // When
      clientController.abort();

      // Then
      await vi.waitFor(expectExactlyOnceAbortLifecycle);
    } finally {
      try {
        if (!clientController.signal.aborted) {
          await reader?.cancel();
        }
      } finally {
        clientController.abort();
        activeIterator?.release();
        await app.close();
      }
    }

    expectExactlyOnceAbortLifecycle();
  });
});
