import { describe, expect, it } from 'vitest';

import type { FrameworkResponse, RequestContext } from './types.js';
import { SseResponse, encodeSseComment, encodeSseMessage } from './sse.js';

interface MockSseStream {
  backpressure: boolean;
  closeListeners: Array<() => void>;
  flushHeadersCalls: number;
  onCalls: number;
  removeListenerCalls: number;
  writableEnded: boolean;
  writes: string[];
  endCalls: number;
  flushHeaders(): void;
  on(event: 'close', listener: () => void): void;
  removeListener(event: 'close', listener: () => void): void;
  emitClose(): void;
  write(chunk: string): boolean;
  end(): void;
}

function createMockSseStream(): MockSseStream {
  return {
    backpressure: false,
    closeListeners: [],
    emitClose() {
      for (const listener of [...this.closeListeners]) {
        listener();
      }
    },
    end() {
      this.endCalls += 1;
      this.writableEnded = true;
    },
    endCalls: 0,
    flushHeaders() {
      this.flushHeadersCalls += 1;
    },
    flushHeadersCalls: 0,
    on(event, listener) {
      this.onCalls += 1;

      if (event === 'close') {
        this.closeListeners.push(listener);
      }
    },
    onCalls: 0,
    removeListener(event, listener) {
      this.removeListenerCalls += 1;

      if (event === 'close') {
        this.closeListeners = this.closeListeners.filter((entry) => entry !== listener);
      }
    },
    removeListenerCalls: 0,
    writableEnded: false,
    write(chunk: string) {
      this.writes.push(chunk);
      return !this.backpressure;
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

  it('throws for top-level non-serializable SSE payloads', () => {
    expect(() => encodeSseMessage(Symbol('event'))).toThrow(TypeError);
    expect(() => encodeSseMessage(() => 'ignored')).toThrow(TypeError);
  });

  it('keeps serializable object payloads even when some fields are skipped by JSON.stringify', () => {
    const encoded = encodeSseMessage({ count: 1, ignore: () => 'ignored' });

    expect(encoded).toBe('data: {"count":1}\n\n');
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
    expect(stream.removeListenerCalls).toBe(1);
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
    expect(stream.onCalls).toBe(0);
  });

  it('surfaces backpressure from send and comment calls', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const sse = new SseResponse(createContext(response));

    stream.backpressure = true;

    expect(sse.send('hello')).toBe(false);
    expect(sse.comment('note')).toBe(false);
    expect(stream.writes).toEqual(['data: hello\n\n', ': note\n\n']);
  });

  it('returns false when trying to send after the stream closes', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const sse = new SseResponse(createContext(response));

    sse.close();

    expect(sse.send('ignored')).toBe(false);
    expect(sse.comment('ignored')).toBe(false);
    expect(stream.writes).toEqual([]);
  });

  it('throws from send when the payload is not JSON-serializable', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const sse = new SseResponse(createContext(response));

    expect(() => sse.send(Symbol('event'))).toThrow(TypeError);
    expect(stream.writes).toEqual([]);
  });

  it('closes the stream from the raw close event when request signal is absent', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const sse = new SseResponse(createContext(response));

    expect(stream.onCalls).toBe(1);

    stream.emitClose();
    sse.send('ignored-after-close');

    expect(stream.endCalls).toBe(1);
    expect(stream.removeListenerCalls).toBe(1);
    expect(stream.writes).toEqual([]);
  });

  it('does not register a raw close listener when the request signal exists', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const controller = new AbortController();

    new SseResponse(createContext(response, controller.signal));

    expect(stream.onCalls).toBe(0);
  });
});
