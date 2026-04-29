import type { ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { createFrameworkResponse } from './node-response.js';

type HeaderValue = string | string[] | number;

function createMockServerResponse(): ServerResponse {
  const headers: Record<string, HeaderValue> = {};

  return Object.assign(new EventEmitter(), {
    destroyed: false,
    end() {},
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    hasHeader(name: string) {
      return headers[name.toLowerCase()] !== undefined;
    },
    headersSent: false,
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
    },
    setHeader(name: string, value: HeaderValue) {
      headers[name.toLowerCase()] = value;
    },
    statusCode: 200,
    writableEnded: false,
  }) as unknown as ServerResponse;
}

describe('createFrameworkResponse', () => {
  it('appends repeated set-cookie header writes', () => {
    const rawResponse = createMockServerResponse();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    frameworkResponse.setHeader('set-cookie', 'access=token; HttpOnly; Path=/');
    frameworkResponse.setHeader('set-cookie', 'refresh=token; HttpOnly; Path=/');

    expect(rawResponse.getHeader('set-cookie')).toEqual([
      'access=token; HttpOnly; Path=/',
      'refresh=token; HttpOnly; Path=/',
    ]);
    expect(frameworkResponse.headers['set-cookie']).toEqual([
      'access=token; HttpOnly; Path=/',
      'refresh=token; HttpOnly; Path=/',
    ]);
  });

  it('keeps non set-cookie headers as replace semantics', () => {
    const rawResponse = createMockServerResponse();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    frameworkResponse.setHeader('content-type', 'application/json');
    frameworkResponse.setHeader('content-type', 'text/plain');

    expect(rawResponse.getHeader('content-type')).toBe('text/plain');
    expect(frameworkResponse.headers['content-type']).toBe('text/plain');
  });

  it('falls back to the raw response when compression declines the body', async () => {
    const rawResponse = createMockServerResponse();
    const endSpy = vi.fn();
    rawResponse.end = endSpy as typeof rawResponse.end;
    const compression = { write: vi.fn().mockResolvedValue(false) };
    const frameworkResponse = createFrameworkResponse(rawResponse, compression);

    await frameworkResponse.send('hello');

    expect(compression.write).toHaveBeenCalledOnce();
    expect(endSpy).toHaveBeenCalledWith(Buffer.from('hello', 'utf8'));
    expect(frameworkResponse.committed).toBe(true);
  });

  it('lets the compression strategy own the write when it handles the body', async () => {
    const rawResponse = createMockServerResponse();
    const endSpy = vi.fn();
    rawResponse.end = endSpy as typeof rawResponse.end;
    const compression = { write: vi.fn().mockResolvedValue(true) };
    const frameworkResponse = createFrameworkResponse(rawResponse, compression);

    await frameworkResponse.send({ ok: true });

    expect(compression.write).toHaveBeenCalledOnce();
    expect(endSpy).not.toHaveBeenCalled();
    expect(frameworkResponse.committed).toBe(true);
  });

  it('defers compression helper creation until send is called', async () => {
    const rawResponse = createMockServerResponse();
    const endSpy = vi.fn();
    rawResponse.end = endSpy as typeof rawResponse.end;
    const compression = { write: vi.fn().mockResolvedValue(false) };
    const compressionFactory = vi.fn(() => compression);
    const frameworkResponse = createFrameworkResponse(rawResponse, compressionFactory);

    expect(compressionFactory).not.toHaveBeenCalled();

    await frameworkResponse.send('hello');

    expect(compressionFactory).toHaveBeenCalledOnce();
    expect(compression.write).toHaveBeenCalledOnce();
    expect(endSpy).toHaveBeenCalledWith(Buffer.from('hello', 'utf8'));
  });

  it('settles waitForDrain when the response closes before drain', async () => {
    const rawResponse = createMockServerResponse();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    const waitForDrain = frameworkResponse.stream?.waitForDrain?.();
    rawResponse.emit('close');

    await expect(waitForDrain).resolves.toBeUndefined();
  });

  it('settles waitForDrain when the response errors before drain', async () => {
    const rawResponse = createMockServerResponse();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    const waitForDrain = frameworkResponse.stream?.waitForDrain?.();
    rawResponse.emit('error', new Error('socket failed'));

    await expect(waitForDrain).resolves.toBeUndefined();
  });
});
