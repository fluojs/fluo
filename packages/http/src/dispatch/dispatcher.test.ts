import { describe, expect, it } from 'vitest';

import { Container } from '@fluojs/di';

import type {
  FrameworkRequest,
  FrameworkResponse,
  InterceptorContext,
  Middleware,
  MiddlewareContext,
  Next,
  RequestObservationContext,
} from '@fluojs/http';
import {
  Convert,
  FromBody,
  FromQuery,
  createCorrelationMiddleware,
  createDispatcher,
  createHandlerMapping,
  Controller,
  Get,
  Post,
  Produces,
  RequestDto,
  SseResponse,
  HttpCode,
  Header,
  Redirect,
  UseGuards,
  UseInterceptors,
  type assertRequestContext,
  getCurrentRequestContext,
} from '@fluojs/http';
import { IsNumber, IsString, MinLength, ValidateNested } from '@fluojs/validation';

import { IntersectionType, OmitType, PartialType, PickType } from '@fluojs/validation';
import { forRoutes, runMiddlewareChain } from '../middleware/middleware.js';

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
  it('keeps JSON response behavior when no formatters are configured', async () => {
    @Controller('/negotiation')
    class NegotiationController {
      @Get('/default')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(NegotiationController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: NegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/negotiation/default', 'GET', { accept: 'text/plain' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['Content-Type']).toBeUndefined();
  });

  it('selects formatter by Accept header when content negotiation is configured', async () => {
    @Controller('/negotiation')
    class NegotiationController {
      @Produces('application/json', 'text/plain')
      @Get('/formatted')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(NegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
          {
            format(body) {
              return `plain:${JSON.stringify(body)}`;
            },
            mediaType: 'text/plain',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: NegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/negotiation/formatted', 'GET', { accept: 'text/plain' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/plain');
    expect(response.body).toBe('plain:{"ok":true}');
  });

  it('returns 406 when Accept does not match available formatters', async () => {
    @Controller('/negotiation')
    class NegotiationController {
      @Produces('application/json')
      @Get('/json-only')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(NegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: NegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/negotiation/json-only', 'GET', { accept: 'text/plain' }), response);

    expect(response.statusCode).toBe(406);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_ACCEPTABLE',
        details: undefined,
        message: 'No acceptable response representation found.',
        meta: undefined,
        requestId: undefined,
        status: 406,
      },
    });
  });

  it('returns 406 when Accept tokens are all q=0', async () => {
    @Controller('/negotiation')
    class NegotiationController {
      @Produces('application/json', 'text/plain')
      @Get('/q-zero')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(NegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
          {
            format(body) {
              return `plain:${JSON.stringify(body)}`;
            },
            mediaType: 'text/plain',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: NegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(
      createRequest('/negotiation/q-zero', 'GET', { accept: 'application/json;q=0, text/plain;q=0' }),
      response,
    );

    expect(response.statusCode).toBe(406);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_ACCEPTABLE',
        details: undefined,
        message: 'No acceptable response representation found.',
        meta: undefined,
        requestId: undefined,
        status: 406,
      },
    });
  });

  it('does not leak @Header values onto 406 negotiation error responses', async () => {
    @Controller('/negotiation')
    class NegotiationController {
      @Header('X-Secret', 'sensitive')
      @Produces('application/json')
      @Get('/secret-header')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(NegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: NegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/negotiation/secret-header', 'GET', { accept: 'text/plain' }), response);

    expect(response.statusCode).toBe(406);
    expect((response.headers as Record<string, unknown>)['X-Secret']).toBeUndefined();
  });

  it('falls back to default formatter for wildcard Accept header', async () => {
    @Controller('/negotiation')
    class NegotiationController {
      @Produces('application/json', 'text/plain')
      @Get('/wildcard')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(NegotiationController);
    const dispatcher = createDispatcher({
      contentNegotiation: {
        defaultMediaType: 'text/plain',
        formatters: [
          {
            format(body) {
              return JSON.stringify(body);
            },
            mediaType: 'application/json',
          },
          {
            format(body) {
              return `plain:${JSON.stringify(body)}`;
            },
            mediaType: 'text/plain',
          },
        ],
      },
      handlerMapping: createHandlerMapping([{ controllerToken: NegotiationController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/negotiation/wildcard', 'GET', { accept: '*/*' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/plain');
    expect(response.body).toBe('plain:{"ok":true}');
  });

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

  it('bypasses the default success writer when a handler returns SseResponse', async () => {
    const writes: string[] = [];

    @Controller('/events')
    class EventsController {
      @Get('/')
      stream(_input: undefined, ctx: ReturnType<typeof assertRequestContext>) {
        const sse = new SseResponse(ctx);
        sse.send({ ok: true }, { event: 'ready', id: 'evt-1' });
        return sse;
      }
    }

    const root = new Container().register(EventsController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: EventsController }]),
      rootContainer: root,
    });

    const streamState = { closed: false };
    const response: FrameworkResponse & { body?: unknown } = {
      committed: false,
      headers: {},
      stream: {
        close() {
          streamState.closed = true;
        },
        get closed() {
          return streamState.closed;
        },
        write(chunk) {
          if (typeof chunk !== 'string') {
            throw new TypeError('Expected dispatcher SSE test to write string chunks.');
          }

          writes.push(chunk);
          return true;
        },
      },
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

    await dispatcher.dispatch(createRequest('/events', 'GET'), response);

    expect(response.body).toBeUndefined();
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(writes).toEqual(['event: ready\nid: evt-1\ndata: {"ok":true}\n\n']);
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
      @UseGuards(HealthGuard)
      @UseInterceptors(HealthInterceptor)
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

  it('runs global interceptors before route interceptors', async () => {
    const events: string[] = [];

    class GlobalInterceptor {
      async intercept(_context: InterceptorContext, next: { handle(): Promise<unknown> }) {
        events.push('global:before');
        const value = await next.handle();
        events.push('global:after');
        return value;
      }
    }

    class RouteInterceptor {
      async intercept(_context: InterceptorContext, next: { handle(): Promise<unknown> }) {
        events.push('route:before');
        const value = await next.handle();
        events.push('route:after');
        return value;
      }
    }

    @Controller('/interceptor-order')
    class OrderedController {
      @Get('/')
      @UseInterceptors(RouteInterceptor)
      getValue() {
        events.push('handler');
        return { ok: true };
      }
    }

    const root = new Container().register(GlobalInterceptor, RouteInterceptor, OrderedController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: OrderedController }]),
      interceptors: [GlobalInterceptor],
      rootContainer: root,
    });

    const response = createResponse();
    await dispatcher.dispatch(createRequest('/interceptor-order', 'GET'), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(events).toEqual([
      'global:before',
      'route:before',
      'handler',
      'route:after',
      'global:after',
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

  it('isolates request start and handler matched observer failures from request execution', async () => {
    const events: string[] = [];

    const observer = {
      onHandlerMatched() {
        events.push('match');
        throw new Error('match observer failed');
      },
      onRequestFinish() {
        events.push('finish');
      },
      onRequestStart() {
        events.push('start');
        throw new Error('start observer failed');
      },
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        events.push('handler');
        return { ok: true };
      }
    }

    const root = new Container().register(HealthController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: HealthController }]),
      observers: [observer],
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/health', 'GET', { 'x-request-id': 'req-observer-isolation' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(events).toEqual(['start', 'match', 'handler', 'finish']);
  });

  it('sets the correlation response header before downstream code commits the response', async () => {
    @Controller('/correlation')
    class CorrelationController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(CorrelationController);
    const dispatcher = createDispatcher({
      appMiddleware: [createCorrelationMiddleware()],
      handlerMapping: createHandlerMapping([{ controllerToken: CorrelationController }]),
      rootContainer: root,
    });
    const response = createResponse();
    response.setHeader = function setHeader(name, value) {
      if (this.committed) {
        throw new Error(`setHeader after commit: ${name}`);
      }

      this.headers[name] = value;
    };

    await dispatcher.dispatch(createRequest('/correlation', 'GET'), response);

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('passes matched handler metadata to request error observers', async () => {
    const events: string[] = [];

    class RequestLogger {
      onRequestError(context: RequestObservationContext) {
        events.push(`error:${context.handler?.methodName ?? 'none'}`);
      }
    }

    @Controller('/health')
    class HealthController {
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
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/health/boom', 'GET', { 'x-request-id': 'req-observer-handler' }), response);

    expect(response.statusCode).toBe(500);
    expect(events).toEqual(['error:fail']);
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
      @UseGuards(DenyGuard)
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
      @UseGuards(PassGuard)
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
      @UseGuards(RedirectGuard)
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
      @UseGuards(PassGuard)
      @UseInterceptors(PassInterceptor)
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
      @HttpCode(201)
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

  it('binds mapped DTO helpers through RequestDto without exposing omitted fields', async () => {
    class CreateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'name is required' })
      name = '';

      @FromBody('role')
      @IsString()
      role = 'user';
    }

    class AddressRequest {
      @FromBody('city')
      @IsString()
      city = '';
    }

    const PickedUserRequest = PickType(CreateUserRequest, ['name']);
    const OmittedUserRequest = OmitType(CreateUserRequest, ['role']);
    const CreateUserWithAddressRequest = IntersectionType(CreateUserRequest, AddressRequest);

    @Controller('/mapped')
    class MappedController {
      @RequestDto(PickedUserRequest)
      @Post('/pick')
      pick(input: InstanceType<typeof PickedUserRequest>) {
        return input;
      }

      @RequestDto(OmittedUserRequest)
      @Post('/omit')
      omit(input: InstanceType<typeof OmittedUserRequest>) {
        return input;
      }

      @RequestDto(CreateUserWithAddressRequest)
      @Post('/intersection')
      intersection(input: InstanceType<typeof CreateUserWithAddressRequest>) {
        return input;
      }
    }

    const root = new Container().register(MappedController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: MappedController }]),
      rootContainer: root,
    });

    const pickResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: 'Ada' },
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/mapped/pick',
        query: {},
        raw: {},
        url: '/mapped/pick',
      },
      pickResponse,
    );
    expect(pickResponse.statusCode).toBe(201);
    expect(pickResponse.body).toEqual({ name: 'Ada' });

    const omitResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: 'Ada' },
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/mapped/omit',
        query: {},
        raw: {},
        url: '/mapped/omit',
      },
      omitResponse,
    );
    expect(omitResponse.statusCode).toBe(201);
    expect(omitResponse.body).toEqual({ name: 'Ada' });

    const intersectionResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { city: 'Seoul', name: 'Ada', role: 'admin' },
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/mapped/intersection',
        query: {},
        raw: {},
        url: '/mapped/intersection',
      },
      intersectionResponse,
    );
    expect(intersectionResponse.statusCode).toBe(201);
    expect(intersectionResponse.body).toEqual({ city: 'Seoul', name: 'Ada', role: 'admin' });

    const pickErrorResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: 'Ada', role: 'admin' },
        cookies: {},
        headers: { 'x-request-id': 'req-mapped-pick-400' },
        method: 'POST',
        params: {},
        path: '/mapped/pick',
        query: {},
        raw: {},
        url: '/mapped/pick',
      },
      pickErrorResponse,
    );

    expect(pickErrorResponse.statusCode).toBe(400);
    expect(pickErrorResponse.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [
          {
            code: 'UNKNOWN_FIELD',
            field: 'role',
            message: 'Unknown body field role.',
            source: 'body',
          },
        ],
        message: 'Request body contains unsupported fields.',
        meta: undefined,
        requestId: 'req-mapped-pick-400',
        status: 400,
      },
    });
  });

  it('binds PartialType DTOs with optional runtime semantics', async () => {
    class UpdateUserRequest {
      @FromBody('name')
      @IsString()
      @MinLength(2, { code: 'NAME_MIN', message: 'name must be at least 2 chars' })
      name = '';

      @FromBody('email')
      @IsString()
      email = '';
    }

    const PartialUpdateUserRequest = PartialType(UpdateUserRequest);

    @Controller('/partial')
    class PartialController {
      @RequestDto(PartialUpdateUserRequest)
      @Post('/users')
      updateUser(input: InstanceType<typeof PartialUpdateUserRequest>) {
        return input;
      }
    }

    const root = new Container().register(PartialController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: PartialController }]),
      rootContainer: root,
    });

    const emptyResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: {},
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/partial/users',
        query: {},
        raw: {},
        url: '/partial/users',
      },
      emptyResponse,
    );
    expect(emptyResponse.statusCode).toBe(201);
    expect(emptyResponse.body).toEqual({});

    const partialResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: 'Ada' },
        cookies: {},
        headers: {},
        method: 'POST',
        params: {},
        path: '/partial/users',
        query: {},
        raw: {},
        url: '/partial/users',
      },
      partialResponse,
    );
    expect(partialResponse.statusCode).toBe(201);
    expect(partialResponse.body).toEqual({ name: 'Ada' });

    const validationErrorResponse = createResponse();
    await dispatcher.dispatch(
      {
        body: { name: '' },
        cookies: {},
        headers: { 'x-request-id': 'req-partial-400' },
        method: 'POST',
        params: {},
        path: '/partial/users',
        query: {},
        raw: {},
        url: '/partial/users',
      },
      validationErrorResponse,
    );

    expect(validationErrorResponse.statusCode).toBe(400);
    expect(validationErrorResponse.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [
          {
            code: 'NAME_MIN',
            field: 'name',
            message: 'name must be at least 2 chars',
            source: 'body',
          },
        ],
        message: 'Validation failed.',
        meta: undefined,
        requestId: 'req-partial-400',
        status: 400,
      },
    });
  });

  it('keeps single-element query arrays intact in RequestDto binding', async () => {
    class SearchRequest {
      @FromQuery('tag')
      tags: string[] = [];
    }

    @Controller('/search')
    class SearchController {
      @RequestDto(SearchRequest)
      @Get('/')
      search(input: SearchRequest) {
        return input;
      }
    }

    const root = new Container().register(SearchController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: SearchController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(
      {
        body: undefined,
        cookies: {},
        headers: {},
        method: 'GET',
        params: {},
        path: '/search',
        query: { tag: ['one'] },
        raw: {},
        url: '/search?tag=one',
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ tags: ['one'] });
  });

  it('converts request values before validation in RequestDto flow', async () => {
    class ParseIntConverter {
      convert(value: unknown) {
        return typeof value === 'string' ? Number(value) : value;
      }
    }

    class SearchRequest {
      @FromQuery('id')
      @Convert(ParseIntConverter)
      @IsNumber()
      id = 0;
    }

    @Controller('/convert-before-validate')
    class ConversionController {
      @Get('/')
      @RequestDto(SearchRequest)
      getSearch(input: SearchRequest) {
        return { id: input.id, type: typeof input.id };
      }
    }

    const root = new Container().register(ConversionController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ConversionController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(
      {
        body: undefined,
        cookies: {},
        headers: {},
        method: 'GET',
        params: {},
        path: '/convert-before-validate',
        query: { id: '42' },
        raw: {},
        url: '/convert-before-validate?id=42',
      },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ id: 42, type: 'number' });
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

  describe('@Header and @Redirect decorators', () => {
    it('sets response headers declared with @Header', async () => {
      @Controller('/api')
      class ApiController {
        @Get('/data')
        @Header('X-Custom-Header', 'custom-value')
        @Header('Cache-Control', 'no-cache')
        getData() {
          return { ok: true };
        }
      }

      const root = new Container().register(ApiController);
      const dispatcher = createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: ApiController }]),
        rootContainer: root,
      });
      const response = createResponse();

      await dispatcher.dispatch(
        {
          body: {},
          cookies: {},
          headers: {},
          method: 'GET',
          params: {},
          path: '/api/data',
          query: {},
          raw: {},
          url: '/api/data',
        },
        response,
      );

      expect(response.headers['X-Custom-Header']).toBe('custom-value');
      expect(response.headers['Cache-Control']).toBe('no-cache');
      expect(response.body).toEqual({ ok: true });
    });

    it('redirects to the declared URL with @Redirect', async () => {
      @Controller('/api')
      class ApiController {
        @Get('/old')
        @Redirect('/api/new', 301)
        getOld() {
          return {};
        }
      }

      const root = new Container().register(ApiController);
      const dispatcher = createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: ApiController }]),
        rootContainer: root,
      });
      const response = createResponse();

      await dispatcher.dispatch(
        {
          body: {},
          cookies: {},
          headers: {},
          method: 'GET',
          params: {},
          path: '/api/old',
          query: {},
          raw: {},
          url: '/api/old',
        },
        response,
      );

      expect(response.statusCode).toBe(301);
      expect(response.headers['Location']).toBe('/api/new');
      expect(response.committed).toBe(true);
    });

    it('uses 302 as the default redirect status when no statusCode is provided', async () => {
      @Controller('/api')
      class ApiController {
        @Get('/moved')
        @Redirect('/api/new')
        getMoved() {
          return {};
        }
      }

      const root = new Container().register(ApiController);
      const dispatcher = createDispatcher({
        handlerMapping: createHandlerMapping([{ controllerToken: ApiController }]),
        rootContainer: root,
      });
      const response = createResponse();

      await dispatcher.dispatch(
        {
          body: {},
          cookies: {},
          headers: {},
          method: 'GET',
          params: {},
          path: '/api/moved',
          query: {},
          raw: {},
          url: '/api/moved',
        },
        response,
      );

      expect(response.statusCode).toBe(302);
      expect(response.headers['Location']).toBe('/api/new');
    });
  });
});
