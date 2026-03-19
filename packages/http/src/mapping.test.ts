import { describe, expect, it } from 'vitest';

import { Controller, Get, Version } from './decorators.js';
import { RouteConflictError } from './errors.js';
import { createHandlerMapping } from './mapping.js';

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
});
