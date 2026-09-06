import { getRouteMetadata } from '@fluojs/core/internal';
import * as root from '@fluojs/http';
import * as portable from '@fluojs/http/portable';
import { describe, expect, it } from 'vitest';

import { getRouteProducesMetadata } from './decorators.js';

const names = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All', 'Sse', 'Query'] as const;

describe.each([
  { entry: 'root', api: root },
  { entry: 'portable', api: portable },
])('HTTP default paths through $entry', ({ api }) => {
  const factories = [
    ...names.map((name) => ({
      name,
      factory: api[name],
      method: name === 'Sse' ? 'GET' : name.toUpperCase(),
    })),
    { name: 'Route', factory: (path?: string) => api.Route('purge', path), method: 'PURGE' },
  ];

  it.each(factories)('$name stores the same TC39 metadata for omitted, undefined, and empty paths', ({ factory, method, name }) => {
    // Given / When: each form is evaluated through the standard decorator transform.
    class Routes {
      @factory()
      omitted() {}

      @factory(undefined)
      undefinedPath() {}

      @factory('')
      empty() {}
    }

    // Then: raw metadata keeps the empty string, not a normalized slash.
    const expected = getRouteMetadata(Routes.prototype, 'empty');
    expect(expected).toMatchObject({ method, path: '' });
    for (const key of ['omitted', 'undefinedPath']) {
      expect(getRouteMetadata(Routes.prototype, key)).toEqual(expected);
      expect(getRouteProducesMetadata(Routes, key)).toEqual(
        name === 'Sse' ? ['text/event-stream'] : undefined,
      );
    }
  });

  it.each(factories)('$name preserves the existing legacy invocation path', ({ factory, method, name }) => {
    // Given
    class Routes {
      omitted() {}
      undefinedPath() {}
      empty() {}
    }

    // When: invoke exactly the legacy method signature already supported by HTTP.
    Reflect.apply(factory(), undefined, [Routes.prototype, 'omitted']);
    Reflect.apply(factory(undefined), undefined, [
      Routes.prototype, 'undefinedPath', Object.getOwnPropertyDescriptor(Routes.prototype, 'undefinedPath'),
    ]);
    Reflect.apply(factory(''), undefined, [Routes.prototype, 'empty']);

    // Then
    const expected = getRouteMetadata(Routes.prototype, 'empty');
    expect(expected).toMatchObject({ method, path: '' });
    expect(getRouteMetadata(Routes.prototype, 'omitted')).toEqual(expected);
    expect(getRouteMetadata(Routes.prototype, 'undefinedPath')).toEqual(expected);
    expect(getRouteProducesMetadata(Routes, 'omitted')).toEqual(
      name === 'Sse' ? ['text/event-stream'] : undefined,
    );
  });

  it.each(factories)('$name preserves slash equivalence, prefixes, and duplicate rejection', ({ factory, method }) => {
    for (const prefix of ['', '/cats']) {
      // Given
      @api.Controller(prefix)
      class EmptyRoute {
        @factory()
        index() {}
      }
      @api.Controller(prefix)
      class SlashRoute {
        @factory('/')
        index() {}
      }

      // When
      const empty = api.createHandlerMapping([{ controllerToken: EmptyRoute }]);
      const slash = api.createHandlerMapping([{ controllerToken: SlashRoute }]);

      // Then
      expect(empty.descriptors[0]?.route).toMatchObject({ method, path: prefix || '/' });
      expect(empty.descriptors[0]?.route.path).toBe(slash.descriptors[0]?.route.path);
      expect(() => api.createHandlerMapping([
        { controllerToken: EmptyRoute },
        { controllerToken: SlashRoute },
      ])).toThrow(api.RouteConflictError);
    }
  });

  it.each(factories)('$name does not default invalid runtime paths', ({ factory }) => {
    for (const path of ['/files/*', '/files?', '/(.*)', '/user-:id', '/:id.json']) {
      expect(() => factory(path)).toThrow(api.InvalidRoutePathError);
    }
    for (const path of [null, 42]) {
      expect(() => Reflect.apply(factory, undefined, [path])).toThrow(TypeError);
    }
  });

  it.each(['', ' ', 'QUERY METHOD', 'QUERY/METHOD', 'QUERY,METHOD', 'QUERY\tMETHOD', 'QUERY\u0000', 'méthode', 'ALL', 'all'])(
    'does not bypass method token validation for Route(%j)',
    (method) => {
      expect(() => api.Route(method)).toThrow(api.InvalidHttpMethodError);
    },
  );
});
