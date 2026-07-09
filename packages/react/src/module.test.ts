import { Inject, Module, Scope } from '@fluojs/core';
import {
  Controller,
  Get,
  RouteConflictError,
  UseGuards,
  UseInterceptors,
  Version,
  type CallHandler,
  type FrameworkRequest,
  type FrameworkResponse,
  type GuardContext,
  type InterceptorContext,
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
    },
  };
}

describe('ReactModule', () => {
  it('dispatches React routers through imported providers and request scope when registered with forRoot', async () => {
    class DashboardPresenter {
      render(requestInstanceId: number) {
        return { page: 'dashboard', requestInstanceId };
      }
    }

    @Scope('request')
    class RequestMarker {
      private static nextId = 0;
      readonly id = ++RequestMarker.nextId;
    }

    @Module({
      exports: [DashboardPresenter],
      providers: [DashboardPresenter],
    })
    class DashboardDomainModule {}

    @Inject(DashboardPresenter, RequestMarker)
    @Scope('request')
    @Router('/dashboard')
    class DashboardRouter {
      constructor(
        private readonly presenter: DashboardPresenter,
        private readonly marker: RequestMarker,
      ) {}

      @Path('/')
      index() {
        return this.presenter.render(this.marker.id);
      }
    }

    @Module({
      imports: [
        ReactModule.forRoot({
          controllers: [DashboardRouter],
          imports: [DashboardDomainModule],
          providers: [RequestMarker],
        }),
      ],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const firstResponse = createResponse();
      await app.dispatch(createRequest('/dashboard'), firstResponse);
      const secondResponse = createResponse();
      await app.dispatch(createRequest('/dashboard'), secondResponse);

      expect(firstResponse.body).toEqual({ page: 'dashboard', requestInstanceId: 1 });
      expect(secondResponse.body).toEqual({ page: 'dashboard', requestInstanceId: 2 });
    } finally {
      await app.close();
    }
  });

  it('dispatches ordinary HTTP controllers and React routers from the same application', async () => {
    @Controller('/api')
    class ApiController {
      @Get('/status')
      status() {
        return { kind: 'api' };
      }
    }

    @Router('/pages')
    class MarketingRouter {
      @Path('/home')
      home() {
        return { kind: 'react' };
      }
    }

    @Module({
      controllers: [ApiController],
      imports: [ReactModule.forRoot({ controllers: [MarketingRouter] })],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const apiResponse = createResponse();
      await app.dispatch(createRequest('/api/status'), apiResponse);
      const pageResponse = createResponse();
      await app.dispatch(createRequest('/pages/home'), pageResponse);

      expect(apiResponse.body).toEqual({ kind: 'api' });
      expect(pageResponse.body).toEqual({ kind: 'react' });
    } finally {
      await app.close();
    }
  });

  it('preserves module middleware, guards, interceptors, and versioned HTTP routing', async () => {
    class ReactTraceMiddleware {
      async handle(context: MiddlewareContext, next: Next): Promise<void> {
        context.response.setHeader('x-react-module', 'middleware');
        await next();
      }
    }

    class AllowGuard {
      canActivate(context: GuardContext) {
        context.requestContext.response.setHeader('x-react-guard', 'allowed');
        return true;
      }
    }

    class PageInterceptor {
      async intercept(_context: InterceptorContext, next: CallHandler) {
        const result = await next.handle();

        if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
          return { ...result, intercepted: true };
        }

        return result;
      }
    }

    @Version('2')
    @UseGuards(AllowGuard)
    @UseInterceptors(PageInterceptor)
    @Router('/dashboard')
    class DashboardRouter {
      @Path('/')
      index() {
        return { page: 'dashboard' };
      }
    }

    @Module({
      imports: [
        ReactModule.forRoot({
          controllers: [DashboardRouter],
          middleware: [ReactTraceMiddleware],
          providers: [AllowGuard, PageInterceptor],
        }),
      ],
    })
    class AppModule {}

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const response = createResponse();
      await app.dispatch(createRequest('/v2/dashboard'), response);

      expect(response.headers['x-react-module']).toBe('middleware');
      expect(response.headers['x-react-guard']).toBe('allowed');
      expect(response.body).toEqual({ intercepted: true, page: 'dashboard' });
    } finally {
      await app.close();
    }
  });

  it('uses the existing HTTP duplicate route behavior for React router conflicts', async () => {
    @Controller('/conflict')
    class ApiController {
      @Get('/')
      index() {
        return { kind: 'api' };
      }
    }

    @Router('/conflict')
    class ConflictingReactRouter {
      @Path('/')
      index() {
        return { kind: 'react' };
      }
    }

    @Module({
      controllers: [ApiController],
      imports: [ReactModule.forRoot({ controllers: [ConflictingReactRouter] })],
    })
    class AppModule {}

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(RouteConflictError);
  });
});
