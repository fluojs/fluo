import { describe, expect, it, vi } from 'vitest';

import type { FrameworkResponse, FrameworkResponseStream, RequestContext } from '../types.js';
import { SseResponse, encodeSseComment, encodeSseMessage } from './sse.js';

interface MockSseStream extends FrameworkResponseStream {
  _closed: boolean;
  backpressure: boolean;
  closeListeners: Array<() => void>;
  flushCalls: number;
  onCloseCalls: number;
  removeCloseListenerCalls: number;
  writes: Array<string | Uint8Array>;
  closeCalls: number;
  emitClose(): void;
}

function createMockSseStream(): MockSseStream {
  return {
    backpressure: false,
    closeListeners: [],
    close() {
      this.closeCalls += 1;
      this._closed = true;
    },
    closeCalls: 0,
    emitClose() {
      for (const listener of [...this.closeListeners]) {
        listener();
      }
    },
    flush() {
      this.flushCalls += 1;
    },
    flushCalls: 0,
    get closed() {
      return this._closed;
    },
    _closed: false,
    onClose(listener: () => void) {
      this.onCloseCalls += 1;
      this.closeListeners.push(listener);

      return () => {
        this.removeCloseListenerCalls += 1;
        this.closeListeners = this.closeListeners.filter((entry) => entry !== listener);
      };
    },
    onCloseCalls: 0,
    removeCloseListenerCalls: 0,
    write(chunk: string | Uint8Array) {
      this.writes.push(chunk);
      return !this.backpressure;
    },
    writes: [],
  };
}

function createMockResponse(stream?: MockSseStream): FrameworkResponse {
  return {
    committed: false,
    headers: {},
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
    stream,
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
    expect(stream.flushCalls).toBe(1);
    expect(stream.writes).toEqual(['event: message\nid: 1\ndata: hello\n\n', ': note\n\n']);
    expect(stream.closeCalls).toBe(1);
    expect(stream.removeCloseListenerCalls).toBe(1);
  });

  it('closes the stream when the request signal aborts', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const controller = new AbortController();
    const sse = new SseResponse(createContext(response, controller.signal));

    controller.abort(new Error('client-disconnected'));
    sse.send('ignored-after-abort');

    expect(stream.closeCalls).toBe(1);
    expect(stream.writes).toEqual([]);
    expect(stream.onCloseCalls).toBe(1);
    expect(stream.removeCloseListenerCalls).toBe(1);
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

    expect(stream.onCloseCalls).toBe(1);

    stream.emitClose();
    sse.send('ignored-after-close');

    expect(stream.closeCalls).toBe(1);
    expect(stream.removeCloseListenerCalls).toBe(1);
    expect(stream.writes).toEqual([]);
  });

  it('removes the request abort listener when the raw stream closes first', () => {
    const stream = createMockSseStream();
    const response = createMockResponse(stream);
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const sse = new SseResponse(createContext(response, controller.signal));

    expect(stream.onCloseCalls).toBe(1);

    stream.emitClose();
    sse.send('ignored-after-close');

    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(stream.closeCalls).toBe(1);
    expect(stream.removeCloseListenerCalls).toBe(1);
    expect(stream.writes).toEqual([]);
  });

  it('does not leak a late abort listener when raw onClose closes synchronously', () => {
    const stream = createMockSseStream();
    stream._closed = true;
    stream.onClose = (listener: () => void) => {
      stream.onCloseCalls += 1;
      listener();

      return () => {
        stream.removeCloseListenerCalls += 1;
      };
    };
    const response = createMockResponse(stream);
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const sse = new SseResponse(createContext(response, controller.signal));

    controller.abort(new Error('late-client-disconnect'));
    sse.send('ignored-after-sync-close');

    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(stream.onCloseCalls).toBe(1);
    expect(stream.closeCalls).toBe(0);
    expect(stream.removeCloseListenerCalls).toBe(1);
    expect(stream.writes).toEqual([]);
  });

  it('does not keep an abort listener for an already-closed stream with passive onClose', () => {
    const stream = createMockSseStream();
    stream._closed = true;
    stream.onClose = (listener: () => void) => {
      stream.onCloseCalls += 1;
      stream.closeListeners.push(listener);

      return () => {
        stream.removeCloseListenerCalls += 1;
        stream.closeListeners = stream.closeListeners.filter((entry) => entry !== listener);
      };
    };
    const response = createMockResponse(stream);
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const sse = new SseResponse(createContext(response, controller.signal));

    controller.abort(new Error('late-client-disconnect'));
    sse.send('ignored-after-passive-close');

    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(stream.onCloseCalls).toBe(1);
    expect(stream.closeListeners).toEqual([]);
    expect(stream.closeCalls).toBe(0);
    expect(stream.removeCloseListenerCalls).toBe(1);
    expect(stream.writes).toEqual([]);
  });

  it('throws when the adapter does not expose response.stream support', () => {
    expect(() => new SseResponse(createContext(createMockResponse()))).toThrow(
      'SseResponse requires adapter-provided response.stream support.',
    );
  });
});
