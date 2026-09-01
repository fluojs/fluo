import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { EarlyHintsWriteError, RequestAbortedError } from '@fluojs/http';
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
    writeEarlyHints(_hints: Record<string, string | string[]>, callback?: () => void) {
      callback?.();
    },
  }) as unknown as ServerResponse;
}

describe('createFrameworkResponse', () => {
  it('writes multiple Early Hints without mutating the final response facade', async () => {
    const rawResponse = createMockServerResponse();
    const writeEarlyHints = vi.spyOn(rawResponse, 'writeEarlyHints');
    const frameworkResponse = createFrameworkResponse(rawResponse);

    await frameworkResponse.earlyHints?.write({
      link: ['</styles.css>; rel=preload; as=style'],
      'x-trace-id': 'trace-1',
    });
    await frameworkResponse.earlyHints?.write({
      link: '</app.js>; rel=modulepreload',
    });
    frameworkResponse.setHeader('link', '</final.css>; rel=stylesheet');

    expect(writeEarlyHints).toHaveBeenNthCalledWith(1, {
      link: ['</styles.css>; rel=preload; as=style'],
      'x-trace-id': 'trace-1',
    }, expect.any(Function));
    expect(writeEarlyHints).toHaveBeenNthCalledWith(2, {
      link: '</app.js>; rel=modulepreload',
    }, expect.any(Function));
    expect(frameworkResponse.committed).toBe(false);
    expect(frameworkResponse.statusCode).toBeUndefined();
    expect(frameworkResponse.headers).toEqual({
      link: '</final.css>; rel=stylesheet',
    });
  });

  it('rejects invalid or late Early Hints writes deterministically', async () => {
    const rawResponse = createMockServerResponse();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    await expect(frameworkResponse.earlyHints?.write({ link: '' })).rejects.toBeInstanceOf(EarlyHintsWriteError);

    frameworkResponse.committed = true;

    await expect(frameworkResponse.earlyHints?.write({
      link: '</late.css>; rel=preload; as=style',
    })).rejects.toMatchObject({
      code: 'EARLY_HINTS_WRITE_FAILED',
    });
  });

  it('rejects unsafe or ambiguous Early Hints headers before the native write', async () => {
    const rawResponse = createMockServerResponse();
    const writeEarlyHints = vi.spyOn(rawResponse, 'writeEarlyHints');
    const frameworkResponse = createFrameworkResponse(rawResponse);

    await expect(frameworkResponse.earlyHints?.write({
      link: '</styles.css>; rel=preload; as=style',
      'x-trace': 'ok\r\nset-cookie: injected=1',
    })).rejects.toMatchObject({
      code: 'EARLY_HINTS_WRITE_FAILED',
    });
    await expect(frameworkResponse.earlyHints?.write({
      link: '</styles.css>; rel=preload; as=style',
      Link: '</override.css>; rel=preload; as=style',
    })).rejects.toMatchObject({
      code: 'EARLY_HINTS_WRITE_FAILED',
    });

    expect(writeEarlyHints).not.toHaveBeenCalled();
  });

  it.each(['content-length', 'transfer-encoding'] as const)(
    'rejects status-forbidden %s before the native Early Hints write',
    async (headerName) => {
      const rawResponse = createMockServerResponse();
      const writeEarlyHints = vi.spyOn(rawResponse, 'writeEarlyHints');
      const frameworkResponse = createFrameworkResponse(rawResponse);

      await expect(frameworkResponse.earlyHints?.write({
        link: '</styles.css>; rel=preload; as=style',
        [headerName]: '1',
      })).rejects.toBeInstanceOf(EarlyHintsWriteError);

      expect(writeEarlyHints).not.toHaveBeenCalled();
    },
  );

  it('maps malformed Early Hints input to a rejected write promise', async () => {
    const rawResponse = createMockServerResponse();
    const writeEarlyHints = vi.spyOn(rawResponse, 'writeEarlyHints');
    const frameworkResponse = createFrameworkResponse(rawResponse);

    let write: Promise<void> | undefined;
    expect(() => {
      write = frameworkResponse.earlyHints?.write(null as unknown as {
        readonly link: string;
      });
    }).not.toThrow();

    await expect(write).rejects.toMatchObject({
      code: 'EARLY_HINTS_WRITE_FAILED',
    });
    expect(writeEarlyHints).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an inherited',
      Object.create({
        link: '</inherited.css>; rel=preload; as=style',
      }),
    ],
    [
      'a non-enumerable',
      Object.defineProperty(
        { link: '</hidden.css>; rel=preload; as=style' },
        'link',
        { enumerable: false },
      ),
    ],
  ])('rejects %s link before the native Early Hints write', async (_kind, headers) => {
    const rawResponse = createMockServerResponse();
    rawResponse.writeEarlyHints = vi.fn();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    const write = frameworkResponse.earlyHints?.write(headers);
    rawResponse.emit('close');

    await expect(write).rejects.toBeInstanceOf(EarlyHintsWriteError);
    expect(rawResponse.writeEarlyHints).not.toHaveBeenCalled();
    expect(rawResponse.listenerCount('close')).toBe(0);
    expect(rawResponse.listenerCount('error')).toBe(0);
  });

  it('wraps native Early Hints failures and removes terminal listeners', async () => {
    const rawResponse = createMockServerResponse();
    const nativeError = new Error('Socket write failed');
    rawResponse.writeEarlyHints = vi.fn(() => {
      throw nativeError;
    });
    const frameworkResponse = createFrameworkResponse(rawResponse);

    await expect(frameworkResponse.earlyHints?.write({
      link: '</styles.css>; rel=preload; as=style',
    })).rejects.toMatchObject({
      cause: nativeError,
      code: 'EARLY_HINTS_WRITE_FAILED',
    });
    expect(rawResponse.listenerCount('close')).toBe(0);
    expect(rawResponse.listenerCount('error')).toBe(0);
  });

  it('rejects an in-flight Early Hints write when the client disconnects', async () => {
    const rawResponse = createMockServerResponse();
    rawResponse.writeEarlyHints = vi.fn();
    const frameworkResponse = createFrameworkResponse(rawResponse);

    const write = frameworkResponse.earlyHints?.write({
      link: '</styles.css>; rel=preload; as=style',
    });
    rawResponse.emit('close');

    await expect(write).rejects.toBeInstanceOf(RequestAbortedError);
    expect(rawResponse.listenerCount('close')).toBe(0);
    expect(rawResponse.listenerCount('error')).toBe(0);
  });

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

  it('preserves identity bytes for a partial-content response', async () => {
    const rawResponse = createMockServerResponse();
    const endSpy = vi.fn();
    rawResponse.end = endSpy as typeof rawResponse.end;
    const compression = { write: vi.fn().mockResolvedValue(true) };
    const compressionFactory = vi.fn(() => compression);
    const frameworkResponse = createFrameworkResponse(rawResponse, compressionFactory);

    frameworkResponse.setStatus(206);
    frameworkResponse.setHeader('Content-Range', 'bytes 2-4/6');
    await frameworkResponse.send(Uint8Array.from([2, 3, 4]));

    expect(compressionFactory).not.toHaveBeenCalled();
    expect(compression.write).not.toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalledWith(Buffer.from([2, 3, 4]));
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

  it('settles waitForDrain and removes terminal listeners when the response drains', async () => {
    const rawResponse = createMockServerResponse();
    const frameworkResponse = createFrameworkResponse(rawResponse);
    let settled = false;

    const waitForDrain = frameworkResponse.stream?.waitForDrain?.();
    void waitForDrain?.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    rawResponse.emit('drain');

    await expect(waitForDrain).resolves.toBeUndefined();
    expect(settled).toBe(true);
    expect(rawResponse.listenerCount('drain')).toBe(0);
    expect(rawResponse.listenerCount('close')).toBe(0);
    expect(rawResponse.listenerCount('error')).toBe(0);
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
