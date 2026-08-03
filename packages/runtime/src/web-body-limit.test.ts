import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { dispatchWebRequest } from './web.js';

const TEXT_ENCODER = new TextEncoder();

describe('Web JSON body limits', () => {
  it('cancels streamed JSON when an in-limit Content-Length understates the body size', async () => {
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
