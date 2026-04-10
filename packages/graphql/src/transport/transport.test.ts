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
});
