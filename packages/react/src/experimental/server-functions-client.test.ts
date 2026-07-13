import { describe, expect, it } from 'vitest';

import {
  createReactServerFunctionClient,
  REACT_SERVER_FUNCTION_REQUEST_HEADER,
  ReactServerFunctionClientError,
  type ReactServerFunctionReference,
} from './rsc.js';

const reference = { value: 'v1:update-profile:signed' } satisfies ReactServerFunctionReference;

describe('experimental React Server Function client', () => {
  it('calls the explicit endpoint with the signed reference and JSON arguments', async () => {
    // Given: an application-owned HTTP transport and explicit action endpoint.
    const requests: Array<{ readonly input: string; readonly init: RequestInit }> = [];
    const call = createReactServerFunctionClient({
      endpoint: '/_fluo/actions',
      fetch: async (input, init) => {
        requests.push({ input, init });
        return new Response(JSON.stringify({ result: { updated: true } }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      },
      reference,
    });

    // When: client code invokes the returned callable.
    const result = await call('Ada', 42);

    // Then: transport metadata is explicit and the serialized result is returned.
    expect(result).toEqual({ updated: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe('/_fluo/actions');
    expect(requests[0]?.init.method).toBe('POST');
    expect(requests[0]?.init.credentials).toBe('same-origin');
    expect(requests[0]?.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      [REACT_SERVER_FUNCTION_REQUEST_HEADER]: '1',
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      action: reference.value,
      args: ['Ada', 42],
    });
  });

  it('surfaces non-success HTTP responses without treating them as action results', async () => {
    // Given: a transport that returns the existing fluo forbidden envelope.
    const call = createReactServerFunctionClient({
      endpoint: '/_fluo/actions',
      fetch: async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }),
      reference,
    });

    // When/Then: client code receives a typed transport error with the HTTP status.
    const invocation = call();
    await expect(invocation).rejects.toMatchObject({
      name: 'ReactServerFunctionClientError',
      status: 403,
    });
    await expect(invocation).rejects.toBeInstanceOf(ReactServerFunctionClientError);
  });

  it('rejects and cancels a streamed response as soon as it exceeds maxResponseBytes', async () => {
    // Given: a streamed response whose second chunk crosses the configured byte limit.
    const encoder = new TextEncoder();
    let cancelled = false;
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        pullCount += 1;
        if (pullCount <= 2) {
          controller.enqueue(encoder.encode('12345'));
          return;
        }
        controller.close();
      },
    }, { highWaterMark: 0 });
    const call = createReactServerFunctionClient({
      endpoint: '/_fluo/actions',
      fetch: async () => new Response(body, { status: 200 }),
      maxResponseBytes: 8,
      reference,
    });

    // When: the response crosses the limit before its source closes.
    const invocation = call();

    // Then: the client rejects with its typed contract and cancels without reading to completion.
    await expect(invocation).rejects.toMatchObject({
      message: 'Server Function response exceeds the configured byte limit.',
      name: 'ReactServerFunctionClientError',
      status: 200,
    });
    expect(cancelled).toBe(true);
    expect(pullCount).toBe(2);
  });

  it('normalizes fetch rejection before an HTTP response into a typed status-zero error', async () => {
    // Given: an application-owned fetch transport that rejects before returning a response.
    const call = createReactServerFunctionClient({
      endpoint: '/_fluo/actions',
      fetch: async () => {
        throw new TypeError('network unavailable');
      },
      reference,
    });

    // When/Then: the transport failure does not escape as an untyped fetch error.
    const invocation = call();
    await expect(invocation).rejects.toMatchObject({
      name: 'ReactServerFunctionClientError',
      status: 0,
    });
    await expect(invocation).rejects.toBeInstanceOf(ReactServerFunctionClientError);
  });

  it('normalizes response body-read rejection into a typed client error', async () => {
    // Given: a valid HTTP response whose streaming body reader fails.
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new TypeError('response stream failed');
      },
    }, { highWaterMark: 0 });
    const call = createReactServerFunctionClient({
      endpoint: '/_fluo/actions',
      fetch: async () => new Response(body, { status: 200 }),
      reference,
    });

    // When/Then: the body-read failure preserves the available HTTP status in the typed contract.
    const invocation = call();
    await expect(invocation).rejects.toMatchObject({
      name: 'ReactServerFunctionClientError',
      status: 200,
    });
    await expect(invocation).rejects.toBeInstanceOf(ReactServerFunctionClientError);
  });
});
