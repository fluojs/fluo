import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';

describe('CacheModule HTTP key strategy defaults', () => {
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
