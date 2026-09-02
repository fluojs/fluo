import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { describe, expect, it, vi } from 'vitest';

import {
  createWebFrameworkRequest,
  createWebRequestResponseFactory,
  dispatchWebRequest,
  startWebRequestDispatch,
} from './web.js';

const TEXT_ENCODER = new TextEncoder();
const INVALID_MAX_BODY_SIZES = [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['a negative integer', -1],
  ['a fractional value', 1.5],
] as const satisfies ReadonlyArray<readonly [string, number]>;

describe('Web JSON body limits', () => {
  it('settles a default cloned request with 413 while the original body remains unread', async () => {
    // Given
    const oversizedChunk = TEXT_ENCODER.encode('{"value":"too large"}');
    const keepStreamOpen = new Promise<void>(() => {});
    let chunkSent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunkSent) {
          return keepStreamOpen;
        }

        chunkSent = true;
        controller.enqueue(oversizedChunk);
      },
    });
    const requestInit = {
      body,
      duplex: 'half',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    } satisfies RequestInit & { duplex: 'half' };
    const request = new Request('https://runtime.test/json', requestInit);

    try {
      // When
      const response = await dispatchWebRequest({
        dispatcher: {
          async dispatch() {
            throw new Error('should not dispatch oversized JSON');
          },
        },
        maxBodySize: oversizedChunk.byteLength - 1,
        request,
      });

      // Then
      expect(response.status).toBe(413);
      expect(request.bodyUsed).toBe(false);
    } finally {
      await request.body?.cancel();
    }
  });

  it('preserves the 413 response when stream cancellation rejects', async () => {
    // Given
    const oversizedChunk = TEXT_ENCODER.encode('{"value":"too large"}');
    let cancelCalled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalled = true;
        return Promise.reject(new Error('cancel failed'));
      },
      start(controller) {
        controller.enqueue(oversizedChunk);
      },
    });
    const requestInit = {
      body,
      duplex: 'half',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    } satisfies RequestInit & { duplex: 'half' };

    // When
    const response = await dispatchWebRequest({
      consumeOriginalBody: true,
      dispatcher: {
        async dispatch() {
          throw new Error('should not dispatch oversized JSON');
        },
      },
      maxBodySize: oversizedChunk.byteLength - 1,
      request: new Request('https://runtime.test/json', requestInit),
    });

    // Then
    expect(response.status).toBe(413);
    expect(cancelCalled).toBe(true);
  });

  it('preserves the 413 response when reader cancellation throws synchronously', async () => {
    // Given
    const oversizedChunk = TEXT_ENCODER.encode('{"value":"too large"}');
    const cancelSpy = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel').mockImplementationOnce(() => {
      throw new Error('cancel threw');
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversizedChunk);
      },
    });
    const requestInit = {
      body,
      duplex: 'half',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    } satisfies RequestInit & { duplex: 'half' };
    const request = new Request('https://runtime.test/json', requestInit);

    try {
      // When
      const response = await dispatchWebRequest({
        consumeOriginalBody: true,
        dispatcher: {
          async dispatch() {
            throw new Error('should not dispatch oversized JSON');
          },
        },
        maxBodySize: oversizedChunk.byteLength - 1,
        request,
      });

      // Then
      expect(response.status).toBe(413);
    } finally {
      cancelSpy.mockRestore();
      await request.body?.cancel();
    }
  });

  it('keeps streaming enforcement when preferNativeJsonBodyReader is enabled', async () => {
    // Given
    const chunks = [
      TEXT_ENCODER.encode('{"value":"'),
      TEXT_ENCODER.encode('0123456789'),
      TEXT_ENCODER.encode('"}'),
    ];
    let chunkIndex = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        const chunk = chunks[chunkIndex];

        if (chunk === undefined) {
          controller.close();
          return;
        }

        chunkIndex += 1;
        controller.enqueue(chunk);
      },
    });
    const requestInit = {
      body,
      duplex: 'half',
      headers: {
        'content-length': '12',
        'content-type': 'application/json',
      },
      method: 'POST',
    } satisfies RequestInit & { duplex: 'half' };

    // When
    const response = await dispatchWebRequest({
      consumeOriginalBody: true,
      dispatcher: {
        async dispatch(_request: FrameworkRequest) {
          throw new Error('should not dispatch oversized JSON');
        },
      },
      maxBodySize: 12,
      preferNativeJsonBodyReader: true,
      request: new Request('https://runtime.test/json', requestInit),
    });

    // Then
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it('cancels oversized streamed JSON when Content-Length is missing', async () => {
    // Given
    const chunks = [
      TEXT_ENCODER.encode('{"value":"'),
      TEXT_ENCODER.encode('0123456789'),
      TEXT_ENCODER.encode('"}'),
    ];
    let chunkIndex = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        const chunk = chunks[chunkIndex];

        if (chunk === undefined) {
          controller.close();
          return;
        }

        chunkIndex += 1;
        controller.enqueue(chunk);
      },
    });
    const requestInit = {
      body,
      duplex: 'half',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    } satisfies RequestInit & { duplex: 'half' };

    // When
    const response = await dispatchWebRequest({
      consumeOriginalBody: true,
      dispatcher: {
        async dispatch() {
          throw new Error('should not dispatch oversized JSON');
        },
      },
      maxBodySize: 12,
      request: new Request('https://runtime.test/json', requestInit),
    });

    // Then
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it('accepts streamed JSON when its byte length equals maxBodySize', async () => {
    // Given
    const body = '{"ok":true}';
    const bodySize = TEXT_ENCODER.encode(body).byteLength;
    let parsedBody: unknown;

    // When
    const response = await dispatchWebRequest({
      consumeOriginalBody: true,
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          parsedBody = request.body;
          await frameworkResponse.send({ accepted: true });
        },
      },
      maxBodySize: bodySize,
      request: new Request('https://runtime.test/json', {
        body,
        headers: {
          'content-length': String(bodySize),
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    });

    // Then
    expect(parsedBody).toEqual({ ok: true });
    await expect(response.json()).resolves.toEqual({ accepted: true });
  });

  it.each(INVALID_MAX_BODY_SIZES)('rejects %s as maxBodySize when creating the Web request factory', (_label, maxBodySize) => {
    // Given / When / Then
    expect(() => createWebRequestResponseFactory({ maxBodySize })).toThrow(/maxBodySize/i);
  });

  it.each(INVALID_MAX_BODY_SIZES)('rejects %s as maxBodySize when creating a Web framework request', async (_label, maxBodySize) => {
    // Given
    const request = new Request('https://runtime.test/json', {
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    // When / Then
    await expect(createWebFrameworkRequest(
      request,
      new AbortController().signal,
      undefined,
      maxBodySize,
    )).rejects.toThrow(/maxBodySize/i);
  });

  it.each(INVALID_MAX_BODY_SIZES)('fails an invalid %s maxBodySize dispatch before reaching the dispatcher', async (_label, maxBodySize) => {
    // Given
    const dispatch = vi.fn();

    // When / Then
    await expect(dispatchWebRequest({
      dispatcher: { dispatch },
      maxBodySize,
      request: new Request('https://runtime.test/json', {
        body: '{"ok":true}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    })).rejects.toThrow(/maxBodySize/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(INVALID_MAX_BODY_SIZES)('fails fast synchronously when starting a dispatch with %s as maxBodySize', (_label, maxBodySize) => {
    // Given
    const dispatch = vi.fn();

    // When / Then
    expect(() => startWebRequestDispatch({
      dispatcher: { dispatch },
      maxBodySize,
      request: new Request('https://runtime.test/json', {
        body: '{"ok":true}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    })).toThrow(/maxBodySize/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('accepts zero as an explicit maxBodySize at both Web request factory boundaries', async () => {
    // Given / When
    const factory = createWebRequestResponseFactory({ maxBodySize: 0 });
    const frameworkRequest = await createWebFrameworkRequest(
      new Request('https://runtime.test/json'),
      new AbortController().signal,
      undefined,
      0,
    );

    // Then
    expect(factory.createRequest).toBeTypeOf('function');
    expect(frameworkRequest.body).toBeUndefined();
  });

  it('rejects JSON when Content-Length exceeds maxBodySize', async () => {
    // Given
    const request = new Request('https://runtime.test/json', {
      body: '{}',
      headers: {
        'content-length': '13',
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    // When
    const response = await dispatchWebRequest({
      consumeOriginalBody: true,
      dispatcher: {
        async dispatch() {
          throw new Error('should not dispatch oversized JSON');
        },
      },
      maxBodySize: 12,
      request,
    });

    // Then
    expect(response.status).toBe(413);
  });
});
