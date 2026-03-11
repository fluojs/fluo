import { describe, expect, it } from 'vitest';

import { Container } from '@konekti-internal/di';

import type { FrameworkRequest, FrameworkResponse, InterceptorContext, MiddlewareContext } from '@konekti/http';
import {
  createDispatcher,
  createHandlerMapping,
  Controller,
  Get,
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

    class HealthController {
      getHealth(_input: unknown, ctx: ReturnType<typeof assertRequestContext>) {
        events.push('handler');
        return {
          currentRequestId: getCurrentRequestContext()?.requestId,
          id: ctx.request.params.id,
          ok: true,
        };
      }
    }
    Controller('/health')(HealthController);
    Get('/:id')(HealthController.prototype, 'getHealth');
    UseGuard(HealthGuard)(
      HealthController.prototype,
      'getHealth',
      Object.getOwnPropertyDescriptor(HealthController.prototype, 'getHealth')!,
    );
    UseInterceptor(HealthInterceptor)(
      HealthController.prototype,
      'getHealth',
      Object.getOwnPropertyDescriptor(HealthController.prototype, 'getHealth')!,
    );

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

    class SecureController {
      getSecure() {
        return { ok: true };
      }
    }
    Controller('/secure')(SecureController);
    Get('/resource')(SecureController.prototype, 'getSecure');
    UseGuard(
      DenyGuard,
    )(SecureController.prototype, 'getSecure', Object.getOwnPropertyDescriptor(SecureController.prototype, 'getSecure')!);

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

    class SecureController {
      getSecure() {
        events.push('handler');
        return { ok: true };
      }
    }

    Controller('/secure')(SecureController);
    Get('/login')(SecureController.prototype, 'getSecure');
    UseGuard(
      RedirectGuard,
    )(SecureController.prototype, 'getSecure', Object.getOwnPropertyDescriptor(SecureController.prototype, 'getSecure')!);

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

    class ErrorController {
      fail() {
        throw new Error('boom');
      }
    }
    Controller('/errors')(ErrorController);
    Get('/boom')(ErrorController.prototype, 'fail');
    UseGuard(PassGuard)(ErrorController.prototype, 'fail', Object.getOwnPropertyDescriptor(ErrorController.prototype, 'fail')!);
    UseInterceptor(
      PassInterceptor,
    )(ErrorController.prototype, 'fail', Object.getOwnPropertyDescriptor(ErrorController.prototype, 'fail')!);

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
});
