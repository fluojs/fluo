import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '../types.js';
import { type CorsOptions, createCorsMiddleware } from './cors.js';

function createRequest(
  method: FrameworkRequest['method'],
  origin?: string,
  headers: FrameworkRequest['headers'] = {},
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: origin ? { ...headers, origin } : headers,
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
  for (const method of ['GET', 'OPTIONS'] as const) {
    for (const policy of ['array', 'function', 'wildcard function'] as const) {
      it.each(['https://app.example.com', 'https://rejected.example.com', undefined])(
        `varies ${method} CORS responses by Origin for ${policy} policies with origin %s`,
        async (requestOrigin) => {
          const callbackInputs: Array<string | undefined> = [];
          const allowOrigin: CorsOptions['allowOrigin'] = policy === 'array'
            ? ['https://app.example.com']
            : (origin) => {
              callbackInputs.push(origin);
              return policy === 'wildcard function'
                ? '*'
                : origin === 'https://app.example.com' ? origin : undefined;
            };
          const middleware = createCorsMiddleware({ allowOrigin });
          const response = createResponse();
          let reachedNext = false;

          await middleware.handle(
            {
              request: createRequest(method, requestOrigin, method === 'OPTIONS'
                ? { 'access-control-request-method': 'GET' }
                : {}),
              requestContext: {} as never,
              response,
            },
            async () => {
              reachedNext = true;
            },
          );

          const expectedOrigin = policy === 'wildcard function'
            ? '*'
            : requestOrigin === 'https://app.example.com' ? requestOrigin : undefined;
          expect(response.headers['Access-Control-Allow-Origin']).toBe(expectedOrigin);
          expect(response.headers.Vary).toBe('Origin');
          expect(callbackInputs).toEqual(policy === 'array' ? [] : [requestOrigin]);
          expect(reachedNext).toBe(method === 'GET');
          expect(response.committed).toBe(method === 'OPTIONS');
          expect(response.statusCode).toBe(method === 'OPTIONS' ? 204 : undefined);
          expect(response.body).toBeUndefined();
        },
      );
    }

    it.each([undefined, '*', 'https://static.example.com'])(
      `preserves ${method} CORS variance for static policy %s`,
      async (allowOrigin) => {
        const middleware = createCorsMiddleware({ allowOrigin });
        const response = createResponse();

        await middleware.handle(
          {
            request: createRequest(method, 'https://app.example.com', method === 'OPTIONS'
              ? { 'access-control-request-method': 'GET' }
              : {}),
            requestContext: {} as never,
            response,
          },
          async () => {},
        );

        expect(response.headers['Access-Control-Allow-Origin']).toBe(allowOrigin ?? '*');
        expect(response.headers.Vary).toBe(allowOrigin && allowOrigin !== '*' ? 'Origin' : undefined);
      },
    );
  }

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
        request: createRequest('OPTIONS', 'https://app.example.com', {
          'access-control-request-method': 'GET',
        }),
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

  it('lets non-preflight OPTIONS requests continue to explicit route handlers', async () => {
    const middleware = createCorsMiddleware({
      allowOrigin: 'https://app.example.com',
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

    expect(reachedNext).toBe(true);
    expect(response.committed).toBe(false);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
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

  it('preserves existing Vary values and does not duplicate Origin', async () => {
    const middleware = createCorsMiddleware({
      allowOrigin: ['https://app.example.com'],
    });
    const response = createResponse();
    response.setHeader('Vary', 'Accept-Encoding, oRiGiN');

    await middleware.handle(
      {
        request: createRequest('GET', 'https://app.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {},
    );

    expect(response.headers.Vary).toBe('Accept-Encoding, oRiGiN');
  });

  it('preserves lowercase vary header names when appending Origin', async () => {
    const middleware = createCorsMiddleware({
      allowOrigin: ['https://app.example.com'],
    });
    const response = createResponse();
    response.setHeader('vary', 'Accept-Encoding');

    await middleware.handle(
      {
        request: createRequest('GET', 'https://app.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {},
    );

    expect(response.headers.vary).toBe('Accept-Encoding, Origin');
  });

  it('preserves wildcard Vary responses without appending Origin', async () => {
    const middleware = createCorsMiddleware({
      allowOrigin: ['https://app.example.com'],
    });
    const response = createResponse();
    response.setHeader('Vary', '*, Accept-Encoding');

    await middleware.handle(
      {
        request: createRequest('GET', 'https://app.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {},
    );

    expect(response.headers.Vary).toBe('*');
  });

  it('does not emit allow-origin for unlisted origins while continuing the request', async () => {
    const middleware = createCorsMiddleware({
      allowOrigin: ['https://trusted.example.com'],
    });
    const response = createResponse();
    let reachedNext = false;

    await middleware.handle(
      {
        request: createRequest('GET', 'https://evil.example.com'),
        requestContext: {} as never,
        response,
      },
      async () => {
        reachedNext = true;
      },
    );

    expect(reachedNext).toBe(true);
    expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(response.headers.Vary).toBe('Origin');
  });
});
