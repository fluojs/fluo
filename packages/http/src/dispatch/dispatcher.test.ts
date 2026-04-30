import { Inject, Scope as ScopeDecorator } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { IntersectionType, IsNumber, IsString, MinLength, OmitType, PartialType, PickType, ValidateNested } from '@fluojs/validation';
import { describe, expect, it, vi } from 'vitest';
import type {
  CallHandler,
  FrameworkRequest,
  FrameworkResponse,
  GuardContext,
  InterceptorContext,
  Middleware,
  MiddlewareContext,
  Next,
  RequestContext,
  RequestObservationContext,
} from '../index.js';
import {
  type assertRequestContext,
  Controller,
  Convert,
  createCorrelationMiddleware,
  createDispatcher,
  createHandlerMapping,
  formatFastPathStats,
  FromBody,
  FromPath,
  FromQuery,
  Get,
  getDispatcherFastPathStats,
  getCurrentRequestContext,
  Header,
  HttpCode,
  Post,
  Produces,
  Redirect,
  RequestDto,
  SseResponse,
  UseGuards,
  UseInterceptors,
} from '../index.js';
import { forRoutes, runMiddlewareChain } from '../middleware/middleware.js';
import { attachFrameworkRequestNativeRouteHandoff } from './native-route-handoff.js';

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

