import { type Constructor, Inject, Scope } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  Controller,
  createDispatcher,
  createHandlerMapping,
  createSecurityHeadersMiddleware,
  Get,
  getCurrentRequestContext,
  getDispatcherFastPathStats,
  Header,
} from '../index.js';
import type { Dispatcher, FrameworkRequest, FrameworkResponse, HandlerMapping, Middleware, RequestContext } from '../types.js';
import type { CreateDispatcherOptions } from './dispatcher.js';
import * as handlerPolicy from './dispatch-handler-policy.js';

const defaultHeaders = {
  'Content-Security-Policy': "default-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '0',
};

function createRequest(path = '/security', method = 'GET'): FrameworkRequest {
  return { body: undefined, cookies: {}, headers: {}, method, params: {}, path, query: {}, raw: {}, url: path };
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
  };
}

@Controller('/security')
class SecurityController {
  @Get('/')
  getValue() {
    return { ok: true };
  }
}

async function dispatch(
  surface: 'general' | 'native',
  dispatcher: Dispatcher,
  mapping: HandlerMapping,
  request: FrameworkRequest,
  response: FrameworkResponse,
): Promise<void> {
  if (surface === 'native') {
    const match = mapping.match(request);
    expect(match).toBeDefined();
    if (!match) throw new Error('Expected a native route match');
    expect(await dispatcher.dispatchNativeRoute?.(match, request, response)).toBe(true);
  } else {
    await dispatcher.dispatch(request, response);
  }
}

const roots: Container[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => root.dispose()));
});

function createFixture(
  options: Partial<CreateDispatcherOptions> = {},
  controller: Constructor = SecurityController,
) {
  const root = options.rootContainer ?? new Container().register(controller);
  roots.push(root);
  const mapping = options.handlerMapping ?? createHandlerMapping([{ controllerToken: controller }]);
  const dispatcher = createDispatcher({
    appMiddleware: [createSecurityHeadersMiddleware()],
    fastPathDebugHeaders: true,
    ...options,
    handlerMapping: mapping,
    rootContainer: root,
  });
  return { dispatcher, mapping, root };
}

