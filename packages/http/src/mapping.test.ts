import { describe, expect, it } from 'vitest';

import { Controller, Get, Version } from './decorators.js';
import { RouteConflictError } from './errors.js';
import { createHandlerMapping } from './mapping.js';
import { VersioningType } from './types.js';

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
});