function createFastPathResponse(): FrameworkResponse & {
  body?: unknown;
  simpleJsonBody?: Record<string, unknown> | unknown[];
  sendSimpleJson(body: Record<string, unknown> | unknown[]): void;
} {
  return {
    ...createResponse(),
    sendSimpleJson(body) {
      this.simpleJsonBody = body;
      this.committed = true;
    },
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

class CountingContainer extends Container {
  requestScopeCreateCount = 0;
  requestScopeDisposeCount = 0;

  override createRequestScope(): Container {
    this.requestScopeCreateCount += 1;
    const scope = super.createRequestScope();
    const dispose = scope.dispose.bind(scope);

    scope.dispose = async () => {
      this.requestScopeDisposeCount += 1;
      await dispose();
    };

    return scope;
  }
}

describe('dispatcher runtime', () => {
  it('skips request-scope container creation for singleton-only routes', async () => {
    @Controller('/singleton-only')
    class SingletonOnlyController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const root = new CountingContainer().register(SingletonOnlyController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: SingletonOnlyController }]),
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/singleton-only', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/singleton-only', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ ok: true });
    expect(secondResponse.body).toEqual({ ok: true });
    expect(root.requestScopeCreateCount).toBe(0);
    expect(root.requestScopeDisposeCount).toBe(0);
  });

  it('uses fast path for handlers with RequestContext when no request-scoped dependencies exist', async () => {
    @Controller('/context-aware')
    class ContextAwareController {
      @Get('/')
      getValue(_input: undefined, ctx: RequestContext) {
        return { method: ctx.request.method };
      }
    }

    const root = new CountingContainer().register(ContextAwareController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ContextAwareController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/context-aware', 'GET'), response);

    expect(response.body).toEqual({ method: 'GET' });
    expect(root.requestScopeCreateCount).toBe(0);
    expect(root.requestScopeDisposeCount).toBe(0);
  });

  it('lazily promotes manual RequestContext container access to a request scope', async () => {
    let created = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++created;
    }

    @Controller('/manual-context')
    class ManualContextController {
      @Get('/')
      async getValue() {
        const context = getCurrentRequestContext();

        if (!context) {
          throw new Error('Expected an active request context.');
        }

        const store = await context.container.resolve(RequestStore);

        return { store: store.id };
      }
    }

    const root = new CountingContainer().register(RequestStore, ManualContextController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ManualContextController }]),
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/manual-context', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/manual-context', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ store: 1 });
    expect(secondResponse.body).toEqual({ store: 2 });
    expect(root.requestScopeCreateCount).toBe(2);
    expect(root.requestScopeDisposeCount).toBe(2);
  });

  it('does not create a late request scope when captured RequestContext.container is read after dispatch', async () => {
    let capturedContext: RequestContext | undefined;

    @ScopeDecorator('request')
    class RequestStore {}

    @Controller('/captured-context')
    class CapturedContextController {
      @Get('/')
      getValue() {
        capturedContext = getCurrentRequestContext();
        return { ok: true };
      }
    }

    const root = new CountingContainer().register(RequestStore, CapturedContextController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: CapturedContextController }]),
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/captured-context', 'GET'), response);

    expect(response.body).toEqual({ ok: true });
    expect(capturedContext).toBeDefined();
    expect(root.requestScopeCreateCount).toBe(0);

    const lateContainer = capturedContext!.container;

    expect(lateContainer).toBe(root);
    expect(root.requestScopeCreateCount).toBe(0);
    expect(root.requestScopeDisposeCount).toBe(0);
    await expect(lateContainer.resolve(RequestStore)).rejects.toThrow('outside request scope');
  });

  it('creates and disposes isolated request scopes for request-scoped controllers', async () => {
    const instanceIds: number[] = [];
    let nextId = 0;

    @ScopeDecorator('request')
    @Controller('/request-controller')
    class RequestController {
      private readonly instanceId = ++nextId;

      @Get('/')
      getValue() {
        instanceIds.push(this.instanceId);
        return { id: this.instanceId };
      }
    }

    const root = new CountingContainer().register(RequestController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: RequestController }]),
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/request-controller', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/request-controller', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ id: 1 });
    expect(secondResponse.body).toEqual({ id: 2 });
    expect(instanceIds).toEqual([1, 2]);
    expect(root.requestScopeCreateCount).toBe(2);
    expect(root.requestScopeDisposeCount).toBe(2);
  });

  it('uses request scope for custom binders before they resolve request-scoped providers', async () => {
    let created = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++created;
    }

    class CustomDto {}

    @Controller('/custom-binder')
    class CustomBinderController {
      @Get('/')
      @RequestDto(CustomDto)
      getValue(input: CustomDto) {
        return input;
      }
    }

    const root = new CountingContainer().register(RequestStore, CustomBinderController);
    const dispatcher = createDispatcher({
      binder: {
        async bind(_dto, context) {
          const store = await context.requestContext.container.resolve(RequestStore);
          return { store: store.id };
        },
      },
      handlerMapping: createHandlerMapping([{ controllerToken: CustomBinderController }]),
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/custom-binder', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/custom-binder', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ store: 1 });
    expect(secondResponse.body).toEqual({ store: 2 });
    expect(root.requestScopeCreateCount).toBe(2);
    expect(root.requestScopeDisposeCount).toBe(2);
  });

  it('uses request scope when DTO converters resolve request-scoped providers', async () => {
    let created = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++created;
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedConverter {
      constructor(private readonly store: RequestStore) {}

      convert(value: unknown) {
        return `${String(value)}:${this.store.id}`;
      }
    }

    class ScopedDto {
      @Convert(ScopedConverter)
      @FromPath('id')
      id!: string;
    }

    @Controller('/converter-scope')
    class ConverterScopeController {
      @Get('/:id')
      @RequestDto(ScopedDto)
      getValue(input: ScopedDto) {
        return { id: input.id };
      }
    }

    const root = new CountingContainer().register(RequestStore, ScopedConverter, ConverterScopeController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ConverterScopeController }]),
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/converter-scope/one', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/converter-scope/two', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ id: 'one:1' });
    expect(secondResponse.body).toEqual({ id: 'two:2' });
    expect(root.requestScopeCreateCount).toBe(2);
    expect(root.requestScopeDisposeCount).toBe(2);
  });

  it('promotes to request scope only when route-matched middleware is active', async () => {
    const events: string[] = [];
    let created = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++created;
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedMiddleware implements Middleware {
      constructor(private readonly store: RequestStore) {}

      async handle(context: MiddlewareContext, next: Next) {
        events.push(`middleware:${context.request.path}:${this.store.id}`);
        await next();
      }
    }

    @Controller('/middleware-scope')
    class MiddlewareScopeController {
      @Get('/active')
      getActive() {
        return { ok: 'active' };
      }

      @Get('/inactive')
      getInactive() {
        return { ok: 'inactive' };
      }
    }

    const root = new CountingContainer().register(RequestStore, ScopedMiddleware, MiddlewareScopeController);
    const dispatcher = createDispatcher({
      appMiddleware: [forRoutes(ScopedMiddleware, '/middleware-scope/active')],
      handlerMapping: createHandlerMapping([{ controllerToken: MiddlewareScopeController }]),
      rootContainer: root,
    });

    const inactiveResponse = createResponse();
    await dispatcher.dispatch(createRequest('/middleware-scope/inactive', 'GET'), inactiveResponse);

    const activeResponse = createResponse();
    await dispatcher.dispatch(createRequest('/middleware-scope/active', 'GET'), activeResponse);

    expect(inactiveResponse.body).toEqual({ ok: 'inactive' });
    expect(activeResponse.body).toEqual({ ok: 'active' });
    expect(events).toEqual(['middleware:/middleware-scope/active:1']);
    expect(root.requestScopeCreateCount).toBe(1);
    expect(root.requestScopeDisposeCount).toBe(1);
  });

  it('uses isolated request scopes for observer callbacks on singleton routes', async () => {
    const events: string[] = [];
    let created = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++created;
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedObserver {
      constructor(private readonly store: RequestStore) {}

      onRequestFinish() {
        events.push(`finish:${this.store.id}`);
      }

      onRequestStart() {
        events.push(`start:${this.store.id}`);
      }
    }

    @Controller('/observer-scope')
    class ObserverScopeController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const root = new CountingContainer().register(RequestStore, ScopedObserver, ObserverScopeController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: ObserverScopeController }]),
      observers: [ScopedObserver],
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/observer-scope', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/observer-scope', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ ok: true });
    expect(secondResponse.body).toEqual({ ok: true });
    expect(events).toEqual(['start:1', 'finish:1', 'start:2', 'finish:2']);
    expect(root.requestScopeCreateCount).toBe(2);
    expect(root.requestScopeDisposeCount).toBe(2);
  });

  it('keeps request-scoped middleware, observers, guards, interceptors, converters, and services isolated', async () => {
    const events: string[] = [];
    let nextStoreId = 0;

    @ScopeDecorator('request')
    class RequestStore {
      readonly id = ++nextStoreId;
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedObserver {
      constructor(private readonly store: RequestStore) {}

      onRequestFinish() {
        events.push(`finish:${this.store.id}`);
      }

      onRequestStart() {
        events.push(`start:${this.store.id}`);
      }
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedMiddleware implements Middleware {
      constructor(private readonly store: RequestStore) {}

      async handle(_context: MiddlewareContext, next: Next) {
        events.push(`middleware:${this.store.id}`);
        await next();
      }
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedGuard {
      constructor(private readonly store: RequestStore) {}

      canActivate() {
        events.push(`guard:${this.store.id}`);
        return true;
      }
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedInterceptor {
      constructor(private readonly store: RequestStore) {}

      async intercept(_context: InterceptorContext, next: CallHandler) {
        events.push(`interceptor-before:${this.store.id}`);
        const value = await next.handle();
        events.push(`interceptor-after:${this.store.id}`);
        return value;
      }
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    class ScopedConverter {
      constructor(private readonly store: RequestStore) {}

      convert(value: unknown) {
        events.push(`converter:${this.store.id}`);
        return `${String(value)}:${this.store.id}`;
      }
    }

    class ScopedDto {
      @Convert(ScopedConverter)
      @FromPath('id')
      id!: string;
    }

    @Inject(RequestStore)
    @ScopeDecorator('request')
    @Controller('/request-pipeline')
    @UseGuards(ScopedGuard)
    @UseInterceptors(ScopedInterceptor)
    class RequestPipelineController {
      constructor(private readonly store: RequestStore) {}

      @Get('/:id')
      @RequestDto(ScopedDto)
      getValue(input: ScopedDto) {
        events.push(`handler:${this.store.id}:${input.id}`);
        return { id: input.id, store: this.store.id };
      }
    }

    const root = new CountingContainer().register(
      RequestStore,
      ScopedObserver,
      ScopedMiddleware,
      ScopedGuard,
      ScopedInterceptor,
      ScopedConverter,
      RequestPipelineController,
    );
    const dispatcher = createDispatcher({
      appMiddleware: [ScopedMiddleware],
      handlerMapping: createHandlerMapping([{ controllerToken: RequestPipelineController }]),
      observers: [ScopedObserver],
      rootContainer: root,
    });

    const firstResponse = createResponse();
    await dispatcher.dispatch(createRequest('/request-pipeline/one', 'GET'), firstResponse);

    const secondResponse = createResponse();
    await dispatcher.dispatch(createRequest('/request-pipeline/two', 'GET'), secondResponse);

    expect(firstResponse.body).toEqual({ id: 'one:1', store: 1 });
    expect(secondResponse.body).toEqual({ id: 'two:2', store: 2 });
    expect(events).toEqual([
      'start:1',
      'middleware:1',
      'guard:1',
      'interceptor-before:1',
      'converter:1',
      'handler:1:one:1',
      'interceptor-after:1',
      'finish:1',
      'start:2',
      'middleware:2',
      'guard:2',
      'interceptor-before:2',
      'converter:2',
      'handler:2:two:2',
      'interceptor-after:2',
      'finish:2',
    ]);
    expect(root.requestScopeCreateCount).toBe(2);
    expect(root.requestScopeDisposeCount).toBe(2);
  });

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

  it('uses the simple JSON fast writer for successful object and array responses', async () => {
    @Controller('/fast-json')
    class FastJsonController {
      @Get('/object')
      getObject() {
        return { ok: true };
      }

      @Get('/array')
      getArray() {
        return [{ ok: true }];
      }
    }

    const root = new Container().register(FastJsonController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastJsonController }]),
      rootContainer: root,
    });
    const objectResponse = createFastPathResponse();
    const arrayResponse = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/fast-json/object'), objectResponse);
    await dispatcher.dispatch(createRequest('/fast-json/array'), arrayResponse);

    expect(objectResponse.statusCode).toBe(200);
    expect(objectResponse.simpleJsonBody).toEqual({ ok: true });
    expect(objectResponse.body).toBeUndefined();
    expect(arrayResponse.statusCode).toBe(200);
    expect(arrayResponse.simpleJsonBody).toEqual([{ ok: true }]);
    expect(arrayResponse.body).toBeUndefined();
  });

  it('exposes automatic fast-path stats without emitting debug headers by default', async () => {
    @Controller('/fast-path-visibility')
    class FastPathVisibilityController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(FastPathVisibilityController);
    const dispatcher = createDispatcher({
      adapter: 'fastify',
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathVisibilityController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/fast-path-visibility'), response);

    const stats = getDispatcherFastPathStats(dispatcher);
    expect(stats?.totalRoutes).toBe(1);
    expect(stats?.fastPathRoutes).toBe(1);
    expect(stats?.fullPathRoutes).toBe(0);
    expect(stats?.routes[0]?.adapter).toBe('fastify');
    expect(stats?.routes[0]?.executionPath).toBe('fast');
    expect(response.headers['X-Fluo-Path']).toBeUndefined();
    expect(response.simpleJsonBody).toEqual({ ok: true });
  });

  it('emits fast-path debug headers when explicitly enabled', async () => {
    @Controller('/fast-path-debug-header')
    class FastPathDebugHeaderController {
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(FastPathDebugHeaderController);
    const dispatcher = createDispatcher({
      fastPathDebugHeaders: true,
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathDebugHeaderController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/fast-path-debug-header'), response);

    expect(response.headers['X-Fluo-Path']).toBe('fast; route=GET:/fast-path-debug-header');
    expect(response.simpleJsonBody).toEqual({ ok: true });
  });

  it('falls back to full path when route capabilities are not fast-path safe', async () => {
    class VisibilityGuard {
      canActivate() {
        return true;
      }
    }

    @Controller('/full-path-visibility')
    class FullPathVisibilityController {
      @UseGuards(VisibilityGuard)
      @Get('/')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container()
      .register(FullPathVisibilityController)
      .register(VisibilityGuard);
    const dispatcher = createDispatcher({
      fastPathDebugHeaders: true,
      handlerMapping: createHandlerMapping([{ controllerToken: FullPathVisibilityController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/full-path-visibility'), response);

    const stats = getDispatcherFastPathStats(dispatcher);
    expect(stats?.totalRoutes).toBe(1);
    expect(stats?.fastPathRoutes).toBe(0);
    expect(stats?.fullPathRoutes).toBe(1);
    expect(stats?.routes[0]?.executionPath).toBe('full');
    expect(stats?.routes[0]?.fallbackReason).toContain('guards');
    expect(response.headers['X-Fluo-Path']).toContain('full; route=GET:/');
    expect(response.headers['X-Fluo-Path']).toContain('guards');
    expect(response.simpleJsonBody).toEqual({ ok: true });
  });

  it('falls back to full path when global interceptors are registered', async () => {
    const events: string[] = [];

    class VisibilityInterceptor {
      async intercept(_context: InterceptorContext, next: { handle(): Promise<unknown> }) {
        events.push('interceptor:before');
        const value = await next.handle();
        events.push('interceptor:after');
        return value;
      }
    }

    @Controller('/global-interceptor-visibility')
    class GlobalInterceptorVisibilityController {
      @Get('/')
      getValue() {
        events.push('handler');
        return { ok: true };
      }
    }

    const root = new Container()
      .register(GlobalInterceptorVisibilityController)
      .register(VisibilityInterceptor);
    const dispatcher = createDispatcher({
      fastPathDebugHeaders: true,
      handlerMapping: createHandlerMapping([{ controllerToken: GlobalInterceptorVisibilityController }]),
      interceptors: [VisibilityInterceptor],
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/global-interceptor-visibility'), response);

    const stats = getDispatcherFastPathStats(dispatcher);
    expect(stats?.fastPathRoutes).toBe(0);
    expect(stats?.fullPathRoutes).toBe(1);
    expect(stats?.routes[0]?.executionPath).toBe('full');
    expect(stats?.routes[0]?.fallbackReason).toContain('interceptors');
    expect(response.headers['X-Fluo-Path']).toContain('interceptors');
    expect(response.simpleJsonBody).toEqual({ ok: true });
    expect(events).toEqual(['interceptor:before', 'handler', 'interceptor:after']);
  });

  it('preserves matched route params on the fast path', async () => {
    @Controller('/fast-path-params')
    class FastPathParamsController {
      @Get('/:id')
      getValue() {
        return { id: getCurrentRequestContext()?.request.params.id };
      }
    }

    const root = new Container().register(FastPathParamsController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathParamsController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/fast-path-params/u-1'), response);

    const stats = getDispatcherFastPathStats(dispatcher);
    expect(stats?.routes[0]?.executionPath).toBe('fast');
    expect(response.simpleJsonBody).toEqual({ id: 'u-1' });
  });

  it('allows fast-path handlers to read request context data without forcing full path', async () => {
    @Controller('/fast-path-context')
    class FastPathContextController {
      @Get('/')
      getValue(_input: undefined, context: RequestContext) {
        return {
          encoded: context.request.query['encoded'],
          requestId: context.requestId,
        };
      }
    }

    const root = new Container().register(FastPathContextController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathContextController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    const request = createRequest('/fast-path-context', 'GET', { 'x-request-id': 'req-1' });
    request.query = { encoded: 'hello world' };

    await dispatcher.dispatch(request, response);

    const stats = getDispatcherFastPathStats(dispatcher);
    expect(stats?.routes[0]?.executionPath).toBe('fast');
    expect(response.simpleJsonBody).toEqual({ encoded: 'hello world', requestId: 'req-1' });
  });

  it('uses adapter-snapshotted request ids without materializing headers on the fast path', async () => {
    @Controller('/fast-path-request-id-snapshot')
    class FastPathRequestIdSnapshotController {
      @Get('/')
      getValue(_input: undefined, context: RequestContext) {
        return { requestId: context.requestId };
      }
    }

    const root = new Container().register(FastPathRequestIdSnapshotController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathRequestIdSnapshotController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();
    const request = createRequest('/fast-path-request-id-snapshot');
    let headerReads = 0;

    request.requestId = 'req-snapshot-1';
    Object.defineProperty(request, 'headers', {
      configurable: true,
      get() {
        headerReads += 1;
        return { 'x-request-id': 'req-header-1' };
      },
    });

    await dispatcher.dispatch(request, response);

    expect(headerReads).toBe(0);
    expect(response.simpleJsonBody).toEqual({ requestId: 'req-snapshot-1' });
  });

  it('does not commit a fast-path success response after request aborts during handler execution', async () => {
    const controller = new AbortController();

    @Controller('/fast-path-abort')
    class FastPathAbortController {
      @Get('/')
      async getValue() {
        controller.abort();
        return { ok: true };
      }
    }

    const root = new Container().register(FastPathAbortController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastPathAbortController }]),
      rootContainer: root,
    });
    const request = createRequest('/fast-path-abort');
    request.signal = controller.signal;
    const response = createFastPathResponse();

    await dispatcher.dispatch(request, response);

    const stats = getDispatcherFastPathStats(dispatcher);
    expect(stats?.routes[0]?.executionPath).toBe('fast');
    expect(response.committed).toBe(false);
    expect(response.simpleJsonBody).toBeUndefined();
  });

  it('formats empty fast-path statistics without NaN output', () => {
    const output = formatFastPathStats({
      fastPathRoutes: 0,
      fullPathRoutes: 0,
      routes: [],
      totalRoutes: 0,
    });

    expect(output).toContain('Fast path: 0 (0.0%)');
    expect(output).toContain('Full path: 0 (0.0%)');
    expect(output).not.toContain('NaN');
  });

  it('keeps strings and binary values on the generic success writer', async () => {
    @Controller('/generic-values')
    class GenericValuesController {
      @Get('/string')
      getString() {
        return 'plain';
      }

      @Get('/bytes')
      getBytes() {
        return Uint8Array.from([1, 2, 3]);
      }

      @Get('/buffer')
      getBuffer() {
        return Uint8Array.from([4, 5, 6]).buffer;
      }
    }

    const root = new Container().register(GenericValuesController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: GenericValuesController }]),
      rootContainer: root,
    });
    const stringResponse = createFastPathResponse();
    const bytesResponse = createFastPathResponse();
    const bufferResponse = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/generic-values/string'), stringResponse);
    await dispatcher.dispatch(createRequest('/generic-values/bytes'), bytesResponse);
    await dispatcher.dispatch(createRequest('/generic-values/buffer'), bufferResponse);

    expect(stringResponse.simpleJsonBody).toBeUndefined();
    expect(stringResponse.body).toBe('plain');
    expect(bytesResponse.simpleJsonBody).toBeUndefined();
    expect(bytesResponse.body).toEqual(Uint8Array.from([1, 2, 3]));
    expect(bufferResponse.simpleJsonBody).toBeUndefined();
    expect(bufferResponse.body).toBeInstanceOf(ArrayBuffer);
  });

  it('preserves explicit success headers and status on the simple JSON fast path', async () => {
    @Controller('/fast-json-contract')
    class FastJsonContractController {
      @Header('X-Contract', 'preserved')
      @HttpCode(202)
      @Get('/headers')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(FastJsonContractController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastJsonContractController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/fast-json-contract/headers'), response);

    expect(response.statusCode).toBe(202);
    expect(response.headers['X-Contract']).toBe('preserved');
    expect(response.simpleJsonBody).toEqual({ ok: true });
  });

  it('skips the simple JSON fast path for explicit non-JSON content types', async () => {
    @Controller('/fast-json-contract')
    class FastJsonContractController {
      @Header('Content-Type', 'application/vnd.custom')
      @Get('/custom-type')
      getValue() {
        return { ok: true };
      }
    }

    const root = new Container().register(FastJsonContractController);
    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: FastJsonContractController }]),
      rootContainer: root,
    });
    const response = createFastPathResponse();

    await dispatcher.dispatch(createRequest('/fast-json-contract/custom-type'), response);

    expect(response.simpleJsonBody).toBeUndefined();
    expect(response.body).toEqual({ ok: true });
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

  it('routes observer and request-scope disposal failures through the dispatcher logger', async () => {
    const logger = {
      error: vi.fn(),
    };
    const observer = {
      onRequestStart() {
        throw new Error('observer seam failed');
      },
    };

    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { ok: true };
      }
    }

    const root = new Container().register(HealthController);
    const createRequestScope = root.createRequestScope.bind(root);

    vi.spyOn(root, 'createRequestScope').mockImplementation(() => {
      const scope = createRequestScope();
      const dispose = scope.dispose.bind(scope);

      scope.dispose = async () => {
        await dispose();
        throw new Error('scope dispose failed');
      };

      return scope;
    });

    const dispatcher = createDispatcher({
      handlerMapping: createHandlerMapping([{ controllerToken: HealthController }]),
      logger,
      observers: [observer],
      rootContainer: root,
    });
    const response = createResponse();

    await dispatcher.dispatch(createRequest('/health', 'GET', { 'x-request-id': 'req-logger-seam' }), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      'Request observer threw an unhandled error.',
      expect.objectContaining({ message: 'observer seam failed' }),
      'HttpDispatcher',
    );
    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      'Request-scoped container dispose threw an error.',
      expect.objectContaining({ message: 'scope dispose failed' }),
      'HttpDispatcher',
    );
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

  it('reuses adapter-native route handoff without rematching while preserving params, lifecycle, observers, and response policy', async () => {
    const events: string[] = [];
    const appMiddleware = {
      async handle(context: MiddlewareContext, next: Next) {
        events.push(`middleware:before:${context.request.path}`);
        await next();
        events.push(`middleware:after:${context.request.path}`);
      },
    };
    const guard = {
      canActivate(context: GuardContext) {
        events.push(`guard:${context.requestContext.request.params.id ?? 'missing'}`);
        return true;
      },
    };
    const interceptor = {
      async intercept(context: InterceptorContext, next: CallHandler) {
        events.push(`interceptor:before:${context.handler.route.path}`);
        const result = await next.handle();
        events.push(`interceptor:after:${context.handler.route.path}`);
        return result;
      },
    };
    const observer = {
      onHandlerMatched(context: RequestObservationContext) {
        events.push(`observer:matched:${context.handler?.route.path ?? 'none'}`);
      },
      onRequestFinish(context: RequestObservationContext) {
        events.push(`observer:finish:${context.requestContext.request.params.id ?? 'missing'}`);
      },
      onRequestStart(context: RequestObservationContext) {
        events.push(`observer:start:${context.requestContext.request.path}`);
      },
      onRequestSuccess(_context: RequestObservationContext, value: unknown) {
        events.push(`observer:success:${typeof value === 'object' && value && 'id' in value ? String((value as { id: string }).id) : 'none'}`);
      },
    };

    @Controller('/native')
    class NativeController {
      @Get('/:id')
      @Header('X-Native-Handoff', 'enabled')
      @HttpCode(201)
      @UseGuards(guard)
      @UseInterceptors(interceptor)
      getById(_input: undefined, context: RequestContext) {
        events.push(`handler:${context.request.params.id}`);
        return { id: context.request.params.id };
      }
    }

    const root = new Container().register(NativeController);
    const baseMapping = createHandlerMapping([{ controllerToken: NativeController }]);
    const handlerMapping = {
      descriptors: baseMapping.descriptors,
      match: vi.fn(() => {
        throw new Error('native route handoff should bypass handlerMapping.match');
      }),
    };
    const dispatcher = createDispatcher({
      appMiddleware: [appMiddleware],
      handlerMapping,
      observers: [observer],
      rootContainer: root,
    });
    const descriptor = baseMapping.descriptors[0];

    if (!descriptor) {
      throw new Error('Expected one native route descriptor.');
    }

    const request = attachFrameworkRequestNativeRouteHandoff(createRequest('/native/123'), {
      descriptor,
      params: { id: '123' },
    });
    const response = createResponse();

    await dispatcher.dispatch(request, response);

    expect(handlerMapping.match).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(201);
    expect(response.headers['X-Native-Handoff']).toBe('enabled');
    expect(response.body).toEqual({ id: '123' });
    expect(events).toEqual([
      'observer:start:/native/123',
      'middleware:before:/native/123',
      'observer:matched:/native/:id',
      'guard:123',
      'interceptor:before:/native/:id',
      'handler:123',
      'interceptor:after:/native/:id',
      'observer:success:123',
      'middleware:after:/native/123',
      'observer:finish:123',
    ]);
  });

  it('preserves fast-path eligibility on cloned native route descriptors', async () => {
    @Controller('/native-fast')
    class NativeFastController {
      @Get('/:id')
      getById(_input: undefined, context: RequestContext) {
        return { id: context.request.params.id };
      }
    }

    const root = new CountingContainer().register(NativeFastController);
    const baseMapping = createHandlerMapping([{ controllerToken: NativeFastController }]);
    const handlerMapping = {
      descriptors: baseMapping.descriptors,
      match: vi.fn(() => {
        throw new Error('native route handoff should bypass handlerMapping.match');
      }),
    };
    const dispatcher = createDispatcher({
      handlerMapping,
      rootContainer: root,
    });
    const descriptor = dispatcher.describeRoutes?.()[0];

    if (!descriptor) {
      throw new Error('Expected one cloned native route descriptor.');
    }

    const request = attachFrameworkRequestNativeRouteHandoff(createRequest('/native-fast/123'), {
      descriptor,
      params: { id: '123' },
    });
    const response = createResponse();

    await dispatcher.dispatch(request, response);

    expect(handlerMapping.match).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ id: '123' });
    expect(root.requestScopeCreateCount).toBe(0);
  });

  it('reuses adapter-native route handoff on error paths without rematching', async () => {
    const events: string[] = [];
    const observer = {
      onRequestError(_context: RequestObservationContext, error: unknown) {
        events.push(`error:${error instanceof Error ? error.message : String(error)}`);
      },
      onRequestFinish(context: RequestObservationContext) {
        events.push(`finish:${context.requestContext.request.params.id ?? 'missing'}`);
      },
    };

    @Controller('/native-errors')
    class NativeErrorController {
      @Get('/:id')
      explode(_input: undefined, context: RequestContext) {
        throw new Error(`boom:${context.request.params.id}`);
      }
    }

    const root = new Container().register(NativeErrorController);
    const baseMapping = createHandlerMapping([{ controllerToken: NativeErrorController }]);
    const handlerMapping = {
      descriptors: baseMapping.descriptors,
      match: vi.fn(() => {
        throw new Error('native route handoff should bypass handlerMapping.match');
      }),
    };
    const dispatcher = createDispatcher({
      handlerMapping,
      observers: [observer],
      rootContainer: root,
    });
    const descriptor = baseMapping.descriptors[0];

    if (!descriptor) {
      throw new Error('Expected one native error route descriptor.');
    }

    const request = attachFrameworkRequestNativeRouteHandoff(createRequest('/native-errors/7'), {
      descriptor,
      params: { id: '7' },
    });
    const response = createResponse();

    await dispatcher.dispatch(request, response);

    expect(handlerMapping.match).not.toHaveBeenCalled();
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
    expect(events).toEqual(['error:boom:7', 'finish:7']);
  });

  it('rematches when app middleware rewrites a request carrying adapter-native route handoff', async () => {
    @Controller('/native')
    class NativeController {
      @Get('/:id')
      getNative(_input: undefined, context: RequestContext) {
        return { route: 'native', id: context.request.params.id };
      }
    }

    @Controller('/rewritten')
    class RewrittenController {
      @Get('/:id')
      getRewritten(_input: undefined, context: RequestContext) {
        return { route: 'rewritten', id: context.request.params.id };
      }
    }

    const root = new Container().register(NativeController, RewrittenController);
    const baseMapping = createHandlerMapping([
      { controllerToken: NativeController },
      { controllerToken: RewrittenController },
    ]);
    const handlerMapping = {
      descriptors: baseMapping.descriptors,
      match: vi.fn(baseMapping.match),
    };
    const dispatcher = createDispatcher({
      appMiddleware: [
        {
          async handle(context, next) {
            context.request.path = '/rewritten/456';
            context.request.url = '/rewritten/456';
            await next();
          },
        },
      ],
      handlerMapping,
      rootContainer: root,
    });
    const nativeDescriptor = baseMapping.descriptors.find(
      (descriptor) => descriptor.controllerToken === NativeController,
    );

    if (!nativeDescriptor) {
      throw new Error('Expected native route descriptor.');
    }

    const request = attachFrameworkRequestNativeRouteHandoff(createRequest('/native/123'), {
      descriptor: nativeDescriptor,
      params: { id: '123' },
    });
    const response = createResponse();

    await dispatcher.dispatch(request, response);

    expect(handlerMapping.match).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({ route: 'rewritten', id: '456' });
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
