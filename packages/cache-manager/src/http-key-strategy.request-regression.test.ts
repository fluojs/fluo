import { Controller, Get, type RequestContext, UseInterceptors } from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { MemoryStore } from './stores/memory-store.js';

describe('CacheModule HTTP key strategy defaults', () => {
  it.each(['route', 'route+query'] as const)(
    '%s caching distinguishes an absent issuer from every explicit issuer string',
    async (httpKeyStrategy) => {
      let handlerCalls = 0;
      const store = new MemoryStore();

      @Controller('/items')
      class ItemController {
        @Get('/:id')
        @UseInterceptors(CacheInterceptor)
        detail(_input: undefined, context: RequestContext) {
          handlerCalls += 1;
          return {
            handlerCalls,
            issuer: context.principal?.issuer ?? null,
            subject: context.principal?.subject,
          };
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        controllers: [ItemController],
        imports: [CacheModule.forRoot({ store, httpKeyStrategy })],
      });
      const app = await Test.createApp({ rootModule: AppModule });
      const principals: Array<{ issuer?: string; subject: string }> = [
        { subject: 'alice' },
        { issuer: 'unknown', subject: 'alice' },
        { issuer: '', subject: 'alice' },
        { subject: ':alice' },
        { issuer: ':', subject: 'alice' },
      ];
      const requests = principals.map((principal) => app.request('GET', '/items/1').principal(principal));

      try {
        const responses = [];
        for (const request of requests) {
          responses.push(await request.send());
        }

        for (const [index, principal] of principals.entries()) {
          expect(responses[index].status).toBe(200);
          expect(responses[index].body).toEqual({
            handlerCalls: index + 1,
            issuer: principal.issuer ?? null,
            subject: principal.subject,
          });
          expect((await requests[index].send()).body).toEqual(responses[index].body);
        }
        expect(handlerCalls).toBe(principals.length);
        await expect(store.get('/items/1|principal:alice')).resolves.toEqual(responses[0].body);
        await expect(store.get('/items/1|principal:unknown:alice')).resolves.toEqual(responses[1].body);
      } finally {
        await app.close();
      }
    },
  );

  it.each(['anonymous', 'principal', 'resolver'] as const)(
    'route+query caching distinguishes question marks in paths from query parameters for %s requests',
    async (scope) => {
      let handlerCalls = 0;
      const store = new MemoryStore();

      @Controller('/items')
      class ItemController {
        @Get('/:id')
        @UseInterceptors(CacheInterceptor)
        detail(_input: undefined, context: RequestContext) {
          handlerCalls += 1;
          return { handlerCalls, path: context.request.path, query: context.request.query };
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        controllers: [ItemController],
        imports: [CacheModule.forRoot({
          store,
          httpKeyStrategy: 'route+query',
          principalScopeResolver: scope === 'resolver' ? () => 'tenant-a' : undefined,
        })],
      });
      const app = await Test.createApp({ rootModule: AppModule });
      const pathRequest = app.request('GET', '/items/1?page=1');
      const queryRequest = app.request('GET', '/items/1').query('page', '1');
      const percentRequest = app.request('GET', '/items/1%3Fpage=1');
      if (scope === 'principal') {
        for (const request of [pathRequest, queryRequest, percentRequest]) {
          request.principal({ issuer: 'issuer-a', subject: 'alice' });
        }
      }
      const suffix = scope === 'principal'
        ? '|principal:issuer-a:alice'
        : scope === 'resolver' ? '|principal:tenant-a' : '';

      try {
        const pathResponse = await pathRequest.send();
        const queryResponse = await queryRequest.send();
        const percentResponse = await percentRequest.send();

        expect([pathResponse.status, queryResponse.status, percentResponse.status]).toEqual([200, 200, 200]);
        expect(pathResponse.body).toEqual({ handlerCalls: 1, path: '/items/1?page=1', query: {} });
        expect(queryResponse.body).toEqual({ handlerCalls: 2, path: '/items/1', query: { page: '1' } });
        expect(percentResponse.body).toEqual({ handlerCalls: 3, path: '/items/1%3Fpage=1', query: {} });
        expect((await pathRequest.send()).body).toEqual(pathResponse.body);
        expect((await queryRequest.send()).body).toEqual(queryResponse.body);
        expect((await percentRequest.send()).body).toEqual(percentResponse.body);
        expect(handlerCalls).toBe(3);
        await expect(store.get(`/items/1%3Fpage=1${suffix}`)).resolves.toEqual(pathResponse.body);
        await expect(store.get(`/items/1?page=1${suffix}`)).resolves.toEqual(queryResponse.body);
        await expect(store.get(`/items/1%253Fpage=1${suffix}`)).resolves.toEqual(percentResponse.body);
      } finally {
        await app.close();
      }
    },
  );

  it.each([
    { strategy: 'route', query: false },
    { strategy: 'route+query', query: false },
    { strategy: 'route+query', query: true },
  ] as const)(
    '$strategy caching with query=$query keeps principal-shaped paths separate from authenticated responses',
    async ({ strategy, query }) => {
      let handlerCalls = 0;
      const store = new MemoryStore();

      @Controller('/items')
      class ItemController {
        @Get('/:id')
        @UseInterceptors(CacheInterceptor)
        detail() {
          handlerCalls += 1;
          return { handlerCalls };
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        controllers: [ItemController],
        imports: [CacheModule.forRoot({ store, httpKeyStrategy: strategy })],
      });
      const app = await Test.createApp({ rootModule: AppModule });
      const target = query ? '/items/1?page=1' : '/items/1';
      const authenticated = app.request('GET', '/items/1')
        .principal({ issuer: 'issuer-a', subject: 'alice' });
      if (query) {
        authenticated.query('page', '1');
      }

      try {
        const first = await authenticated.send();
        const anonymous = await app.request('GET', `${target}|principal:issuer-a:alice`).send();
        const repeated = await authenticated.send();

        expect(first.status).toBe(200);
        expect(anonymous.status).toBe(200);
        expect(first.body).toEqual({ handlerCalls: 1 });
        expect(anonymous.body).toEqual({ handlerCalls: 2 });
        expect(repeated.body).toEqual(first.body);
        expect(handlerCalls).toBe(2);
        await expect(store.get(`${target}|principal:issuer-a:alice`)).resolves.toEqual(first.body);
      } finally {
        await app.close();
      }
    },
  );

  it.each(['route', 'route+query'] as const)(
    '%s caching keeps resolver scopes containing separators separate from anonymous and differently scoped paths',
    async (httpKeyStrategy) => {
      let handlerCalls = 0;
      const store = new MemoryStore();

      @Controller('/items')
      class ItemController {
        @Get('/:id')
        @UseInterceptors(CacheInterceptor)
        detail() {
          handlerCalls += 1;
          return { handlerCalls };
        }
      }

      class AppModule {}
      defineModule(AppModule, {
        controllers: [ItemController],
        imports: [CacheModule.forRoot({
          store,
          httpKeyStrategy,
          principalScopeResolver: (context) => {
            const scope = context.requestContext.request.headers['x-cache-scope'];
            return typeof scope === 'string' ? scope : undefined;
          },
        })],
      });
      const app = await Test.createApp({ rootModule: AppModule });
      const scoped = app.request('GET', '/items/1')
        .header('x-cache-scope', 'tenant-a|principal:tenant-b');

      try {
        const first = await scoped.send();
        const anonymous = await app.request('GET', '/items/1|principal:tenant-a|principal:tenant-b').send();
        const differentScope = await app.request('GET', '/items/1|principal:tenant-a')
          .header('x-cache-scope', 'tenant-b').send();
        const percentScope = await app.request('GET', '/items/1')
          .header('x-cache-scope', 'tenant-a%7Cprincipal:tenant-b').send();
        const repeated = await scoped.send();

        expect([first.status, anonymous.status, differentScope.status, percentScope.status]).toEqual([200, 200, 200, 200]);
        expect(first.body).toEqual({ handlerCalls: 1 });
        expect(anonymous.body).toEqual({ handlerCalls: 2 });
        expect(differentScope.body).toEqual({ handlerCalls: 3 });
        expect(percentScope.body).toEqual({ handlerCalls: 4 });
        expect(repeated.body).toEqual(first.body);
        expect(handlerCalls).toBe(4);
        await expect(store.get('/items/1|principal:tenant-a%7Cprincipal:tenant-b')).resolves.toEqual(first.body);
      } finally {
        await app.close();
      }
    },
  );

  it.each(['parameter names', 'repeated values'])('reuses reversed Unicode %s and isolates distinct strings', async (part) => {
    let handlerCalls = 0;

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptors(CacheInterceptor)
      list() {
        handlerCalls += 1;
        return { handlerCalls };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot()],
    });

    const app = await Test.createApp({ rootModule: AppModule });
    const strings = ['\u00e9', 'e\u0301', '\u00e4', 'a', 'B'];
    const firstRequest = app.request('GET', '/products');
    const reversedRequest = app.request('GET', '/products');
    const composedRequest = app.request('GET', '/products').query('tag', '\u00e9');
    const decomposedRequest = app.request('GET', '/products').query('tag', 'e\u0301');
    if (part === 'parameter names') {
      for (const name of strings) {
        firstRequest.query(name, '1');
      }
      for (const name of [...strings].reverse()) {
        reversedRequest.query(name, '1');
      }
    } else {
      firstRequest.query('tag', strings);
      reversedRequest.query('tag', [...strings].reverse());
    }
    const collation = vi.spyOn(String.prototype, 'localeCompare').mockReturnValue(0);

    try {
      const first = await firstRequest.send();
      const reversed = await reversedRequest.send();
      const composed = await composedRequest.send();
      const decomposed = await decomposedRequest.send();
      const repeatedComposed = await composedRequest.send();

      expect(first.status).toBe(200);
      expect(reversed.status).toBe(200);
      expect(first.body).toEqual({ handlerCalls: 1 });
      expect(reversed.body).toEqual({ handlerCalls: 1 });
      expect(composed.body).toEqual({ handlerCalls: 2 });
      expect(decomposed.body).toEqual({ handlerCalls: 3 });
      expect(repeatedComposed.body).toEqual({ handlerCalls: 2 });
      expect(handlerCalls).toBe(3);
    } finally {
      collation.mockRestore();
      await app.close();
    }
  });

  it('keeps distinct query values separate and canonicalizes equivalent query order', async () => {
    let handlerCalls = 0;

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptors(CacheInterceptor)
      list() {
        handlerCalls += 1;

        return { handlerCalls };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [CacheModule.forRoot()],
    });

    const app = await Test.createApp({ rootModule: AppModule });

    try {
      const firstQuery = await app.request('GET', '/products').query('category', 'shirts').send();
      const distinctQuery = await app.request('GET', '/products').query('category', 'shoes').send();
      const repeatedFirstQuery = await app.request('GET', '/products').query('category', 'shirts').send();
      const canonicalQuery = await app
        .request('GET', '/products')
        .query('limit', '10')
        .query('sort', 'name')
        .send();
      const reorderedEquivalentQuery = await app
        .request('GET', '/products')
        .query('sort', 'name')
        .query('limit', '10')
        .send();

      expect(firstQuery.body).toEqual({ handlerCalls: 1 });
      expect(distinctQuery.body).toEqual({ handlerCalls: 2 });
      expect(repeatedFirstQuery.body).toEqual({ handlerCalls: 1 });
      expect(canonicalQuery.body).toEqual({ handlerCalls: 3 });
      expect(reorderedEquivalentQuery.body).toEqual({ handlerCalls: 3 });
      expect(handlerCalls).toBe(3);
    } finally {
      await app.close();
    }
  });
});
