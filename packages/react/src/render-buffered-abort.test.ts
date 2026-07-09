import { Container } from '@fluojs/di';
import {
  createRequestContext,
  RequestAbortedError,
  type FrameworkRequest,
  type FrameworkResponse,
  type RequestContext,
} from '@fluojs/http';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderReactResponse, type ReactReadableStreamRenderer } from './render.js';
import { createReactServerEntry } from './server-entry.js';

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

type BufferedResponse = FrameworkResponse & {
  readonly chunks: readonly string[];
};

type TestRequestAbortOptions = {
  readonly isAborted?: () => boolean;
  readonly signal?: AbortSignal;
};

function createRequest(options: TestRequestAbortOptions = {}): FrameworkRequest {
  const request: FrameworkRequest = {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path: '/dashboard',
    query: {},
    raw: {},
    url: '/dashboard',
  };

  if (options.isAborted) {
    request.isAborted = options.isAborted;
  }

  if (options.signal) {
    request.signal = options.signal;
  }

  return request;
}

function createBufferedResponse(): BufferedResponse {
  const chunks: string[] = [];

  return {
    committed: false,
    get chunks() {
      return chunks;
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
  };
}

function createTestContext(response: FrameworkResponse, abortOptions: TestRequestAbortOptions): RequestContext {
  return createRequestContext({
    container: new Container(),
    metadata: {},
    request: createRequest(abortOptions),
    response,
  });
}

describe('renderReactResponse buffered abort handling', () => {
  it('throws without committing buffered partial HTML when request signal aborts during collection', async () => {
    const abortController = new AbortController();
    const response = createBufferedResponse();
    const context = createTestContext(response, { signal: abortController.signal });
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(TEXT_ENCODER.encode('<main>partial</main>'));
        abortController.abort();
      },
    }));

    await expect(renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard')),
      context,
      { renderToReadableStream },
    )).rejects.toBeInstanceOf(RequestAbortedError);

    expect(response.committed).toBe(false);
    expect(response.statusCode).toBeUndefined();
    expect(response.headers).toEqual({});
    expect(response.chunks).toEqual([]);
  });

  it('honors probe-only request aborts before buffered HTML send metadata is applied', async () => {
    let aborted = false;
    const response = createBufferedResponse();
    const context = createTestContext(response, { isAborted: () => aborted });
    const renderToReadableStream = vi.fn<ReactReadableStreamRenderer>(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode('<main>partial</main>'));
        aborted = true;
        controller.close();
      },
    }));

    await expect(renderReactResponse(
      createReactServerEntry(createElement('main', null, 'Dashboard')),
      context,
      { renderToReadableStream },
    )).rejects.toBeInstanceOf(RequestAbortedError);

    expect(response.committed).toBe(false);
    expect(response.statusCode).toBeUndefined();
    expect(response.headers).toEqual({});
    expect(response.chunks).toEqual([]);
  });
});
