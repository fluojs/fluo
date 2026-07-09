import { Container } from '@fluojs/di';
import {
  createRequestContext,
  type FrameworkRequest,
  type FrameworkResponse,
  type FrameworkResponseStream,
  type RequestContext,
} from '@fluojs/http';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderReactResponse, type ReactReadableStreamRenderer } from './render.js';
import { createReactServerEntry } from './server-entry.js';

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

type TestResponse = FrameworkResponse & {
  readonly chunks: readonly string[];
  readonly closed: boolean;
  readonly flushed: boolean;
  waitForNextChunk(): Promise<string>;
};

function createRequest(signal?: AbortSignal): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/dashboard',
    query: {},
    raw: {},
    signal,
    url: '/dashboard',
  };
}

function createResponse(onWrite?: () => void): TestResponse {
  const chunks: string[] = [];
  const chunkWaiters: Array<(chunk: string) => void> = [];
  let closed = false;
  let flushed = false;

  const stream: FrameworkResponseStream = {
    close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
    flush() {
      flushed = true;
    },
    waitForDrain() {
      return Promise.resolve();
    },
    write(chunk: string | Uint8Array) {
      const text = typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(chunk, { stream: true });
      chunks.push(text);
      chunkWaiters.shift()?.(text);
      onWrite?.();
      return true;
    },
  };

  return {
    committed: false,
    get closed() {
      return closed;
    },
    get chunks() {
      return chunks;
    },
    get flushed() {
      return flushed;
    },
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      if (body instanceof Uint8Array) {
        chunks.push(TEXT_DECODER.decode(body));
      } else if (typeof body === 'string') {
        chunks.push(body);
      } else if (body !== undefined) {
        chunks.push(JSON.stringify(body));
      }
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    stream,
    waitForNextChunk() {
      return new Promise<string>((resolve) => {
        chunkWaiters.push(resolve);
      });
    },
  };
}

function createTestContext(response: FrameworkResponse, signal?: AbortSignal): RequestContext {
  return createRequestContext({
    container: new Container(),
    metadata: {},
    request: createRequest(signal),
    response,
  });
}

function createReadableStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encodedChunks = chunks.map((chunk) => TEXT_ENCODER.encode(chunk));

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of encodedChunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return {
    promise,
    resolve() {
      settle?.();
    },
  };
}

describe('renderReactResponse', () => {
  it('streams successful React HTML with deterministic content type and status', async () => {
    const response = createResponse();
    const context = createTestContext(response);
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => createReadableStream([
      '<main>',
      'Dashboard',
      '</main>',
    ]));

    await renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard'), {
        headers: { 'X-React-Page': 'dashboard' },
        status: 202,
      }),
      context,
      { renderToReadableStream },
    );

    expect(renderToReadableStream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      onError: expect.any(Function),
    }));
    expect(response.statusCode).toBe(202);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers['X-React-Page']).toBe('dashboard');
    expect(response.committed).toBe(true);
    expect(response.flushed).toBe(true);
    expect(response.closed).toBe(true);
    expect(response.chunks.join('')).toBe('<main>Dashboard</main>');
  });

  it('throws shell render errors before committing response bytes', async () => {
    const response = createResponse();
    const context = createTestContext(response);
    const shellError = new Error('shell failed');
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => {
      throw shellError;
    });

    await expect(renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard')),
      context,
      { renderToReadableStream },
    )).rejects.toBe(shellError);

    expect(response.committed).toBe(false);
    expect(response.statusCode).toBeUndefined();
    expect(response.headers).toEqual({});
    expect(response.chunks).toEqual([]);
  });

  it('reports recoverable Suspense errors through the entry hook without changing committed status', async () => {
    const response = createResponse();
    const context = createTestContext(response);
    const recoverableError = new Error('recoverable boundary');
    const onRecoverableError = vi.fn();
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async (_node, options) => {
      options.onError?.(recoverableError, { componentStack: '\n    at SlowPanel' });
      return createReadableStream(['<main>fallback</main>']);
    });

    await renderReactResponse(
      createReactServerEntry(createElement('main', null, 'fallback'), { onRecoverableError }),
      context,
      { renderToReadableStream },
    );

    expect(onRecoverableError).toHaveBeenCalledWith(recoverableError, expect.objectContaining({
      errorInfo: { componentStack: '\n    at SlowPanel' },
      request: context.request,
    }));
    expect(response.statusCode).toBe(200);
    expect(response.committed).toBe(true);
    expect(response.chunks.join('')).toBe('<main>fallback</main>');
  });

  it('passes RequestContext request signals into React rendering and stops piping on abort', async () => {
    const abortController = new AbortController();
    const response = createResponse(() => abortController.abort());
    const context = createTestContext(response, abortController.signal);
    let receivedSignal: AbortSignal | undefined;
    let pulls = 0;
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async (_node, options) => {
      receivedSignal = options.signal;

      return new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(TEXT_ENCODER.encode(pulls === 1 ? '<main>first</main>' : '<main>second</main>'));
        },
      });
    });

    await renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard')),
      context,
      { renderToReadableStream },
    );

    expect(receivedSignal).toBe(abortController.signal);
    expect(response.committed).toBe(true);
    expect(response.chunks.join('')).toBe('<main>first</main>');
  });

  it('pipes Suspense fallback chunks before deferred content is ready', async () => {
    const deferred = createDeferred();
    const response = createResponse();
    const context = createTestContext(response);
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode('<span>loading</span>'));
        void deferred.promise.then(() => {
          controller.enqueue(TEXT_ENCODER.encode('<span>ready</span>'));
          controller.close();
        });
      },
    }));
    const entry = createReactServerEntry(createElement('main', null, 'Dashboard'));
    const firstChunk = response.waitForNextChunk();
    const render = renderReactResponse(entry, context, { renderToReadableStream });

    expect(await firstChunk).toContain('loading');
    deferred.resolve();
    await render;

    expect(response.chunks.join('')).toContain('ready');
  });
});
