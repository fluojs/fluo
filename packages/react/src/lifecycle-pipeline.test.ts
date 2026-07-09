import { Inject, Module, Scope } from '@fluojs/core';
import {
  Controller,
  FromPath,
  Get,
  InvalidRoutePathError,
  RequestDto,
  RouteConflictError,
  UseGuards,
  UseInterceptors,
  Version,
  type CallHandler,
  type FrameworkRequest,
  type FrameworkResponse,
  type Guard,
  type GuardContext,
  type Interceptor,
  type InterceptorContext,
  type Middleware,
  type MiddlewareContext,
  type Next,
} from '@fluojs/http';
import { bootstrapApplication } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { Path, Router } from './decorators.js';
import { ReactModule } from './module.js';

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

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

describe('React page HTTP lifecycle pipeline', () => {
  it('preserves middleware, guard, interceptor, and URI versioning order', async () => {
    const events: string[] = [];

    class TraceMiddleware implements Middleware {
      async handle(context: MiddlewareContext, next: Next): Promise<void> {
        events.push(`middleware:${context.request.path}`);
        context.response.setHeader('x-react-middleware', 'ran');
        await next();
      }
    }

    class AllowGuard implements Guard {
      canActivate(context: GuardContext) {
        events.push(`guard:${context.requestContext.request.path}`);
        context.requestContext.response.setHeader('x-react-guard', 'allowed');
        return true;
      }
    }

    class PageInterceptor implements Interceptor {
      async intercept(_context: InterceptorContext, next: CallHandler) {
        events.push('interceptor:before');
        const value = await next.handle();
        events.push('interceptor:after');

        return { intercepted: true, value };
      }
    }

    @Version('2')
    @UseGuards(AllowGuard)
    @UseInterceptors(PageInterceptor)
    @Router('/pages')
    class PageRouter {
      @Path('/home')
      home() {
        events.push('handler');
        return { page: 'home' };
      }
    }

    @Module({
      imports: [
        ReactModule.forRoot({
          controllers: [PageRouter],
          middleware: [TraceMiddleware],
          providers: [AllowGuard, PageInterceptor],
        }),
      ],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: a versioned React page route has module middleware, guards, and interceptors.
      const response = createResponse();

      // When: the HTTP dispatcher handles the version-prefixed page route.
      await app.dispatch(createRequest('/v2/pages/home'), response);

      // Then: the normal HTTP lifecycle surrounds the React page handler.
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-react-middleware']).toBe('ran');
      expect(response.headers['x-react-guard']).toBe('allowed');
      expect(response.body).toEqual({ intercepted: true, value: { page: 'home' } });
      expect(events).toEqual([
        'middleware:/v2/pages/home',
        'guard:/v2/pages/home',
        'interceptor:before',
        'handler',
        'interceptor:after',
      ]);
    } finally {
      await app.close();
    }
  });

  it('keeps request-scoped React page providers isolated across concurrent requests', async () => {
    const firstRequestGate = createDeferred();
    const firstHandlerStarted = createDeferred();
    const secondHandlerStarted = createDeferred();

    class ScopedPageRequest {
      @FromPath('label')
      label = '';
    }

    @Scope('request')
    class RequestStore {
      private static nextId = 0;
      readonly id = ++RequestStore.nextId;
      readonly labels: string[] = [];
    }

    @Inject(RequestStore)
    @Scope('request')
    @Router('/scope')
    class ScopedPageRouter {
      constructor(private readonly store: RequestStore) {}

      @Path('/:label')
      @RequestDto(ScopedPageRequest)
      async show(input: ScopedPageRequest) {
        this.store.labels.push(input.label);

        if (input.label === 'second') {
          secondHandlerStarted.resolve();
        }

        if (input.label === 'first') {
          firstHandlerStarted.resolve();
          await firstRequestGate.promise;
        }

        return { id: this.store.id, labels: [...this.store.labels] };
      }
    }

    @Module({
      imports: [ReactModule.forRoot({ controllers: [ScopedPageRouter], providers: [RequestStore] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: one React page request is held open while a second request starts.
      const firstResponse = createResponse();
      const firstDispatch = app.dispatch(createRequest('/scope/first'), firstResponse);
      await firstHandlerStarted.promise;
      const secondResponse = createResponse();
      const secondDispatch = app.dispatch(createRequest('/scope/second'), secondResponse);
      await secondHandlerStarted.promise;

      // When: both in-flight dispatches settle.
      firstRequestGate.resolve();
      await Promise.all([firstDispatch, secondDispatch]);

      // Then: each request observes a distinct request-scoped provider instance.
      expect(firstResponse.body).toEqual({ id: 1, labels: ['first'] });
      expect(secondResponse.body).toEqual({ id: 2, labels: ['second'] });
    } finally {
      await app.close();
    }
  });

  it('dispatches ordinary HTTP controllers and React routers from the same app', async () => {
    @Controller('/api')
    class ApiController {
      @Get('/status')
      status() {
        return { kind: 'api' };
      }
    }

    @Router('/pages')
    class PageRouter {
      @Path('/status')
      status() {
        return { kind: 'react' };
      }
    }

    @Module({
      controllers: [ApiController],
      imports: [ReactModule.forRoot({ controllers: [PageRouter] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      // Given: one app graph contains both ordinary controllers and React routers.
      const apiResponse = createResponse();
      const pageResponse = createResponse();

      // When: both routes are dispatched through the runtime.
      await app.dispatch(createRequest('/api/status'), apiResponse);
      await app.dispatch(createRequest('/pages/status'), pageResponse);

      // Then: both handler types are present in the same HTTP route table.
      expect(apiResponse.body).toEqual({ kind: 'api' });
      expect(pageResponse.body).toEqual({ kind: 'react' });
    } finally {
      await app.close();
    }
  });

  it('reuses HTTP route conflict detection for React routers', async () => {
    @Controller('/conflict')
    class ApiController {
      @Get('/')
      index() {
        return { kind: 'api' };
      }
    }

    @Router('/conflict')
    class PageRouter {
      @Path('/')
      index() {
        return { kind: 'react' };
      }
    }

    @Module({
      controllers: [ApiController],
      imports: [ReactModule.forRoot({ controllers: [PageRouter] })],
    })
    class AppModule {}

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(RouteConflictError);
  });

  it('rejects invalid React route grammar through HTTP route validation', () => {
    expect(() => Router('/files/*')).toThrow(InvalidRoutePathError);
    expect(() => Path('/files/:id.json')).toThrow(InvalidRoutePathError);
    expect(() => Path('/files?')).toThrow(InvalidRoutePathError);
    expect(() => Path('/(.*)')).toThrow(InvalidRoutePathError);
  });
});
