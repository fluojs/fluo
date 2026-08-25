import { describe, expect, it } from 'vitest';

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
});
