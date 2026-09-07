import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { Readable, Writable } from 'node:stream';

import type { FrameworkRequest } from '@fluojs/http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNextAdapter, type NextHttpApplicationAdapter } from './adapter.js';
import { dispatchNextPagesRequest } from './pages-bridge.js';
import { createNextPagesRouterHandler } from './pages-router.js';

const cleanups: Array<() => void | Promise<void>> = [];

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Expected event did not arrive')), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => unknown,
) {
  const received = deferred<{
    request: IncomingMessage;
    response: ServerResponse;
  }>();
  const completed = deferred<unknown>();
  const server = createServer((request, response) => {
    received.resolve({ request, response });
    Promise.resolve(handler(request, response)).then(completed.resolve, completed.reject);
  });
  // Keep rejected handler outcomes observed even when a preceding assertion fails.
  void completed.promise.catch(() => undefined);
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await bounded(listening);
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP address');
  }
  return {
    url: `http://127.0.0.1:${address.port}/api/test`,
    received: received.promise,
    completed: completed.promise,
  };
}

function connect(url: string, method = 'GET', headers = {}) {
  const response = deferred<IncomingMessage>();
  const client = httpRequest(url, { method, headers }, response.resolve);
  client.on('error', response.reject);
  void response.promise.catch(() => undefined);
  cleanups.push(() => { client.destroy(); });
  return { client, response: response.promise };
}

class BodySource extends Readable {
  readonly method = 'POST';
  readonly url = '/api/test';
  readonly headers = { 'content-type': 'application/octet-stream' };
  produced = 0;

  constructor(
    private readonly chunk: Buffer,
    private readonly count = 1,
  ) {
    super({ highWaterMark: chunk.byteLength });
    cleanups.push(() => { this.destroy(); });
  }

  override _read(): void {
    if (this.produced === this.count) {
      this.push(null);
      return;
    }
    this.produced += 1;
    this.push(this.chunk);
  }
}

class ResponseTarget extends Writable {
  statusCode = 200;
  statusMessage = '';

  setHeader(): this {
    return this;
  }

  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
  }
}

