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
});
