import { defineControllerMetadata, defineRouteMetadata } from '@fluojs/core/internal';
import { Container } from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

import { All, Controller, Get, Query, Route, Version } from './decorators.js';
import { InvalidRoutePathError, RouteConflictError } from './errors.js';
import { createHandlerMapping } from './mapping.js';
import { isMiddlewareRouteConfig, runMiddlewareChain } from './middleware/middleware.js';
import type {
  CallHandler,
  FrameworkRequest,
  FrameworkResponse,
  Guard,
  GuardContext,
  Interceptor,
  InterceptorContext,
  Middleware,
  MiddlewareContext,
  Next,
} from './types.js';
import { VersioningType } from './types.js';

function createMiddlewareContext(path: string, container: Container): MiddlewareContext {
  const request: FrameworkRequest = {
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
  const response: FrameworkResponse = {
    committed: false,
    headers: {},
    redirect() {},
    send() {},
    setHeader() {},
    setStatus() {},
  };

  return {
    request,
    requestContext: { container, metadata: {}, request, response },
    response,
  };
}

describe('handler mapping', () => {
  it('normalizes paths and extracts path params', () => {
    @Controller('//users/')
    class UsersController {
      @Get('/:id/')
      getUser() {
        return { ok: true };
      }
    }

    const mapping = createHandlerMapping([
      {
        controllerToken: UsersController,
      },
    ]);

    const match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/42/',
      query: {},
      raw: {},
      url: '/users/42/',
    });

    expect(match).toMatchObject({
      descriptor: {
        controllerToken: UsersController,
        methodName: 'getUser',
        route: {
          method: 'GET',
          path: '/users/:id',
        },
      },
      params: {
        id: '42',
      },
    });
  });

  it('freezes mapping snapshots without freezing caller metadata', () => {
    class RouteGuard implements Guard {
      canActivate(_context: GuardContext): boolean {
        return true;
      }
    }

    class RouteInterceptor implements Interceptor {
      intercept(_context: InterceptorContext, next: CallHandler) {
        return next.handle();
      }
    }

    class UsersController {
      getUser() {
        return { ok: true };
      }
    }

    const route = {
      guards: [RouteGuard],
      headers: [{ name: 'x-source', value: 'original' }],
      interceptors: [RouteInterceptor],
      method: 'GET',
      path: '/:id',
      produces: ['application/json'],
      redirect: { statusCode: 308, url: '/users/next' },
    };
    defineControllerMetadata(UsersController, { basePath: '/users' });
    defineRouteMetadata(UsersController.prototype, 'getUser', route);

    const mapping = createHandlerMapping([{ controllerToken: UsersController }]);
    const descriptor = mapping.descriptors[0];

    route.path = '/:slug';
    route.headers[0]!.value = 'mutated';

    const header = descriptor.route.headers?.[0];
    if (header === undefined) {
      throw new Error('Expected descriptor route headers.');
    }

    expect(Reflect.set(mapping.descriptors, mapping.descriptors.length, descriptor)).toBe(false);
    expect(Reflect.set(descriptor.route, 'path', '/users/:slug')).toBe(false);
    expect(Reflect.set(descriptor.metadata.pathParams, descriptor.metadata.pathParams.length, 'slug')).toBe(false);
    expect(Reflect.set(header, 'value', 'mutated')).toBe(false);
    expect(Reflect.set(descriptor.route.redirect!, 'url', '/users/mutated')).toBe(false);
    expect(Object.isFrozen(mapping.descriptors)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.metadata)).toBe(true);
    expect(Object.isFrozen(descriptor.metadata.pathParams)).toBe(true);
    expect(Object.isFrozen(descriptor.route)).toBe(true);
    expect(Object.isFrozen(descriptor.route.guards)).toBe(true);
    expect(Object.isFrozen(descriptor.route.headers)).toBe(true);
    expect(Object.isFrozen(descriptor.route.headers?.[0])).toBe(true);
    expect(Object.isFrozen(descriptor.route.interceptors)).toBe(true);
    expect(Object.isFrozen(descriptor.route.produces)).toBe(true);
    expect(Object.isFrozen(descriptor.route.redirect)).toBe(true);
    expect(Object.isFrozen(route)).toBe(false);
    expect(Object.isFrozen(route.guards)).toBe(false);
    expect(Object.isFrozen(route.headers)).toBe(false);
    expect(Object.isFrozen(route.interceptors)).toBe(false);
    expect(Object.isFrozen(route.produces)).toBe(false);
    expect(Object.isFrozen(route.redirect)).toBe(false);
    expect(descriptor.route.headers).toEqual([{ name: 'x-source', value: 'original' }]);

    const match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/42',
      query: {},
      raw: {},
      url: '/users/42',
    });

    expect(match).toMatchObject({
      descriptor: {
        route: {
          headers: [{ name: 'x-source', value: 'original' }],
          path: '/users/:id',
        },
      },
      params: { id: '42' },
    });
    expect(match?.descriptor).toBe(descriptor);
  });

  it('keeps matching bound to an immutable exposed descriptor snapshot', () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      getUser() {
        return { ok: true };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: UsersController }]);
    const descriptor = mapping.descriptors[0];
    const descriptorsProperty = Object.getOwnPropertyDescriptor(mapping, 'descriptors');

    expect(Reflect.set(mapping, 'descriptors', [])).toBe(false);
    expect(mapping.descriptors).toContain(descriptor);
    expect(descriptorsProperty).toMatchObject({
      configurable: false,
      writable: false,
    });
    expect(Object.isFrozen(mapping)).toBe(false);
    const match = vi.spyOn(mapping, 'match');

    const result = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/42',
      query: {},
      raw: {},
      url: '/users/42',
    });

    expect(result?.descriptor).toBe(descriptor);
    expect(match).toHaveBeenCalledOnce();
  });

  it('isolates route middleware matching from source input mutation', async () => {
    const events: string[] = [];

    class RouteMiddleware implements Middleware {
      async handle(_context: MiddlewareContext, next: Next) {
        events.push('middleware');
        await next();
      }
    }

    @Controller('/users')
    class UsersController {
      @Get('/:id')
      getUser() {
        return { ok: true };
      }
    }

    const sourceConfig = { middleware: RouteMiddleware, routes: ['/users/*'] };
    const mapping = createHandlerMapping([{
      controllerToken: UsersController,
      moduleMiddleware: [sourceConfig],
    }]);
    const descriptor = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/42',
      query: {},
      raw: {},
      url: '/users/42',
    })?.descriptor;

    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error('Expected a matching descriptor.');
    }

    sourceConfig.routes[0] = '/admin/*';

    const mappedConfig = descriptor.metadata.moduleMiddleware[0];
    expect(isMiddlewareRouteConfig(mappedConfig)).toBe(true);
    if (!isMiddlewareRouteConfig(mappedConfig)) {
      throw new Error('Expected a mapped middleware route config.');
    }

    expect(mappedConfig).not.toBe(sourceConfig);
    expect(mappedConfig).toMatchObject({ routes: ['/users/*'] });
    expect(Object.isFrozen(mappedConfig)).toBe(true);
    expect(Object.isFrozen(mappedConfig.routes)).toBe(true);

    const container = new Container().register(RouteMiddleware);
    await runMiddlewareChain(
      descriptor.metadata.moduleMiddleware,
      createMiddlewareContext('/users/42', container),
      async () => {
        events.push('terminal');
      },
    );

    expect(events).toEqual(['middleware', 'terminal']);
  });

  it('prevents public middleware snapshot mutation from changing matching', async () => {
    const events: string[] = [];

    class RouteMiddleware implements Middleware {
      async handle(_context: MiddlewareContext, next: Next) {
        events.push('middleware');
        await next();
      }
    }

    @Controller('/users')
    class UsersController {
      @Get('/:id')
      getUser() {
        return { ok: true };
      }
    }

    const sourceConfig = { middleware: RouteMiddleware, routes: ['/users/*'] };
    const mapping = createHandlerMapping([{
      controllerToken: UsersController,
      moduleMiddleware: [sourceConfig],
    }]);
    const descriptor = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/42',
      query: {},
      raw: {},
      url: '/users/42',
    })?.descriptor;

    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error('Expected a matching descriptor.');
    }

    const mappedConfig = descriptor.metadata.moduleMiddleware[0];

    expect(isMiddlewareRouteConfig(mappedConfig)).toBe(true);
    if (!isMiddlewareRouteConfig(mappedConfig)) {
      throw new Error('Expected a mapped middleware route config.');
    }

    expect(Reflect.set(mappedConfig.routes, 0, '/admin/*')).toBe(false);
    expect(mappedConfig.middleware).toBe(RouteMiddleware);
    expect(mappedConfig.routes).toEqual(['/users/*']);

    const container = new Container().register(RouteMiddleware);
    await runMiddlewareChain(
      descriptor.metadata.moduleMiddleware,
      createMiddlewareContext('/users/42', container),
      async () => {
        events.push('terminal');
      },
    );

    expect(events).toEqual(['middleware', 'terminal']);
  });

  it('fails fast on duplicate normalized route registrations', () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      first() {
        return { ok: true };
      }
    }

    @Controller('//health//')
    class DuplicateHealthController {
      @Get('')
      second() {
        return { ok: true };
      }
    }

    expect(() =>
      createHandlerMapping([
        { controllerToken: HealthController },
        { controllerToken: DuplicateHealthController },
      ]),
    ).toThrow(RouteConflictError);
  });

  it('detects duplicates after custom method canonicalization', () => {
    @Controller('/search')
    class SearchController {
      @Query('/')
      first() {
        return { route: 'query' };
      }

      @Route('query', '/')
      second() {
        return { route: 'custom' };
      }
    }

    expect(() => createHandlerMapping([{ controllerToken: SearchController }])).toThrow(RouteConflictError);
  });

  it('rejects unsupported syntax in imperatively defined route metadata', () => {
    class InvalidController {
      list() {
        return { ok: true };
      }
    }

    defineControllerMetadata(InvalidController, { basePath: '/reports' });
    defineRouteMetadata(InvalidController.prototype, 'list', {
      method: 'GET',
      path: '/summary/:reportId.json',
    });

    expect(() => createHandlerMapping([{ controllerToken: InvalidController }])).toThrow(InvalidRoutePathError);
  });

  it('applies controller and route version metadata to URI paths', () => {
    @Version('1')
    @Controller('/users')
    class UsersController {
      @Get('/')
      listUsers() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Get('/:id')
      getUser() {
        return { ok: true };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: UsersController }]);

    const listMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/v1/users',
      query: {},
      raw: {},
      url: '/v1/users',
    });

    const detailMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/v2/users/42',
      query: {},
      raw: {},
      url: '/v2/users/42',
    });

    const unversionedMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(listMatch).toMatchObject({
      descriptor: {
        metadata: { effectiveVersion: '1' },
        route: {
          path: '/v1/users',
          version: '1',
        },
      },
    });
    expect(detailMatch).toMatchObject({
      descriptor: {
        metadata: { effectiveVersion: '2' },
        route: {
          path: '/v2/users/:id',
          version: '2',
        },
      },
      params: { id: '42' },
    });
    expect(unversionedMatch).toBeUndefined();
  });

  it('fails fast when URI version aliases normalize to the same route', () => {
    @Version('1')
    @Controller('/users')
    class UsersV1Controller {
      @Get('/')
      listUsers() {
        return [{ id: '1' }];
      }
    }

    @Version('v1')
    @Controller('/users')
    class UsersAliasController {
      @Get('/')
      listUsersAlias() {
        return [{ id: '1' }];
      }
    }

    expect(() =>
      createHandlerMapping([
        { controllerToken: UsersV1Controller },
        { controllerToken: UsersAliasController },
      ]),
    ).toThrow(RouteConflictError);
  });

  it('resolves versions from configured request headers', () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Get('/')
      listV2() {
        return [{ id: '2' }];
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: UsersController }],
      { versioning: { header: 'x-api-version', type: VersioningType.HEADER } },
    );

    const v1Match = mapping.match({
      body: undefined,
      cookies: {},
      headers: { 'x-api-version': '1' },
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    const v2Match = mapping.match({
      body: undefined,
      cookies: {},
      headers: { 'X-API-Version': '2' },
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    const missingVersionMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(v1Match?.descriptor.methodName).toBe('listV1');
    expect(v2Match?.descriptor.methodName).toBe('listV2');
    expect(missingVersionMatch).toBeUndefined();
  });

  it('resolves versions from Accept media type parameters', () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Get('/')
      listV2() {
        return [{ id: '2' }];
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: UsersController }],
      { versioning: { key: 'v=', type: VersioningType.MEDIA_TYPE } },
    );

    const v2Match = mapping.match({
      body: undefined,
      cookies: {},
      headers: { accept: 'application/json;v=2' },
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(v2Match?.descriptor.methodName).toBe('listV2');
  });

  it('scans duplicate-case Accept headers until a non-empty media type version is found', () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Get('/')
      listV2() {
        return [{ id: '2' }];
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: UsersController }],
      { versioning: { key: 'v=', type: VersioningType.MEDIA_TYPE } },
    );

    const v2Match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {
        accept: '   ',
        Accept: 'application/json; v=2',
      },
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(v2Match?.descriptor.methodName).toBe('listV2');
  });

  it('combines duplicate-case Accept headers before scanning for media type versions', () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Get('/')
      listV2() {
        return [{ id: '2' }];
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: UsersController }],
      { versioning: { key: 'v=', type: VersioningType.MEDIA_TYPE } },
    );

    const v2Match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {
        accept: 'application/json',
        Accept: 'application/json; v=2',
      },
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(v2Match?.descriptor.methodName).toBe('listV2');
  });

  it('resolves versions from custom extractor functions', () => {
    @Controller('/users')
    class UsersController {
      @Version('1')
      @Get('/')
      listV1() {
        return [{ id: '1' }];
      }

      @Version('2')
      @Get('/')
      listV2() {
        return [{ id: '2' }];
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: UsersController }],
      {
        versioning: {
          extractor: (request) => {
            const raw = request.headers['x-custom-version'];
            return Array.isArray(raw) ? raw[0] : raw;
          },
          type: VersioningType.CUSTOM,
        },
      },
    );

    const v1Match = mapping.match({
      body: undefined,
      cookies: {},
      headers: { 'x-custom-version': '1' },
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(v1Match?.descriptor.methodName).toBe('listV1');
  });

  it('falls back to unversioned routes when request version is missing', () => {
    @Controller('/users')
    class UsersController {
      @Get('/')
      listDefault() {
        return [{ id: 'default' }];
      }

      @Version('2')
      @Get('/')
      listV2() {
        return [{ id: '2' }];
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: UsersController }],
      { versioning: { header: 'x-api-version', type: VersioningType.HEADER } },
    );

    const fallbackMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users',
      query: {},
      raw: {},
      url: '/users',
    });

    expect(fallbackMatch?.descriptor.methodName).toBe('listDefault');
  });

  it('preserves registration order among same method and segment count routes', () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      firstMatch() {
        return { route: 'first' };
      }

      @Get('/:slug')
      secondMatch() {
        return { route: 'second' };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: UsersController }]);
    const match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/users/42',
      query: {},
      raw: {},
      url: '/users/42',
    });

    expect(match?.descriptor.methodName).toBe('firstMatch');
    expect(match?.params).toEqual({ id: '42' });
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) (
    'prefers an existing explicit %s route before ALL',
    (method) => {
      class ExplicitController {
        handle() {
          return { route: 'explicit' };
        }
      }

      class AllController {
        handle() {
          return { route: 'all' };
        }
      }

      defineControllerMetadata(ExplicitController, { basePath: '/precedence' });
      defineRouteMetadata(ExplicitController.prototype, 'handle', { method, path: '/' });
      defineControllerMetadata(AllController, { basePath: '/precedence' });
      defineRouteMetadata(AllController.prototype, 'handle', { method: 'ALL', path: '/' });

      const mapping = createHandlerMapping([
        { controllerToken: AllController },
        { controllerToken: ExplicitController },
      ]);
      const match = mapping.match({
        body: undefined,
        cookies: {},
        headers: {},
        method,
        params: {},
        path: '/precedence',
        query: {},
        raw: {},
        url: '/precedence',
      });

      expect(match?.descriptor.controllerToken).toBe(ExplicitController);
      expect(match?.descriptor.route.method).toBe(method);
    },
  );

  it('preserves custom method version selection, exact precedence, and ALL fallback', () => {
    @Controller('/search')
    class SearchController {
      @Version('1')
      @Query('/:scope')
      queryV1() {
        return { route: 'query-v1' };
      }

      @Version('2')
      @Route('purge', '/:scope')
      purgeV2() {
        return { route: 'purge-v2' };
      }

      @All('/:scope')
      fallback() {
        return { route: 'all' };
      }
    }

    const mapping = createHandlerMapping(
      [{ controllerToken: SearchController }],
      { versioning: { header: 'x-api-version', type: VersioningType.HEADER } },
    );
    const request = (method: string, version?: string) => mapping.match({
      body: undefined,
      cookies: {},
      headers: version === undefined ? {} : { 'x-api-version': version },
      method,
      params: {},
      path: '/search/cache',
      query: {},
      raw: {},
      url: '/search/cache',
    });

    expect(request('query', '1')?.descriptor.methodName).toBe('queryV1');
    expect(request('PURGE', '2')?.descriptor.methodName).toBe('purgeV2');
    expect(request('BREW')?.descriptor.methodName).toBe('fallback');
  });

  it('prefers method-specific static routes before ALL fallbacks on the same path', () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { route: 'get' };
      }
    }

    class AnyMethodController {
      any() {
        return { route: 'all' };
      }
    }

    defineControllerMetadata(AnyMethodController, { basePath: '/health' });
    defineRouteMetadata(AnyMethodController.prototype, 'any', {
      method: 'ALL',
      path: '/',
    });

    const mapping = createHandlerMapping([
      { controllerToken: AnyMethodController },
      { controllerToken: HealthController },
    ]);

    const match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/health',
      query: {},
      raw: {},
      url: '/health',
    });

    expect(match?.descriptor.methodName).toBe('getHealth');
    expect(match?.descriptor.route.method).toBe('GET');
  });

  it('prefers ALL exact-version static routes before method-specific unversioned fallback', () => {
    @Controller('/health')
    class HealthController {
      @Get('/')
      getHealth() {
        return { route: 'get' };
      }
    }

    class AnyMethodController {
      any() {
        return { route: 'all-versioned' };
      }
    }

    defineControllerMetadata(AnyMethodController, { basePath: '/health' });
    defineRouteMetadata(AnyMethodController.prototype, 'any', {
      method: 'ALL',
      path: '/',
      version: '2',
    });

    const mapping = createHandlerMapping(
      [
        { controllerToken: HealthController },
        { controllerToken: AnyMethodController },
      ],
      { versioning: { header: 'x-api-version', type: VersioningType.HEADER } },
    );

    const versionedMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: { 'x-api-version': '2' },
      method: 'GET',
      params: {},
      path: '/health',
      query: {},
      raw: {},
      url: '/health',
    });

    const fallbackMatch = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '/health',
      query: {},
      raw: {},
      url: '/health',
    });

    expect(versionedMatch?.descriptor.methodName).toBe('any');
    expect(versionedMatch?.descriptor.route.method).toBe('ALL');
    expect(fallbackMatch?.descriptor.methodName).toBe('getHealth');
    expect(fallbackMatch?.descriptor.route.method).toBe('GET');
  });

  it('normalizes incoming static paths before direct lookup', () => {
    @Controller('//health//')
    class HealthController {
      @Get('///')
      getHealth() {
        return { route: 'get' };
      }
    }

    const mapping = createHandlerMapping([{ controllerToken: HealthController }]);
    const match = mapping.match({
      body: undefined,
      cookies: {},
      headers: {},
      method: 'GET',
      params: {},
      path: '///health///',
      query: {},
      raw: {},
      url: '///health///',
    });

    expect(match?.descriptor.methodName).toBe('getHealth');
    expect(match?.descriptor.route.path).toBe('/health');
  });
});
