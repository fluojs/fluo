import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { defineModule } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';

describe('CacheModule HTTP key strategy defaults', () => {
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
