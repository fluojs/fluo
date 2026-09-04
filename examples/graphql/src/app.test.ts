import { describe, expect, it, vi } from 'vitest';

import type { HttpApplicationAdapter } from '@fluojs/http';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import {
  bootstrapNodeApplication,
  NodeHttpApplicationAdapter,
} from '@fluojs/runtime/node';

import { AppModule, LiveUpdates } from './app';

function parseSubscriptionFrame(frame: string): unknown {
  const dataLines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());

  if (dataLines.length !== 1) {
    throw new Error('Expected exactly one data field in the GraphQL subscription frame.');
  }

  return JSON.parse(dataLines[0]);
}

async function readSubscriptionPayload(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(1_000);
  const timedOut = new Promise<never>((_, reject) => {
    timeout.addEventListener(
      'abort',
      () => reject(new Error('Timed out waiting for the GraphQL subscription payload.')),
      { once: true },
    );
  });
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const chunk = await Promise.race([reader.read(), timedOut]);

    if (chunk.done) {
      throw new Error('Expected a GraphQL subscription payload before the stream closed.');
    }

    buffer += decoder.decode(chunk.value, { stream: true });

    if (buffer.length > 64 * 1024) {
      throw new Error('Expected the GraphQL subscription payload to fit within 64 KiB.');
    }

    const boundary = buffer.indexOf('\n\n');

    if (boundary < 0) {
      continue;
    }

    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);

    if (frame.split('\n').some((line) => line.startsWith('data:'))) {
      return parseSubscriptionFrame(frame);
    }
  }
}

async function waitWithin<T>(promise: Promise<T>, message: string): Promise<T> {
  const timeout = AbortSignal.timeout(1_000);
  const timedOut = new Promise<never>((_, reject) => {
    timeout.addEventListener('abort', () => reject(new Error(message)), { once: true });
  });

  return await Promise.race([promise, timedOut]);
}

describe('GraphQL example application', () => {
  it('rejects a malformed SSE data payload', () => {
    // Given: an SSE frame whose data field is not JSON.
    const frame = 'data: GraphQL in Practice';

    // When/Then: parsing the frame rejects the malformed boundary payload.
    expect(() => parseSubscriptionFrame(frame)).toThrow(SyntaxError);
  });

  it('rejects when no subscriber becomes ready before the deadline', async () => {
    // Given: a live update service with no subscription.
    vi.useFakeTimers();
    const updates = new LiveUpdates();
    let rejection: unknown;

    try {
      // When: the subscriber readiness deadline elapses.
      void updates.waitForSubscriber().catch((error: unknown) => {
        rejection = error;
      });
      await vi.advanceTimersByTimeAsync(1_000);

      // Then: the wait rejects instead of remaining pending indefinitely.
      expect(rejection).toEqual(
        new Error('Timed out waiting for the GraphQL subscription subscriber.'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the EventEmitter listener when the subscription iterator is cancelled', async () => {
    // Given: a subscription whose pending read has installed the EventEmitter listener.
    const updates = new LiveUpdates();
    const subscription = updates.subscribe();
    const pendingRead = subscription.next();
    await updates.waitForSubscriber();
    expect(updates.getSubscriberListenerCount()).toBe(1);

    // When: the consumer cancels the iterator before another event arrives.
    if (!subscription.return) {
      throw new Error('Expected the GraphQL subscription iterator to support cancellation.');
    }

    const cancellation = subscription.return();

    // Then: cancellation settles the pending read and removes the listener within the deadline.
    await expect(
      waitWithin(cancellation, 'Timed out cancelling the GraphQL subscription iterator.'),
    ).resolves.toEqual({ done: true, value: undefined });
    await expect(
      waitWithin(pendingRead, 'Timed out settling the cancelled GraphQL subscription read.'),
    ).resolves.toEqual({ done: true, value: undefined });
    expect(updates.getSubscriberListenerCount()).toBe(0);
  });

  it('serves a DataLoader-backed query and an SSE subscription after startup', async () => {
    // Given: the official GraphQL module registration and an OS-assigned listener.
    const app = await bootstrapNodeApplication(AppModule, { cors: false, port: 0 });
    const abortController = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      await app.listen();

      const adapter = await app.get<HttpApplicationAdapter>(HTTP_APPLICATION_ADAPTER);

      if (!(adapter instanceof NodeHttpApplicationAdapter)) {
        throw new Error('Expected the GraphQL example to use the Node HTTP adapter.');
      }

      const address = adapter.getServer().address();

      if (!address || typeof address === 'string') {
        throw new Error('Expected the GraphQL example to bind an HTTP listener.');
      }

      const origin = `http://127.0.0.1:${String(address.port)}`;

      // When: a client queries the catalog, subscribes, and then publishes an update.
      const queryResponse = await fetch(`${origin}/graphql`, {
        body: JSON.stringify({
          query: '{ books { title author { name } } }',
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      const subscriptionResponse = await fetch(
        `${origin}/graphql?query=${encodeURIComponent('subscription { bookPublished }')}`,
        {
          headers: {
            accept: 'text/event-stream',
          },
          method: 'GET',
          signal: abortController.signal,
        },
      );
      expect(subscriptionResponse.status).toBe(200);
      expect(subscriptionResponse.headers.get('content-type')).toMatch(
        /^text\/event-stream(?:;|$)/,
      );
      reader = subscriptionResponse.body?.getReader();

      if (!reader) {
        throw new Error('Expected an SSE response body for the GraphQL subscription.');
      }

      const updates = await app.get<LiveUpdates>(LiveUpdates);
      await updates.waitForSubscriber();
      expect(updates.getSubscriberListenerCount()).toBe(1);

      const publishResponse = await fetch(`${origin}/graphql`, {
        body: JSON.stringify({
          query: 'mutation { publishBook(title: "GraphQL in Practice") }',
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      });

      // Then: the query resolves batched authors and the already-active subscription receives the update.
      expect(await queryResponse.json()).toEqual({
        data: {
          books: [
            { author: { name: 'Ada' }, title: 'Composable Systems' },
            { author: { name: 'Grace' }, title: 'Operation Boundaries' },
            { author: { name: 'Ada' }, title: 'DataLoader Patterns' },
          ],
        },
      });
      expect(await publishResponse.json()).toEqual({
        data: {
          publishBook: 'GraphQL in Practice',
        },
      });

      await expect(readSubscriptionPayload(reader)).resolves.toEqual({
        data: {
          bookPublished: 'GraphQL in Practice',
        },
      });
    } finally {
      const updates = await app.get<LiveUpdates>(LiveUpdates);

      try {
        await waitWithin(
          reader?.cancel() ?? Promise.resolve(),
          'Timed out closing the GraphQL SSE response body.',
        );
      } finally {
        abortController.abort();
        await waitWithin(app.close(), 'Timed out closing the GraphQL example application.');
      }

      expect(updates.getSubscriberListenerCount()).toBe(0);
    }
  });
});
