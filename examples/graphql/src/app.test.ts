import { describe, expect, it, vi } from 'vitest';

import type { HttpApplicationAdapter } from '@fluojs/http';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import {
  bootstrapNodeApplication,
  NodeHttpApplicationAdapter,
} from '@fluojs/platform-nodejs';

import { AppModule, AuthorBatchRecorder, LiveUpdates } from './app';
import {
  fetchWithin,
  parseSubscriptionData,
  parseSubscriptionFrame,
  readSubscriptionPayload,
  waitWithin,
} from './test-helpers';

describe('GraphQL example application', () => {
  it('rejects a pending external operation at the test deadline', async () => {
    // Given: an external operation that never settles.
    vi.useFakeTimers();
    const operation = new Promise<never>(() => {});
    let rejection: unknown;

    try {
      // When: the test deadline elapses.
      void waitWithin(operation, 'Timed out awaiting the external operation.').catch(
        (error: unknown) => {
          rejection = error;
        },
      );
      await vi.advanceTimersByTimeAsync(1_000);

      // Then: the operation fails deterministically instead of hanging the suite.
      expect(rejection).toEqual(new Error('Timed out awaiting the external operation.'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('joins multiple SSE data fields and removes only one optional leading space', () => {
    // Given: one event with multiple data fields and significant spaces after the delimiter.
    const frame = ['data: first', 'data:  second', 'data:third'].join('\n');

    // When: the event data is assembled.
    const data = parseSubscriptionData(frame);

    // Then: fields are newline-joined and only one optional space is removed.
    expect(data).toBe('first\n second\nthird');
  });

  it('reads a JSON subscription payload terminated by CRLF', async () => {
    // Given: a valid GraphQL SSE event using CRLF line and frame delimiters.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: next\r\ndata: {"data":{"bookPublished":"GraphQL in Practice"}}\r\n\r\n',
          ),
        );
        controller.close();
      },
    });

    // When: the next GraphQL subscription payload is read.
    const payload = readSubscriptionPayload(stream.getReader());

    // Then: the exact JSON payload is returned before the stream closes.
    await expect(payload).resolves.toEqual({
      data: {
        bookPublished: 'GraphQL in Practice',
      },
    });
  });

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
    let updates: LiveUpdates | undefined;

    try {
      await waitWithin(app.listen(), 'Timed out starting the GraphQL example application.');

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
      const queryResponse = await fetchWithin(`${origin}/graphql`, {
        body: JSON.stringify({
          query: '{ books { title author { name } } }',
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      const queryBody = await waitWithin(
        queryResponse.json(),
        'Timed out reading the first GraphQL query response.',
      );
      const repeatedQueryResponse = await fetchWithin(`${origin}/graphql`, {
        body: JSON.stringify({
          query: '{ books { title author { name } } }',
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      const repeatedQueryBody = await waitWithin(
        repeatedQueryResponse.json(),
        'Timed out reading the repeated GraphQL query response.',
      );

      const subscriptionResponse = await fetchWithin(
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

      updates = await app.get<LiveUpdates>(LiveUpdates);
      await waitWithin(
        updates.waitForSubscriber(),
        'Timed out awaiting GraphQL subscriber readiness.',
      );
      expect(updates.getSubscriberListenerCount()).toBe(1);

      const publishResponse = await fetchWithin(`${origin}/graphql`, {
        body: JSON.stringify({
          query: 'mutation { publishBook(title: "GraphQL in Practice") }',
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      });
      const publishBody = await waitWithin(
        publishResponse.json(),
        'Timed out reading the GraphQL mutation response.',
      );

      // Then: the query resolves batched authors and the already-active subscription receives the update.
      expect(queryBody).toEqual({
        data: {
          books: [
            { author: { name: 'Ada' }, title: 'Composable Systems' },
            { author: { name: 'Grace' }, title: 'Operation Boundaries' },
            { author: { name: 'Ada' }, title: 'DataLoader Patterns' },
          ],
        },
      });
      expect(repeatedQueryBody).toEqual({
        data: {
          books: [
            { author: { name: 'Ada' }, title: 'Composable Systems' },
            { author: { name: 'Grace' }, title: 'Operation Boundaries' },
            { author: { name: 'Ada' }, title: 'DataLoader Patterns' },
          ],
        },
      });
      const authorBatches = await app.get<AuthorBatchRecorder>(AuthorBatchRecorder);
      expect(authorBatches.getBatches()).toEqual([
        ['ada', 'grace'],
        ['ada', 'grace'],
      ]);
      expect(publishBody).toEqual({
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
      try {
        await waitWithin(
          reader?.cancel() ?? Promise.resolve(),
          'Timed out closing the GraphQL SSE response body.',
        );
      } finally {
        abortController.abort();
        await waitWithin(app.close(), 'Timed out closing the GraphQL example application.');
      }

      expect(updates?.getSubscriberListenerCount() ?? 0).toBe(0);
    }
  });
});
