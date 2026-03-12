import { describe, expect, it } from 'vitest';

import { Container } from '@konekti-internal/di';

import type { FrameworkRequest, FrameworkResponse, InterceptorContext, MiddlewareContext } from '@konekti/http';
import {
  FromBody,
  createDispatcher,
  createHandlerMapping,
  Controller,
  Get,
  Post,
  RequestDto,
  SuccessStatus,
  UseGuard,
  UseInterceptor,
  assertRequestContext,
  getCurrentRequestContext,
} from '@konekti/http';

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

function createRequest(path: string, method = 'GET'): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('dispatcher runtime', () => {
  it('dispatches a GET route through middleware, guards, interceptors, and controller', async () => {
    const events: string[] = [];

    class AppMiddleware {
      async handle(_context: MiddlewareContext, next: () => Promise<void>) {
        events.push('app:before');
        await next();
        events.push('app:after');
      }
    }

    class ModuleMiddleware {
      async handle(_context: MiddlewareContext, next: () => Promise<void>) {
        events.push('module:before');
        await next();
        events.push('module:after');
      }
    }

    class HealthGuard {
      canActivate() {
        events.push('guard');
      }
    }

    class HealthInterceptor {
      async intercept(_context: InterceptorContext, next: { handle(): Promise<unknown> }) {
        events.push('interceptor:before');
        const result = await next.handle();
        events.push('interceptor:after');
        return result;
      }
    }

    @Controller('/health')
    class HealthController {
      @Get('/:id')
      @UseGuard(HealthGuard)
      @UseInterceptor(HealthInterceptor)
      getHealth(_input: unknown, ctx: ReturnType<typeof assertRequestContext>) {
        events.push('handler');
        return {
          currentRequestId: getCurrentRequestContext()?.requestId,
          id: ctx.request.params.id,
          ok: true,
        };
      }
    }

    const root = new Container().register(AppMiddleware, ModuleMiddleware, HealthGuard, HealthInterceptor, HealthController);
    const dispatcher = createDispatcher({
      appMiddleware: [AppMiddleware],
      handlerMapping: createHandlerMapping([
        {
          controllerToken: HealthController,
          moduleMiddleware: [ModuleMiddleware],
        },
      ]),
      rootContainer: root,
    });

    const response = createResponse();
    await dispatcher.dispatch(createRequest('/health/123'), response);

    expect(response.body).toEqual({
      currentRequestId: undefined,
      id: '123',
      ok: true,
    });
    expect(events).toEqual([
      'app:before',
      'module:before',
      'guard',
      'interceptor:before',
      'handler',
      'interceptor:after',
      'module:after',
      'app:after',
    ]);
  });

  it('returns a canonical 403 response when a guard denies the request', async () => {
    class DenyGuard {
      canActivate() {
        return false;
      }
    }

    @Controller('/secure')
    class SecureController {
      @Get('/resource')
      @UseGuard(DenyGuard)
      getSecure() {
        return { ok: true };
      }
    }

    const root = new Container().register(DenyGuard, SecureController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: SecureController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/secure/resource'), response);

    expect(response.statusCode).toBe(403);
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
  });

  it('short-circuits handler execution when a guard commits redirect response', async () => {
    const events: string[] = [];

    class RedirectGuard {
      canActivate({ requestContext }: { requestContext: { response: FrameworkResponse } }) {
        events.push('guard');
        requestContext.response.redirect(302, 'https://accounts.example.com/oauth2/auth');
      }
    }

    @Controller('/secure')
    class SecureController {
      @Get('/login')
      @UseGuard(RedirectGuard)
      getSecure() {
        events.push('handler');
        return { ok: true };
      }
    }

    const root = new Container().register(RedirectGuard, SecureController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: SecureController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/secure/login'), response);

    expect(events).toEqual(['guard']);
    expect(response.statusCode).toBe(302);
    expect(response.headers.Location).toBe('https://accounts.example.com/oauth2/auth');
  });

  it('propagates handler errors through the canonical error response path', async () => {
    class PassGuard {
      canActivate() {}
    }

    class PassInterceptor {
      intercept(_context: InterceptorContext, next: { handle(): Promise<unknown> }) {
        return next.handle();
      }
    }

    @Controller('/errors')
    class ErrorController {
      @Get('/boom')
      @UseGuard(PassGuard)
      @UseInterceptor(PassInterceptor)
      fail() {
        throw new Error('boom');
      }
    }

    const root = new Container().register(PassGuard, PassInterceptor, ErrorController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ErrorController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/errors/boom'), response);

    expect(response.statusCode).toBe(500);
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
  });

  it('binds a request DTO and returns canonical validation errors for bad input', async () => {
    class CreateUserRequest {
      static validate(value: CreateUserRequest) {
        if (value.name.length > 0) {
          return [];
        }

        return [
          {
            code: 'REQUIRED',
            field: 'name',
            message: 'name is required',
            source: 'body' as const,
          },
        ];
      }

      @FromBody('name')
      name = '';
    }

    @Controller('/users')
    class UsersController {
      @RequestDto(CreateUserRequest)
      @SuccessStatus(201)
      @Post('/')
      createUser(input: CreateUserRequest) {
        return {
          name: input.name,
        };
      }
    }
    const root = new Container().register(UsersController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: UsersController }]),
      rootContainer: root,
    });

    const successResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: 'Ada' },
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/users',
        query: {},
        raw: {},
        url: '/users',
      },
      successResponse,
    );

    expect(successResponse.statusCode).toBe(201);
    expect(successResponse.body).toEqual({ name: 'Ada' });

    const errorResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: '' },
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/users',
        query: {},
        raw: {},
        url: '/users',
      },
      errorResponse,
    );

    expect(errorResponse.statusCode).toBe(400);
    expect(errorResponse.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [
          {
            code: 'REQUIRED',
            field: 'name',
            message: 'name is required',
            source: 'body',
          },
        ],
        message: 'Validation failed.',
        meta: undefined,
        requestId: undefined,
        status: 400,
      },
    });
  });
});
