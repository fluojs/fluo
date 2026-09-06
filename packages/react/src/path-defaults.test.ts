import { Module } from '@fluojs/core';
import { getRouteMetadata } from '@fluojs/core/internal';
import type { FrameworkResponse } from '@fluojs/http';
import { createHandlerMapping, InvalidRoutePathError, RouteConflictError } from '@fluojs/http';
import {
  createReactPageCatalog,
  createReactServerEntry,
  getReactPathMetadata,
  Path,
  ReactModule,
  Router,
} from '@fluojs/react';
import { bootstrapApplication, createRuntimeRouteCatalog } from '@fluojs/runtime';
import { getRuntimeRouteInspectionMetadata } from '@fluojs/runtime/internal';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

describe('React Path defaults', () => {
  it('preserves HTTP, React, and inspection metadata with absent options', () => {
    // Given / When
    @Router()
    class Pages {
      @Path()
      omitted() {}
      @Path(undefined)
      undefinedPath() {}
      @Path('')
      empty() {}
    }

    // Then
    for (const key of ['omitted', 'undefinedPath', 'empty']) {
      expect(getRouteMetadata(Pages.prototype, key)).toEqual(getRouteMetadata(Pages.prototype, 'empty'));
      expect(getReactPathMetadata(Pages, key)).toEqual({ kind: 'path', path: '' });
      expect(Object.hasOwn(getReactPathMetadata(Pages, key) ?? {}, 'options')).toBe(false);
      expect(getRuntimeRouteInspectionMetadata(Pages, key)).toEqual({ kind: 'react-page' });
      expect(getRuntimeRouteInspectionMetadata(Pages, key)).toEqual(
        getRuntimeRouteInspectionMetadata(Pages, 'empty'),
      );
    }
  });

  it.each([
    { label: 'omitted', factory: () => Path() },
    { label: 'undefined', factory: () => Path(undefined) },
    { label: 'empty', factory: () => Path('') },
    { label: 'slash', factory: () => Path('/') },
  ])('dispatches $label pages and resolves catalogs at root and prefixed Router', async ({ factory }) => {
    for (const prefix of [undefined, '/cats']) {
      // Given
      @Router(prefix)
      class Pages {
        @factory()
        index() {
          return createElement('main', null, 'cats');
        }
      }
      @Module({
        imports: [ReactModule.forRoot({
          controllers: [Pages],
          renderPage: (page) => createReactServerEntry(page),
        })],
      })
      class App {}
      const app = await bootstrapApplication({ rootModule: App });
      const response: FrameworkResponse & { body?: unknown } = {
        headers: {},
        committed: false,
        setHeader(name, value) { this.headers[name] = value; },
        setStatus(code) { this.statusCode = code; this.statusSet = true; },
        send(value) { this.body = value; this.committed = true; },
        redirect(status, location) { this.setStatus(status); this.setHeader('Location', location); },
      };
      const path = prefix ?? '/';

      try {
        // When
        await app.dispatch({
          method: 'GET', path, url: path, raw: {}, headers: {}, cookies: {}, params: {}, query: {},
        }, response);
        const descriptors = app.dispatcher.describeRoutes?.();
        if (!descriptors) {
          throw new TypeError('Expected bootstrap-resolved route descriptors.');
        }

        // Then
        expect(response.statusCode).toBe(200);
        expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
        expect(response.body).toBeInstanceOf(Uint8Array);
        if (!(response.body instanceof Uint8Array)) {
          throw new TypeError('Expected rendered HTML bytes.');
        }
        expect(new TextDecoder().decode(response.body)).toBe('<main>cats</main>');
        expect(createReactPageCatalog(descriptors)).toMatchObject([
          { kind: 'react-page', method: 'GET', path, params: [], router: 'Pages', handler: 'index' },
        ]);
        expect(createRuntimeRouteCatalog(descriptors)).toMatchObject([
          { kind: 'react-page', method: 'GET', path },
        ]);
      } finally {
        await app.close();
      }
    }
  });

  it('keeps explicit options without defaulting the options argument', () => {
    @Router()
    class Pages {
      @Path(undefined, { view: 'index' })
      index() {}
    }
    expect(getReactPathMetadata(Pages, 'index')).toEqual({ kind: 'path', path: '', options: { view: 'index' } });
  });

  it('rejects colliding normalized routes and invalid paths', () => {
    @Router('/cats')
    class Pages {
      @Path()
      omitted() {}
      @Path('/')
      slash() {}
    }
    expect(() => createHandlerMapping([{ controllerToken: Pages }])).toThrow(RouteConflictError);
    for (const path of ['/files/*', '/files?', '/(.*)', '/user-:id', '/:id.json']) {
      expect(() => Path(path)).toThrow(InvalidRoutePathError);
    }
    expect(() => Reflect.apply(Path, undefined, [null])).toThrow(TypeError);
  });
});
