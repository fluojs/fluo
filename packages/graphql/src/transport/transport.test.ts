import { describe, expect, it, vi } from 'vitest';

import type { FrameworkResponse } from '@fluojs/http';

import { writeFetchResponse } from './transport.js';

function createFrameworkResponseMock(): FrameworkResponse & { writes: Uint8Array[] } {
  const writes: Uint8Array[] = [];
  return {
    committed: false,
    headers: {},
    redirect() {},
    send: vi.fn(async () => {}),
    setHeader: vi.fn(),
    setStatus: vi.fn(),
    statusCode: 200,
    stream: {
      close: vi.fn(),
      closed: false,
      flush: vi.fn(),
      waitForDrain: vi.fn(async () => {}),
      write: vi.fn((chunk: Uint8Array | string) => {
        writes.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
        return true;
      }),
    },
    writes,
  };
}

describe('writeFetchResponse', () => {
  it('forwards repeated set-cookie values through separate setHeader calls', async () => {
    const headers = {
      entries() {
        return [['content-type', 'application/json']][Symbol.iterator]();
      },
      getSetCookie() {
        return ['access=one; Path=/', 'refresh=two; Path=/'];
      },
    } as unknown as Headers;
    const fetchResponse = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      body: null,
      headers,
      status: 200,
    } as unknown as Response;
    const frameworkResponse = createFrameworkResponseMock();

    await writeFetchResponse(fetchResponse, frameworkResponse);

    expect(frameworkResponse.setHeader).toHaveBeenCalledWith('set-cookie', 'access=one; Path=/');
    expect(frameworkResponse.setHeader).toHaveBeenCalledWith('set-cookie', 'refresh=two; Path=/');
    expect(frameworkResponse.setHeader).toHaveBeenCalledWith('content-type', 'application/json');
  });

  it('falls back to headers.entries for set-cookie when getSetCookie is unavailable', async () => {
    const headers = {
      entries() {
        return [
          ['set-cookie', 'a=1; Path=/'],
          ['set-cookie', 'b=2; Path=/'],
        ][Symbol.iterator]();
      },
    } as unknown as Headers;
    const fetchResponse = {
      arrayBuffer: async () => new Uint8Array([1]).buffer,
      body: null,
      headers,
      status: 200,
    } as unknown as Response;
    const frameworkResponse = createFrameworkResponseMock();

    await writeFetchResponse(fetchResponse, frameworkResponse);

    expect(frameworkResponse.setHeader).toHaveBeenCalledWith('set-cookie', 'a=1; Path=/');
    expect(frameworkResponse.setHeader).toHaveBeenCalledWith('set-cookie', 'b=2; Path=/');
  });

  it('streams fetch bodies through the explicit response.stream contract', async () => {
    const fetchResponse = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-1'));
        controller.enqueue(new TextEncoder().encode('chunk-2'));
        controller.close();
      },
    }), {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    });
    const frameworkResponse = createFrameworkResponseMock();

    await writeFetchResponse(fetchResponse, frameworkResponse);

    expect(frameworkResponse.send).not.toHaveBeenCalled();
    expect(frameworkResponse.stream?.flush).toHaveBeenCalledOnce();
    expect(frameworkResponse.stream?.close).toHaveBeenCalledOnce();
    expect(frameworkResponse.writes.map((chunk: Uint8Array) => Buffer.from(chunk).toString('utf8'))).toEqual(['chunk-1', 'chunk-2']);
  });

  it('cancels the upstream fetch body when the downstream stream closes during a write', async () => {
    const cancel = vi.fn();
    const fetchResponse = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-1'));
        controller.enqueue(new TextEncoder().encode('chunk-2'));
      },
    }), {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    });
    const frameworkResponse = createFrameworkResponseMock();
    const stream = frameworkResponse.stream;

    if (!stream) {
      throw new Error('Expected stream mock to exist.');
    }

    vi.mocked(stream.write).mockImplementationOnce((chunk: string | Uint8Array) => {
      frameworkResponse.writes.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      Reflect.set(stream, 'closed', true);
      return true;
    });

    await writeFetchResponse(fetchResponse, frameworkResponse);

    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.close).not.toHaveBeenCalled();
    expect(frameworkResponse.writes.map((chunk: Uint8Array) => Buffer.from(chunk).toString('utf8'))).toEqual(['chunk-1']);
  });

  it('cancels the upstream fetch body when downstream backpressure errors', async () => {
    const cancel = vi.fn();
    const fetchResponse = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-1'));
        controller.enqueue(new TextEncoder().encode('chunk-2'));
      },
    }), {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    });
    const frameworkResponse = createFrameworkResponseMock();
    const stream = frameworkResponse.stream;
    const downstreamError = new Error('downstream closed with error');

    if (!stream) {
      throw new Error('Expected stream mock to exist.');
    }
    const waitForDrain = stream.waitForDrain;

    if (!waitForDrain) {
      throw new Error('Expected waitForDrain mock to exist.');
    }

    vi.mocked(stream.write).mockReturnValueOnce(false);
    vi.mocked(waitForDrain).mockRejectedValueOnce(downstreamError);

    await expect(writeFetchResponse(fetchResponse, frameworkResponse)).rejects.toBe(downstreamError);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels and settles a pending upstream read when the downstream stream closes', async () => {
    const cancel = vi.fn(async () => {});
    const fetchResponse = new Response(new ReadableStream<Uint8Array>({
      cancel,
    }), {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    });
    const frameworkResponse = createFrameworkResponseMock();
    const stream = frameworkResponse.stream;
    let closeListener: (() => void) | undefined;
    const removeCloseListener = vi.fn();

    if (!stream) {
      throw new Error('Expected stream mock to exist.');
    }

    stream.onClose = vi.fn((listener: () => void) => {
      closeListener = listener;
      return removeCloseListener;
    });

    const writePromise = writeFetchResponse(fetchResponse, frameworkResponse);

    await new Promise((resolve) => setTimeout(resolve, 0));

    Reflect.set(stream, 'closed', true);
    closeListener?.();

    await expect(writePromise).resolves.toBeUndefined();

    expect(cancel).toHaveBeenCalledOnce();
    expect(removeCloseListener).toHaveBeenCalledOnce();
    expect(stream.close).not.toHaveBeenCalled();
    expect(frameworkResponse.writes).toEqual([]);
  });
});
