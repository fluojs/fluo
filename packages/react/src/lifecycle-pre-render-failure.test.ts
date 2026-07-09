import { Module } from '@fluojs/core';
import {
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type FrameworkRequest,
  type FrameworkResponse,
  type Guard,
  type Interceptor,
  type InterceptorContext,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';
import { createReactServerEntry } from './server-entry.js';

type TestResponse = FrameworkResponse & { body?: unknown };

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): TestResponse {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
  };
}

describe('React page pre-render HTTP failures', () => {
  it('preserves the ordinary HTTP 403 error response when a guard denies before React rendering', async () => {
    const events: string[] = [];
    let renderAttempts = 0;

    class DenyGuard implements Guard {
      canActivate() {
        events.push('guard');
        return false;
      }
    }

    function GuardedPage() {
      renderAttempts += 1;
      return createElement('main', null, 'guarded page');
    }

    @UseGuards(DenyGuard)
    @Router('/guarded')
    class GuardedRouter {
      @Path('/')
      show() {
        events.push('handler');
        return createReactServerEntry(createElement(GuardedPage), {
          headers: { 'x-react-entry': 'guarded' },
        });
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [GuardedRouter], providers: [DenyGuard] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a React page route would render HTML if its guard allowed the request.
      const response = createResponse();

      // When: the guard denies before the page handler can return a React entry.
      await app.dispatch(createRequest('/guarded'), response);

      // Then: the HTTP dispatcher writes the canonical guard error and never starts React rendering.
      expect(response.statusCode).toBe(403);
      expect(response.headers['Content-Type']).toBeUndefined();
      expect(response.headers['x-react-entry']).toBeUndefined();
      expect(response.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          details: undefined,
          message: 'Access denied.',
          meta: undefined,
          requestId: undefined,
          status: 403,
        },
      });
      expect(events).toEqual(['guard']);
      expect(renderAttempts).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('preserves the ordinary HTTP 500 error response when an interceptor fails before React rendering', async () => {
    const events: string[] = [];
    let renderAttempts = 0;

    class FailingInterceptor implements Interceptor {
      intercept(_context: InterceptorContext, _next: CallHandler): never {
        events.push('interceptor');
        throw new Error('React page pre-render interceptor failed.');
      }
    }

    function InterceptedPage() {
      renderAttempts += 1;
      return createElement('main', null, 'intercepted page');
    }

    @UseInterceptors(FailingInterceptor)
    @Router('/intercepted')
    class InterceptedRouter {
      @Path('/')
      show() {
        events.push('handler');
        return createReactServerEntry(createElement(InterceptedPage), {
          headers: { 'x-react-entry': 'intercepted' },
        });
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [InterceptedRouter], providers: [FailingInterceptor] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a React page route would render HTML if its interceptor continued to the handler.
      const response = createResponse();

      // When: the interceptor throws before calling the handler.
      await app.dispatch(createRequest('/intercepted'), response);

      // Then: the HTTP dispatcher writes the canonical server error and never starts React rendering.
      expect(response.statusCode).toBe(500);
      expect(response.headers['Content-Type']).toBeUndefined();
      expect(response.headers['x-react-entry']).toBeUndefined();
      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          details: undefined,
          message: 'Internal server error.',
          meta: undefined,
          requestId: undefined,
          status: 500,
        },
      });
      expect(events).toEqual(['interceptor']);
      expect(renderAttempts).toBe(0);
    } finally {
      await app.close();
    }
  });
});
