import { describe, expect, it, vi } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '../types.js';
import { createCorrelationMiddleware } from './correlation.js';

function createRequest(
  headers: FrameworkRequest['headers'] = {},
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method: 'GET',
    params: {},
    path: '/correlation',
    query: {},
    raw: {},
    url: '/correlation',
  };
}

function createResponse(): FrameworkResponse {
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
  };
}

describe('createCorrelationMiddleware', () => {
  it('reuses mixed-case inbound request ids before generating a new one', async () => {
    const middleware = createCorrelationMiddleware();
    const response = createResponse();
    const requestContext: { requestId?: string } = {};

    await middleware.handle(
      {
        request: createRequest({ 'X-REQUEST-ID': 'req-upper' }),
        requestContext: requestContext as never,
        response,
      },
      async () => {},
    );

    expect(requestContext.requestId).toBe('req-upper');
    expect(response.headers['x-request-id']).toBe('req-upper');
  });

  it('ignores mixed-case blank inbound request ids before generating a new one', async () => {
    const middleware = createCorrelationMiddleware();
    const response = createResponse();
    const requestContext: { requestId?: string } = {};
    const randomUuid = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111');

    try {
      await middleware.handle(
        {
          request: createRequest({ 'X-REQUEST-ID': '   ' }),
          requestContext: requestContext as never,
          response,
        },
        async () => {},
      );
    } finally {
      randomUuid.mockRestore();
    }

    expect(requestContext.requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(response.headers['x-request-id']).toBe('11111111-1111-4111-8111-111111111111');
  });
});
