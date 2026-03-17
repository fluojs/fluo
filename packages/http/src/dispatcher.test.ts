import { describe, expect, it } from 'vitest';

import { Container } from '@konekti/di';

import type {
  FrameworkRequest,
  FrameworkResponse,
  InterceptorContext,
  Middleware,
  MiddlewareContext,
  Next,
  RequestObservationContext,
} from '@konekti/http';
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
import { IsString, MinLength, ValidateNested } from '@konekti/dto-validator';

import { forRoutes, runMiddlewareChain } from './middleware.js';

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

function createRequest(
  path: string,
  method = 'GET',
  headers: FrameworkRequest['headers'] = {},
): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers,
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('dispatcher runtime', () => {
  describe('runMiddlewareChain with forRoutes filtering', () => {
    it('runs middleware with matching forRoutes path', async () => {
      const events: string[] = [];

      class LogMW implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('log');
          await next();
        }
      }

      const container = new Container();
      container.register(LogMW);
      const requestContext = { container } as any;
      const context = {
        request: createRequest('/cats'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      const config = forRoutes(LogMW, '/cats');
      await runMiddlewareChain([config], context, async () => {
        events.push('handler');
      });

      expect(events).toEqual(['log', 'handler']);
    });

    it('skips middleware with non-matching forRoutes path', async () => {
      const events: string[] = [];

      class LogMW implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('log');
          await next();
        }
      }

      const container = new Container();
      container.register(LogMW);
      const requestContext = { container } as any;
      const context = {
        request: createRequest('/dogs'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      const config = forRoutes(LogMW, '/cats');
      await runMiddlewareChain([config], context, async () => {
        events.push('handler');
      });

      expect(events).toEqual(['handler']);
    });

    it('supports wildcard in forRoutes', async () => {
      const events: string[] = [];

      class LogMW implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('log');
          await next();
        }
      }

      const container = new Container();
      container.register(LogMW);
      const requestContext = { container } as any;
      const context = {
        request: createRequest('/cats/123'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      const config = forRoutes(LogMW, '/cats/*');
      await runMiddlewareChain([config], context, async () => {
        events.push('handler');
      });

      expect(events).toEqual(['log', 'handler']);
    });

    it('preserves middleware order with mixed forRoutes and unfiltered', async () => {
      const events: string[] = [];

      class MwA implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('A');
          await next();
        }
      }

      class MwB implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('B');
          await next();
        }
      }

      class MwC implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('C');
          await next();
        }
      }

      const container = new Container();
      container.register(MwA);
      container.register(MwB);
      container.register(MwC);
      const requestContext = { container } as any;
      const definitions = [MwA, forRoutes(MwB, '/cats'), MwC];

      const catsCtx = {
        request: createRequest('/cats'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      await runMiddlewareChain(definitions, catsCtx, async () => {
        events.push('handler');
      });
      expect(events).toEqual(['A', 'B', 'C', 'handler']);

      events.length = 0;
      const dogsCtx = {
        request: createRequest('/dogs'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      await runMiddlewareChain(definitions, dogsCtx, async () => {
        events.push('handler');
      });
      expect(events).toEqual(['A', 'C', 'handler']);
    });

    it('treats empty routes array as match-all', async () => {
      const events: string[] = [];

      class LogMW implements Middleware {
        async handle(_ctx: MiddlewareContext, next: Next) {
          events.push('log');
          await next();
        }
      }

      const container = new Container();
      container.register(LogMW);
      const requestContext = { container } as any;
      const context = {
        request: createRequest('/anything'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      const config = forRoutes(LogMW);
      await runMiddlewareChain([config], context, async () => {
        events.push('handler');
      });

      expect(events).toEqual(['log', 'handler']);
    });
  });

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
    await dispatcher.dispatch(createRequest('/health/123', 'GET', { 'x-request-id': 'req-health-123' }), response);

    expect(response.body).toEqual({
      currentRequestId: 'req-health-123',
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

  it('notifies request observers across start, match, success, error, and finish seams', async () => {
    const events: string[] = [];

    class RequestLogger {
      onHandlerMatched(context: RequestObservationContext) {
        events.push(`match:${context.handler?.methodName}`);
      }

      onRequestError(context: RequestObservationContext) {
        events.push(`error:${context.requestContext.requestId ?? 'none'}`);
      }

      onRequestFinish(context: RequestObservationContext) {
        events.push(`finish:${context.requestContext.request.path}`);
      }

      onRequestStart(context: RequestObservationContext) {
        events.push(`start:${context.requestContext.requestId ?? 'none'}`);
      }

      onRequestSuccess(context: RequestObservationContext, value: unknown) {
        events.push(`success:${context.handler?.methodName}:${String((value as { ok?: boolean }).ok)}`);
      }
    }

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }

      @Get('/boom')
      fail() {
        throw new Error('boom');
      }
    }

    const root = new Container().register(RequestLogger, HealthController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: HealthController }]),
      observers: [RequestLogger],
      rootContainer: root,
    });

    const successResponse = createResponse();
    await dispatcher.dispatch(createRequest('/health', 'GET', { 'x-request-id': 'req-observer-1' }), successResponse);

    const errorResponse = createResponse();
    await dispatcher.dispatch(createRequest('/health/boom', 'GET', { 'x-request-id': 'req-observer-2' }), errorResponse);

    expect(events).toEqual([
      'start:req-observer-1',
      'match:getHealth',
      'success:getHealth:true',
      'finish:/health',
      'start:req-observer-2',
      'match:fail',
      'error:req-observer-2',
      'finish:/health/boom',
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

  it('continues handler execution when a guard returns true explicitly', async () => {
    class PassGuard {
      canActivate() {
        return true;
      }
    }

    @Controller('/secure')
    class SecureController {
      @Get('/resource')
      @UseGuard(PassGuard)
      getSecure() {
        return { ok: true };
      }
    }

    const root = new Container().register(PassGuard, SecureController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: SecureController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/secure/resource'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
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

    await dispatcher.dispatch(createRequest('/errors/boom', 'GET', { 'x-request-id': 'req-boom-1' }), response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        details: undefined,
        message: 'Internal server error.',
        meta: undefined,
        requestId: 'req-boom-1',
        status: 500,
      },
    });
  });

  it('binds a request DTO and returns canonical validation errors for bad input', async () => {
    class CreateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'name is required' })
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
        headers: { 'x-request-id': 'req-users-400' },
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
        requestId: 'req-users-400',
        status: 400,
      },
    });
  });

  it('returns nested validation field paths through the canonical error envelope', async () => {
    class AddressDto {
      @MinLength(1, { code: 'REQUIRED_CITY', message: 'city is required' })
      city = '';
    }

    class CreateProfileRequest {
      @FromBody('address')
      @ValidateNested(() => AddressDto)
      address = new AddressDto();
    }

    @Controller('/profiles')
    class ProfilesController {
      @RequestDto(CreateProfileRequest)
      @Post('/')
      createProfile(input: CreateProfileRequest) {
        return input;
      }
    }

    const root = new Container().register(ProfilesController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ProfilesController }]),
      rootContainer: root,
    });
    const errorResponse = createResponse();

    await dispatcher.dispatch(
      {
        body: { address: { city: '' } },
        cookies: {},
        headers: { 'x-request-id': 'req-profiles-400' },
        method: 'POST',
        params: {},
        path: '/profiles',
        query: {},
        raw: {},
        url: '/profiles',
      },
      errorResponse,
    );

    expect(errorResponse.statusCode).toBe(400);
    expect(errorResponse.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [
          {
            code: 'REQUIRED_CITY',
            field: 'address.city',
            message: 'city is required',
            source: 'body',
          },
        ],
        message: 'Validation failed.',
        meta: undefined,
        requestId: 'req-profiles-400',
        status: 400,
      },
    });
  });

  describe('E2E: class middleware with DI and forRoutes', () => {
    it('resolves class middleware dependency from DI and runs on matching route', async () => {
      const events: string[] = [];

      class Logger {
        calls: string[] = [];

        log(message: string) {
          this.calls.push(message);
        }
      }

      class AuditMiddleware implements Middleware {
        constructor(private logger: Logger) {}

        async handle(context: MiddlewareContext, next: Next) {
          this.logger.log(`audit:${context.request.path}`);
          events.push('audit');
          await next();
        }
      }

      const container = new Container();
      container.register(Logger, { inject: [Logger], provide: AuditMiddleware, useClass: AuditMiddleware });
      const requestContext = { container } as any;
      const context = {
        request: createRequest('/cats'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;

      await runMiddlewareChain([forRoutes(AuditMiddleware, '/cats')], context, async () => {
        events.push('handler');
      });

      const logger = await container.resolve(Logger);
      expect(events).toEqual(['audit', 'handler']);
      expect(logger.calls).toEqual(['audit:/cats']);
    });

    it('skips class middleware when forRoutes path does not match', async () => {
      const events: string[] = [];

      class Logger {
        calls: string[] = [];

        log(message: string) {
          this.calls.push(message);
        }
      }

      class AuditMiddleware implements Middleware {
        constructor(private logger: Logger) {}

        async handle(context: MiddlewareContext, next: Next) {
          this.logger.log(`audit:${context.request.path}`);
          events.push('audit');
          await next();
        }
      }

      const container = new Container();
      container.register(Logger, { inject: [Logger], provide: AuditMiddleware, useClass: AuditMiddleware });
      const requestContext = { container } as any;
      const context = {
        request: createRequest('/dogs'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;

      await runMiddlewareChain([forRoutes(AuditMiddleware, '/cats')], context, async () => {
        events.push('handler');
      });

      const logger = await container.resolve(Logger);
      expect(events).toEqual(['handler']);
      expect(logger.calls).toEqual([]);
    });

    it('runs mixed DI middleware chain in order and skips forRoutes middleware on non-matching route', async () => {
      const events: string[] = [];

      class Logger {
        calls: string[] = [];

        log(message: string) {
          this.calls.push(message);
        }
      }

      class MwA implements Middleware {
        constructor(private logger: Logger) {}

        async handle(context: MiddlewareContext, next: Next) {
          this.logger.log(`A:${context.request.path}`);
          events.push('A');
          await next();
        }
      }

      class MwB implements Middleware {
        constructor(private logger: Logger) {}

        async handle(context: MiddlewareContext, next: Next) {
          this.logger.log(`B:${context.request.path}`);
          events.push('B');
          await next();
        }
      }

      class MwC implements Middleware {
        constructor(private logger: Logger) {}

        async handle(context: MiddlewareContext, next: Next) {
          this.logger.log(`C:${context.request.path}`);
          events.push('C');
          await next();
        }
      }

      const container = new Container();
      container.register(
        Logger,
        { inject: [Logger], provide: MwA, useClass: MwA },
        { inject: [Logger], provide: MwB, useClass: MwB },
        { inject: [Logger], provide: MwC, useClass: MwC },
      );
      const requestContext = { container } as any;
      const definitions = [MwA, forRoutes(MwB, '/cats'), MwC];

      const catsContext = {
        request: createRequest('/cats'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      await runMiddlewareChain(definitions, catsContext, async () => {
        events.push('handler');
      });

      const logger = await container.resolve(Logger);
      expect(events).toEqual(['A', 'B', 'C', 'handler']);
      expect(logger.calls).toEqual(['A:/cats', 'B:/cats', 'C:/cats']);

      events.length = 0;
      logger.calls.length = 0;

      const dogsContext = {
        request: createRequest('/dogs'),
        requestContext,
        response: createResponse(),
      } as MiddlewareContext;
      await runMiddlewareChain(definitions, dogsContext, async () => {
        events.push('handler');
      });

      expect(events).toEqual(['A', 'C', 'handler']);
      expect(logger.calls).toEqual(['A:/dogs', 'C:/dogs']);
    });
  });
});