describe.each(['general', 'native'] as const)('security headers on %s dispatch', (surface) => {
  it('keeps all default headers without a request scope or full handler dispatch', async () => {
    const root = new Container().register(SecurityController);
    const createScope = vi.spyOn(root, 'createRequestScope');
    const fullHandler = vi.spyOn(handlerPolicy, 'invokeControllerHandler');
    const mapping = createHandlerMapping([{ controllerToken: SecurityController }]);
    const dispatcher = createDispatcher({
      appMiddleware: [createSecurityHeadersMiddleware()],
      fastPathDebugHeaders: true,
      handlerMapping: mapping,
      rootContainer: root,
    });
    try {
      const response = createResponse();
      await dispatch(surface, dispatcher, mapping, createRequest(), response);
      expect(response.headers).toMatchObject(defaultHeaders);
      expect(response.body).toEqual({ ok: true });
      expect(createScope).not.toHaveBeenCalled();
      expect(fullHandler).not.toHaveBeenCalled();
      expect(response.headers['X-Fluo-Path']).toBe('fast; route=GET:/security');
      expect(getDispatcherFastPathStats(dispatcher)?.fastPathRoutes).toBe(1);
      expect(getDispatcherFastPathStats(dispatcher)?.routes[0]?.hasMiddleware).toBe(true);
    } finally {
      await root.dispose();
    }
  });

  it('preserves configured values, disabled headers and write order', async () => {
    const options = {
      contentSecurityPolicy: "default-src 'none'",
      crossOriginOpenerPolicy: false,
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: false,
      xContentTypeOptions: false,
      xFrameOptions: 'DENY',
      xXssProtection: false,
    } as const;
    const { dispatcher, mapping } = createFixture({ appMiddleware: [createSecurityHeadersMiddleware(options)] });
    const response = createResponse();
    const writes = vi.spyOn(response, 'setHeader');
    await dispatch(surface, dispatcher, mapping, createRequest(), response);
    expect(writes.mock.calls.slice(0, 3)).toEqual([
      ['Content-Security-Policy', "default-src 'none'"],
      ['Referrer-Policy', 'no-referrer'],
      ['X-Frame-Options', 'DENY'],
    ]);
    for (const name of ['Cross-Origin-Opener-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-XSS-Protection']) {
      expect(response.headers).not.toHaveProperty(name);
    }
  });

  it('lets route metadata and manual responses override security headers', async () => {
    @Controller('/security')
    class OverrideController {
      @Header('X-Frame-Options', 'route')
      @Get('/')
      getValue() { return { ok: true }; }

      @Get('/manual')
      manual(_input: unknown, context: RequestContext) {
        context.response.setHeader('X-Frame-Options', 'manual');
        context.response.setStatus(202);
        context.response.send('manual body');
      }
    }
    const { dispatcher, mapping, root } = createFixture({}, OverrideController);
    const scope = vi.spyOn(root, 'createRequestScope');
    const route = createResponse();
    await dispatch(surface, dispatcher, mapping, createRequest(), route);
    expect(route.headers['X-Frame-Options']).toBe('route');
    const manual = createResponse();
    await dispatch(surface, dispatcher, mapping, createRequest('/security/manual'), manual);
    expect(manual.headers['X-Frame-Options']).toBe('manual');
    expect(manual.body).toBe('manual body');
    expect(manual.statusCode).toBe(202);
    expect(scope).not.toHaveBeenCalled();
  });

  it('preserves HEAD body suppression and headers', async () => {
    const { dispatcher, mapping } = createFixture();
    const request = { ...createRequest('/security', 'HEAD'), headRouting: 'explicit-or-get' as const };
    const response = createResponse();
    await dispatch(surface, dispatcher, mapping, request, response);
    expect(response.headers).toMatchObject(defaultHeaders);
    expect(response.body).toBeUndefined();
    expect(response.statusCode).toBe(200);
  });

  it.each([new BadRequestException('invalid'), undefined, null, false, 0])('preserves thrown errors without invoking the handler twice (%s)', async (error) => {
    const handler = vi.fn(() => { throw error; });
    @Controller('/security')
    class ErrorController {
      @Get('/')
      getValue() { return handler(); }
    }
    const { dispatcher, mapping } = createFixture({ logger: { error: vi.fn() } }, ErrorController);
    const response = createResponse();
    await dispatch(surface, dispatcher, mapping, createRequest(), response);
    expect(response.headers).toMatchObject(defaultHeaders);
    expect(response.statusCode).toBe(error instanceof BadRequestException ? 400 : 500);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('classifies header failures before matching a handler', async () => {
    const observedHandlers: unknown[] = [];
    const { dispatcher, mapping } = createFixture({
      errorRepresentation: {
        html: {
          canRender(context) { observedHandlers.push(context.handler); return true; },
          render() { return '<p>header failure</p>'; },
        },
      },
    });
    const request = { ...createRequest(), headers: { accept: 'text/html' } };
    const response = createResponse();
    const setHeader = response.setHeader.bind(response);
    response.setHeader = (name, value) => {
      if (name === 'Content-Security-Policy') throw new BadRequestException('invalid header');
      setHeader(name, value);
    };
    await dispatch(surface, dispatcher, mapping, request, response);
    expect(response.statusCode).toBe(400);
    expect(observedHandlers).toEqual([undefined]);
    expect(response.body).toBe('<p>header failure</p>');
  });

  it.each(['method', 'accessor'] as const)('preserves controller instance overrides (%s)', async (kind) => {
    const root = new Container().register(SecurityController);
    const controller = await root.resolve(SecurityController);
    const getOverride = vi.fn(() => () => ({ ok: false }));
    if (kind === 'accessor') {
      Object.defineProperty(controller, 'getValue', { get: getOverride });
    } else {
      controller.getValue = () => ({ ok: false });
    }
    const { dispatcher, mapping } = createFixture({ rootContainer: root });
    const response = createResponse();
    await dispatch(surface, dispatcher, mapping, createRequest(), response);
    expect(response.body).toEqual({ ok: false });
    if (kind === 'accessor') expect(getOverride).toHaveBeenCalledTimes(1);
  });

  it('does not run the handler for an already committed response', async () => {
    const { dispatcher, mapping, root } = createFixture();
    const controller = await root.resolve(SecurityController);
    const handler = vi.spyOn(controller, 'getValue');
    const response = createResponse();
    response.send('already sent');
    await dispatch(surface, dispatcher, mapping, createRequest(), response);
    expect(response.headers).toMatchObject(defaultHeaders);
    expect(response.body).toBe('already sent');
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps transient identity, async context and lazy scope cleanup', async () => {
    const disposed: number[] = [];
    let dependencyId = 0;
    let controllerId = 0;
    @Scope('request')
    class RequestDependency {
      id = ++dependencyId;
      onDestroy() { disposed.push(this.id); }
    }
    @Scope('transient')
    @Controller('/security')
    class TransientController {
      id = ++controllerId;
      @Get('/')
      async getValue() {
        const context = getCurrentRequestContext();
        expect(context).toBeDefined();
        if (!context) throw new Error('Missing request context');
        const dependency = await context.container.resolve(RequestDependency);
        expect(getCurrentRequestContext()).toBe(context);
        return { controller: this.id, dependency: dependency.id };
      }
    }
    const root = new Container().register(RequestDependency, TransientController);
    const { dispatcher, mapping } = createFixture({ rootContainer: root }, TransientController);
    const scope = vi.spyOn(root, 'createRequestScope');
    const first = createResponse();
    const second = createResponse();
    await Promise.all([
      dispatch(surface, dispatcher, mapping, createRequest(), first),
      dispatch(surface, dispatcher, mapping, createRequest(), second),
    ]);
    expect(first.body).toEqual({ controller: 1, dependency: 1 });
    expect(second.body).toEqual({ controller: 2, dependency: 2 });
    expect(scope).toHaveBeenCalledTimes(2);
    expect(disposed.sort()).toEqual([1, 2]);
    expect(getCurrentRequestContext()).toBeUndefined();
  });

  it('does not commit success when the handler cancels the request', async () => {
    const abort = new AbortController();
    @Controller('/security')
    class AbortingController {
      @Get('/')
      getValue() { abort.abort(); return { ok: true }; }
    }
    const { dispatcher, mapping } = createFixture({}, AbortingController);
    const response = createResponse();
    await dispatch(surface, dispatcher, mapping, { ...createRequest(), signal: abort.signal }, response);
    expect(response.headers).toMatchObject(defaultHeaders);
    expect(response.committed).toBe(false);
  });
});

it('keeps security headers on unmatched routes without creating a scope', async () => {
  const { dispatcher, root } = createFixture();
  const scope = vi.spyOn(root, 'createRequestScope');
  const response = createResponse();
  await dispatcher.dispatch(createRequest('/missing'), response);
  expect(response.statusCode).toBe(404);
  expect(response.headers).toMatchObject(defaultHeaders);
  expect(scope).not.toHaveBeenCalled();
});

it.each(['before bootstrap', 'after bootstrap', 'accessor', 'copy'] as const)(
  'keeps modified or copied built-ins conservative (%s)', async (mutation) => {
    const middleware = createSecurityHeadersMiddleware();
    const original = middleware.handle;
    const events: string[] = [];
    const replacement: Middleware['handle'] = async (context, next) => {
      events.push('custom:before');
      await original(context, next);
      events.push('custom:after');
    };
    if (mutation === 'before bootstrap') middleware.handle = replacement;
    const { dispatcher, mapping, root } = createFixture({
      appMiddleware: [mutation === 'copy' ? { ...middleware, handle: replacement } : middleware],
    });
    if (mutation === 'after bootstrap') middleware.handle = replacement;
    if (mutation === 'accessor') Object.defineProperty(middleware, 'handle', { get: () => replacement });
    const scope = vi.spyOn(root, 'createRequestScope');
    const request = createRequest();
    const match = mapping.match(request);
    if (!match) throw new Error('Missing route');
    const response = createResponse();
    expect(await dispatcher.dispatchNativeRoute?.(match, request, response)).toBe(false);
    expect(response.headers).toEqual({});
    await dispatcher.dispatch(request, response);
    expect(events).toEqual(['custom:before', 'custom:after']);
    expect(response.headers).toMatchObject(defaultHeaders);
    expect(response.headers['X-Fluo-Path']).toContain('full;');
    expect(scope).toHaveBeenCalledTimes(1);
  },
);

it('preserves application/module order and keeps shared mappings dispatcher-local', async () => {
  const events: string[] = [];
  const middleware = (label: string): Middleware => ({
    async handle(context, next) {
      events.push(`${label}:before:${context.response.headers['X-Frame-Options'] ?? 'unset'}`);
      await next();
      events.push(`${label}:after`);
    },
  });
  @Controller('/security')
  class OrderedController {
    @Get('/')
    getValue() { events.push('handler'); return { ok: true }; }
  }
  const root = new Container().register(OrderedController);
  const mapping = createHandlerMapping([{ controllerToken: OrderedController }]);
  const fast = createFixture({ rootContainer: root, handlerMapping: mapping });
  const full = createFixture({
    rootContainer: root,
    handlerMapping: mapping,
    appMiddleware: [middleware('before'), createSecurityHeadersMiddleware(), middleware('after')],
  });
  const response = createResponse();
  await full.dispatcher.dispatch(createRequest(), response);
  expect(events).toEqual(['before:before:unset', 'after:before:SAMEORIGIN', 'handler', 'after:after', 'before:after']);
  expect(getDispatcherFastPathStats(full.dispatcher)?.fastPathRoutes).toBe(0);
  expect(getDispatcherFastPathStats(fast.dispatcher)?.fastPathRoutes).toBe(1);
  const fastResponse = createResponse();
  await fast.dispatcher.dispatch(createRequest(), fastResponse);
  expect(fastResponse.headers['X-Fluo-Path']).toContain('fast;');

  events.length = 0;
  const module = createFixture({
    rootContainer: root,
    handlerMapping: createHandlerMapping([{ controllerToken: OrderedController, moduleMiddleware: [middleware('module')] }]),
  });
  await module.dispatcher.dispatch(createRequest(), createResponse());
  expect(events).toEqual(['module:before:SAMEORIGIN', 'handler', 'module:after']);
  expect(getDispatcherFastPathStats(module.dispatcher)?.fastPathRoutes).toBe(0);
});

it('retains full dispatch for request-scoped controller graphs', async () => {
  @Scope('request')
  class Dependency {}
  @Inject(Dependency)
  @Controller('/security')
  class ScopedController {
    constructor(readonly dependency: Dependency) {}
    @Get('/')
    getValue() { return { ok: true }; }
  }
  const root = new Container().register(Dependency, ScopedController);
  const { dispatcher } = createFixture({ rootContainer: root }, ScopedController);
  const scope = vi.spyOn(root, 'createRequestScope');
  const response = createResponse();
  await dispatcher.dispatch(createRequest(), response);
  expect(response.headers).toMatchObject(defaultHeaders);
  expect(getDispatcherFastPathStats(dispatcher)?.fastPathRoutes).toBe(0);
  expect(scope).toHaveBeenCalledTimes(1);
});
