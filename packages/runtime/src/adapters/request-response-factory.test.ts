import { describe, expect, it, vi } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@fluojs/http';

import {
  dispatchWithRequestResponseFactory,
  type RequestResponseFactory,
} from './request-response-factory.js';

describe('dispatchWithRequestResponseFactory', () => {
  it('dispatches through the extracted factory seam and finalizes uncommitted responses', async () => {
    const events: string[] = [];
    const response = {
      committed: false,
      headers: {},
      redirect() {},
      send: vi.fn(async (_body: unknown) => {
        events.push('send');
        response.committed = true;
      }),
      setHeader() {},
      setStatus() {},
      statusSet: false,
    };

    const factory: RequestResponseFactory<{ id: string }, { id: string }, typeof response> = {
      async createRequest(rawRequest, signal) {
        events.push(`request:${rawRequest.id}:${String(signal.aborted)}`);
        return {
          cookies: {},
          headers: {},
          method: 'GET',
          params: {},
          path: '/',
          query: {},
          raw: rawRequest,
          signal,
          url: '/',
        };
      },
      createRequestSignal() {
        events.push('signal');
        return new AbortController().signal;
      },
      createResponse(rawResponse) {
        events.push(`response:${rawResponse.id}`);
        return response;
      },
      resolveRequestId(rawRequest) {
        return rawRequest.id;
      },
      async writeErrorResponse() {
        events.push('error');
      },
    };

    const frameworkResponse = await dispatchWithRequestResponseFactory({
      dispatcher: {
        async dispatch(request: FrameworkRequest, frameworkResponse: FrameworkResponse) {
          events.push(`dispatch:${String(request.raw === (request.raw as { id: string }))}`);
          expect(frameworkResponse).toBe(response);
        },
      },
      dispatcherNotReadyMessage: 'dispatcher missing',
      factory,
      rawRequest: { id: 'req-1' },
      rawResponse: { id: 'res-1' },
    });

    expect(frameworkResponse).toBe(response);

    expect(events).toEqual([
      'response:res-1',
      'signal',
      'request:req-1:false',
      'dispatch:true',
      'send',
    ]);
    expect(response.send).toHaveBeenCalledOnce();
  });

  it('routes errors through the extracted factory seam with the resolved request id', async () => {
    const writeErrorResponse = vi.fn(async () => {});
    const factory: RequestResponseFactory<{ id: string }, undefined> = {
      async createRequest(rawRequest, signal) {
        return {
          cookies: {},
          headers: {},
          method: 'GET',
          params: {},
          path: '/',
          query: {},
          raw: rawRequest,
          signal,
          url: '/',
        };
      },
      createRequestSignal() {
        return new AbortController().signal;
      },
      createResponse() {
        return {
          committed: false,
          headers: {},
          redirect() {},
          async send() {},
          setHeader() {},
          setStatus() {},
          statusSet: false,
        };
      },
      resolveRequestId(rawRequest) {
        return rawRequest.id;
      },
      writeErrorResponse,
    };
    const error = new Error('boom');

    const frameworkResponse = await dispatchWithRequestResponseFactory({
      dispatcher: {
        async dispatch() {
          throw error;
        },
      },
      dispatcherNotReadyMessage: 'dispatcher missing',
      factory,
      rawRequest: { id: 'req-2' },
      rawResponse: undefined,
    });

    expect(frameworkResponse).toMatchObject({ committed: false });
    expect(writeErrorResponse).toHaveBeenCalledOnce();
    expect(writeErrorResponse).toHaveBeenCalledWith(error, expect.objectContaining({ committed: false }), 'req-2');
  });
});
