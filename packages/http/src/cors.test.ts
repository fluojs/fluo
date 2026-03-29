import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from './types.js';
import { createCorsMiddleware } from './cors.js';

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
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
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

  it('throws at config time when allowCredentials is true and allowOrigin is "*"', () => {
    expect(() => createCorsMiddleware({ allowCredentials: true, allowOrigin: '*' })).toThrow(
      'allowCredentials cannot be true',
    );
  });

  it('throws at config time when allowCredentials is true and allowOrigin is omitted (defaults to "*")', () => {
    expect(() => createCorsMiddleware({ allowCredentials: true })).toThrow(
      'allowCredentials cannot be true',
    );
  });

  it('throws at request time when allowCredentials is true and allowOrigin function returns "*"', async () => {
    const middleware = createCorsMiddleware({
      allowCredentials: true,
      allowOrigin: () => '*',
    });
    const response = createResponse();

    await expect(
      middleware.handle(
        {
          request: createRequest('GET', 'https://app.example.com'),
          requestContext: {} as never,
          response,
        },
        async () => {},
      ),
    ).rejects.toThrow('allowCredentials cannot be true');
  });

  it('allows allowCredentials with an explicit list of origins', async () => {
    const middleware = createCorsMiddleware({
      allowCredentials: true,
      allowOrigin: ['https://trusted.example.com'],
    });
    const response = createResponse();

    await middleware.handle(
      {
        request: createRequest('GET', 'https://trusted.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {},
    );

    expect(response.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://trusted.example.com');
  });
});
