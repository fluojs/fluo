import { Container } from '@fluojs/di';
import { createRequestContext, type FrameworkRequest, type FrameworkResponse, type FrameworkResponseStream } from '@fluojs/http';
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
};

function createRequest(): FrameworkRequest {
  return {
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
}

function appendBody(chunks: string[], body: unknown): void {
  if (body instanceof Uint8Array) {
    chunks.push(TEXT_DECODER.decode(body));
  } else if (typeof body === 'string') {
    chunks.push(body);
  } else if (body !== undefined) {
    chunks.push(JSON.stringify(body));
  }
}

function createResponse(streaming: boolean): TestResponse {
  const chunks: string[] = [];
  let closed = false;
  let flushed = false;
  const response: TestResponse = {
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
      appendBody(chunks, body);
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

  if (streaming) {
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
      write(chunk: string | Uint8Array) {
        chunks.push(typeof chunk === 'string' ? chunk : TEXT_DECODER.decode(chunk, { stream: true }));
        return true;
      },
    };
    response.stream = stream;
  }

  return response;
}

function createContext(response: FrameworkResponse) {
  return createRequestContext({
    container: new Container(),
    metadata: {},
    request: createRequest(),
    response,
  });
}

function createRecoverableRenderer(): ReactReadableStreamRenderer {
  return vi.fn<ReactReadableStreamRenderer>(async (_node, options) => {
    options.onError?.(new Error('recoverable boundary'), { componentStack: '\n    at SlowPanel' });
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode('<main>fallback</main>'));
        controller.close();
      },
    });
  });
}

describe('renderReactResponse recoverable error hook isolation', () => {
  it('keeps buffered success response lifecycle when onRecoverableError throws', async () => {
    const response = createResponse(false);
    const context = createContext(response);
    const hookError = new Error('hook failed');
    const onRecoverableError = vi.fn(() => {
      throw hookError;
    });

    await expect(renderReactResponse(
      createReactServerEntry(createElement('main', null, 'fallback'), { onRecoverableError }),
      context,
      { renderToReadableStream: createRecoverableRenderer() },
    )).resolves.toBeUndefined();

    expect(onRecoverableError).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.committed).toBe(true);
    expect(response.chunks.join('')).toBe('<main>fallback</main>');
  });

  it('closes committed streaming responses when onRecoverableError throws before pipe', async () => {
    const response = createResponse(true);
    const context = createContext(response);
    const onRecoverableError = vi.fn(() => {
      throw new Error('hook failed');
    });

    await expect(renderReactResponse(
      createReactServerEntry(createElement('main', null, 'fallback'), { onRecoverableError }),
      context,
      { renderToReadableStream: createRecoverableRenderer() },
    )).resolves.toBeUndefined();

    expect(onRecoverableError).toHaveBeenCalledOnce();
    expect(response.committed).toBe(true);
    expect(response.flushed).toBe(true);
    expect(response.closed).toBe(true);
    expect(response.chunks.join('')).toBe('<main>fallback</main>');
  });
});
