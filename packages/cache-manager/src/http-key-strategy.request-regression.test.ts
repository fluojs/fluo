import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { MemoryStore } from './stores/memory-store.js';

describe('CacheModule HTTP key strategy defaults', () => {
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
