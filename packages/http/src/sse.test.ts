import { describe, expect, it } from 'vitest';

import type { FrameworkResponse, RequestContext } from './types.js';
import { SseResponse, encodeSseComment, encodeSseMessage } from './sse.js';

interface MockSseStream {
  flushHeadersCalls: number;
  writableEnded: boolean;
  writes: string[];
  endCalls: number;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(): void;
}

function createMockSseStream(): MockSseStream {
  return {
    end() {
      this.endCalls += 1;
      this.writableEnded = true;
    },
    endCalls: 0,
    flushHeaders() {
      this.flushHeadersCalls += 1;
    },
    flushHeadersCalls: 0,
    writableEnded: false,
    write(chunk: string) {
      this.writes.push(chunk);
      return true;
    },
    writes: [],
  };
}

function createMockResponse(stream: MockSseStream): FrameworkResponse & { raw: MockSseStream } {
  return {
    committed: false,
    headers: {},
    raw: stream,
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send() {
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createContext(response: FrameworkResponse, signal?: AbortSignal): RequestContext {
  return {
    container: {} as RequestContext['container'],
    metadata: {},
    request: {
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/events',
      query: {},
      raw: {},
      signal,
      url: '/events',
    },
    response,
  };
}

describe('SseResponse', () => {
  it('encodes event messages as canonical SSE frames', () => {
    const encoded = encodeSseMessage('line-1\nline-2', {
      event: 'update',
      id: 'event-1',
      retry: 2500.8,
    });

    expect(encoded).toBe('event: update\nid: event-1\nretry: 2500\ndata: line-1\ndata: line-2\n\n');
  });

  it('encodes comments as SSE comment frames', () => {
    const encoded = encodeSseComment('stream online\n');

    expect(encoded).toBe(': stream online\n:\n\n');
  });

  it('encodes undefined payloads as empty SSE data frames', () => {
    const encoded = encodeSseMessage(undefined, { event: 'keepalive' });

    expect(encoded).toBe('event: keepalive\ndata: \n\n');
  });

  it('commits SSE headers and keeps close idempotent', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const controller = new AbortController();
    const sse = new SseResponse(createContext(response, controller.signal));

    sse.send('hello', { event: 'message', id: 1 });
    sse.comment('note');
    sse.close();
    sse.close();
    sse.send('ignored-after-close');

    expect(response.statusCode).toBe(200);
    expect(response.committed).toBe(true);
    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.Connection).toBe('keep-alive');
    expect(response.headers['Cache-Control']).toBe('no-cache, no-transform');
    expect(response.headers['X-Accel-Buffering']).toBe('no');
    expect(stream.flushHeadersCalls).toBe(1);
    expect(stream.writes).toEqual(['event: message\nid: 1\ndata: hello\n\n', ': note\n\n']);
    expect(stream.endCalls).toBe(1);
  });

  it('closes the stream when the request signal aborts', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const controller = new AbortController();
    const sse = new SseResponse(createContext(response, controller.signal));

    controller.abort(new Error('client-disconnected'));
    sse.send('ignored-after-abort');

    expect(stream.endCalls).toBe(1);
    expect(stream.writes).toEqual([]);
  });
});