describe('Pages transport cancellation and input ownership', () => {
  it('aborts the Fluo signal when the client closes before a response is ready', async () => {
    // Given
    const entered = deferred<AbortSignal>();
    const release = deferred<void>();
    cleanups.push(() => { release.resolve(); });
    const adapter = createNextAdapter();
    await adapter.listen({
      async dispatch(request, response) {
        if (!request.signal) {
          throw new Error('Expected the transport abort signal');
        }
        entered.resolve(request.signal);
        await release.promise;
        await response.send('late');
      },
    });
    const server = await serve((request, response) =>
      dispatchNextPagesRequest(adapter, request, response));
    const { client } = connect(server.url);
    client.end();
    const signal = await bounded(entered.promise);
    const native = await bounded(server.received);
    const closed = once(native.response, 'close');

    // When
    client.destroy();
    await bounded(closed);

    // Then
    expect(signal.aborted).toBe(true);
    await bounded(server.completed);
    expect(native.request.listenerCount('aborted')).toBe(0);
    release.resolve();
  });

  it('cancels an active response stream when the client disconnects during a pending read', async () => {
    // Given
    const entered = deferred<FrameworkRequest>();
    const cancelled = deferred<void>();
    const adapter = createNextAdapter();
    await adapter.listen({
      async dispatch(request, response) {
        entered.resolve(request);
        const stream = response.stream;
        if (!stream?.onClose) {
          throw new Error('Expected the Web response stream');
        }
        stream.onClose(() => cancelled.resolve());
        stream.write('first');
        await cancelled.promise;
      },
    });
    const server = await serve((request, response) =>
      dispatchNextPagesRequest(adapter, request, response));
    const { client, response: incoming } = connect(server.url);
    client.end();
    const response = await bounded(incoming);
    await bounded(once(response, 'data'));
    const request = await bounded(entered.promise);
    const native = await bounded(server.received);
    const closed = once(native.response, 'close');

    // When
    client.destroy();
    await bounded(closed);

    // Then
    expect(request.signal?.aborted).toBe(true);
    await bounded(cancelled.promise);
    await bounded(server.completed);
    expect(native.response.listenerCount('close')).toBe(0);
    expect(native.response.listenerCount('error')).toBe(0);
  });

  it('settles a disconnected request before deferred bootstrap completes without dispatching it', async () => {
    // Given
    const bootstrap = deferred<NextHttpApplicationAdapter>();
    const loaded = deferred<void>();
    const adapter = createNextAdapter();
    const dispatch = vi.fn(async () => undefined);
    await adapter.listen({ dispatch });
    const loader = vi.fn(() => {
      loaded.resolve();
      return bootstrap.promise;
    });
    const handler = createNextPagesRouterHandler(loader);
    const server = await serve((request, response) => {
      const result: unknown = Reflect.apply(handler, undefined, [request, response]);
      return result;
    });
    const { client } = connect(server.url, 'POST');
    client.flushHeaders();
    await bounded(loaded.promise);
    const native = await bounded(server.received);
    const closed = once(native.response, 'close');

    // When
    client.destroy();
    await bounded(closed);

    // Then
    try {
      await bounded(server.completed);
      expect(dispatch).not.toHaveBeenCalled();
      expect(native.request.listenerCount('aborted')).toBe(0);
      expect(native.response.listenerCount('close')).toBe(0);
    } finally {
      bootstrap.resolve(adapter);
    }
    const healthy = connect(server.url);
    healthy.client.end();
    const response = await bounded(healthy.response);
    response.resume();
    await bounded(once(response, 'end'));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('bounds native producer reads while the Web consumer is blocked', async () => {
    // Given
    const source = new BodySource(Buffer.alloc(64 * 1024), 256);
    const consumed = deferred<void>();
    const release = deferred<void>();
    cleanups.push(() => { release.resolve(); });
    const adapter = createNextAdapter();
    vi.spyOn(adapter, 'fetch').mockImplementation(async (request) => {
      const reader = request.body?.getReader();
      if (!reader) {
        throw new Error('Expected a request body');
      }
      await reader.read();
      consumed.resolve();
      await release.promise;
      await reader.cancel();
      reader.releaseLock();
      return new Response(null, { status: 204 });
    });

    // When
    const dispatched = dispatchNextPagesRequest(adapter, source, new ResponseTarget());
    await bounded(consumed.promise);

    // Then
    try {
      // One delivered chunk and at most one native high-water-mark buffer.
      expect(source.produced * 64 * 1024).toBeLessThanOrEqual(2 * 64 * 1024);
    } finally {
      release.resolve();
      await bounded(dispatched);
    }
  });

  it('returns real HTTP 413 for chunked oversized input before the client finishes uploading', async () => {
    // Given
    const adapter = createNextAdapter({ maxBodySize: 8 });
    const dispatch = vi.fn(async () => undefined);
    await adapter.listen({ dispatch });
    const server = await serve((request, response) =>
      dispatchNextPagesRequest(adapter, request, response));
    const { client, response: incoming } = connect(server.url, 'POST', {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    });

    // When: leave the upload open; a cancellation must not destroy its socket.
    client.write('{"value":"too large');
    const response = await bounded(incoming);
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    await bounded(once(response, 'end'));

    // Then
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
      error: { status: 413 },
    });
    expect(dispatch).not.toHaveBeenCalled();
    await bounded(server.completed);
    const native = await bounded(server.received);
    expect(native.request.listenerCount('data')).toBe(0);
    expect(native.request.listenerCount('readable')).toBe(0);
    const drained = once(native.request, 'end');
    client.end();
    await bounded(drained);
  });

  it('consumes the original body and preserves exact bytes without treating completion as abort', async () => {
    // Given
    const bytes = Buffer.from([0, 0xff, 0xc3, 0x28, 13, 10, 0xe2, 0x82, 0xac]);
    const adapter = createNextAdapter({ rawBody: true });
    const dispatched = deferred<FrameworkRequest>();
    await adapter.listen({
      async dispatch(request, response) {
        dispatched.resolve(request);
        await response.send('ok');
      },
    });
    const source = new BodySource(bytes);
    const response = new ResponseTarget();

    // When
    await bounded(dispatchNextPagesRequest(adapter, source, response));
    const request = await bounded(dispatched.promise);

    // Then
    expect(request.raw).toBeInstanceOf(Request);
    if (!(request.raw instanceof Request)) {
      throw new Error('Expected the native Web request');
    }
    expect(request.raw.bodyUsed).toBe(true);
    expect(request.rawBody).toEqual(new Uint8Array(bytes));
    expect(request.signal?.aborted).toBe(false);
    expect(source.listenerCount('aborted')).toBe(0);
    expect(source.listenerCount('readable')).toBe(0);
  });
});
