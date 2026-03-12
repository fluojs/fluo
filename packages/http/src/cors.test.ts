import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from './types';
import { createCorsMiddleware } from './cors';

function createRequest(method: FrameworkRequest['method'], origin?: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: origin ? { origin } : {},
    method,
    params: {},
    path: '/users',
    query: {},
    raw: {},
    url: '/users',
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
    },
    statusCode: 200,
  };
}

describe('createCorsMiddleware', () => {
  it('applies CORS headers on normal requests', async () => {
    const middleware = createCorsMiddleware({
      allowHeaders: ['Content-Type', 'Authorization'],
      allowOrigin: ['https://app.example.com'],
      exposeHeaders: ['X-Request-Id'],
    });
    const response = createResponse();
    let reachedNext = false;

    await middleware.handle(
      {
        request: createRequest('GET', 'https://app.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {
        reachedNext = true;
      },
    );

    expect(reachedNext).toBe(true);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(response.headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
    expect(response.headers['Access-Control-Expose-Headers']).toBe('X-Request-Id');
    expect(response.headers.Vary).toBe('Origin');
  });

  it('terminates OPTIONS preflight requests', async () => {
    const middleware = createCorsMiddleware({
      allowOrigin: '*',
    });
    const response = createResponse();
    let reachedNext = false;

    await middleware.handle(
      {
        request: createRequest('OPTIONS', 'https://app.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {
        reachedNext = true;
      },
    );

    expect(reachedNext).toBe(false);
    expect(response.statusCode).toBe(204);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
  });
});
