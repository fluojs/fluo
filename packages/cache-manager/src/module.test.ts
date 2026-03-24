import { describe, expect, it, vi } from 'vitest';

import { Inject, getModuleMetadata } from '@konekti/core';
import { Controller, Get, Post, UseInterceptor, type FrameworkRequest, type FrameworkResponse } from '@konekti/http';
import { bootstrapApplication, defineModule } from '@konekti/runtime';

import { CacheEvict } from './decorators.js';
import { CacheInterceptor } from './interceptor.js';
import { CACHE_MANAGER } from './tokens.js';
import { createCacheModule } from './module.js';
import type { RedisCompatibleClient } from './types.js';
import { CacheService } from './service.js';

const REDIS_CLIENT_TOKEN = Symbol.for('konekti.redis.client');

class MockRedisClient implements RedisCompatibleClient {
  readonly storage = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: Array<string | number>): Promise<'OK'> {
    this.storage.set(key, value);
    return 'OK';
  }

  async del(key: string, ...keys: string[]): Promise<number> {
    const allKeys = [key, ...keys];

    let deleted = 0;

    for (const current of allKeys) {
      if (this.storage.delete(current)) {
        deleted += 1;
      }
    }

    return deleted;
  }

  async scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]> {
    if (cursor !== '0') {
      return ['0', []];
    }

    const matchIndex = args.findIndex((value) => value === 'MATCH');
    const pattern = String(args[matchIndex + 1] ?? '*');
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;

    return ['0', Array.from(this.storage.keys()).filter((key) => key.startsWith(prefix))];
  }
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createRequest(path: string, method = 'GET', url = path): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url,
  };
}

describe('createCacheModule', () => {
  it('defaults to non-global module registration unless isGlobal is set', () => {
    const localModule = createCacheModule({ store: 'memory' });
    const globalModule = createCacheModule({ isGlobal: true, store: 'memory' });

    expect(getModuleMetadata(localModule)?.global).toBe(false);
    expect(getModuleMetadata(globalModule)?.global).toBe(true);
  });

  it('supports memory store without redis module/client installed', async () => {
    @Inject([CACHE_MANAGER])
    class Consumer {
      constructor(readonly cache: CacheService) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createCacheModule({ store: 'memory' })],
      providers: [Consumer],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const consumer = await app.container.resolve(Consumer);

    await consumer.cache.set('/health', { ok: true });

    await expect(consumer.cache.get('/health')).resolves.toEqual({ ok: true });

    await app.close();
  });

  it('fails fast at bootstrap when redis store is selected but redis client is unavailable', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [createCacheModule({ store: 'redis' })],
    });

    await expect(bootstrapApplication({ mode: 'test', rootModule: AppModule })).rejects.toThrow(
      '@konekti/cache-manager redis store requires a Redis client at bootstrap.',
    );
  });

  it('supports redis store when a raw redis-style client is provided', async () => {
    @Inject([CACHE_MANAGER])
    class Consumer {
      constructor(readonly cache: CacheService) {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createCacheModule({ store: 'redis' })],
      providers: [Consumer],
    });

    const redisClient = new MockRedisClient();
    const app = await bootstrapApplication({
      mode: 'test',
      providers: [{ provide: REDIS_CLIENT_TOKEN, useValue: redisClient }],
      rootModule: AppModule,
    });
    const consumer = await app.container.resolve(Consumer);

    await consumer.cache.set('/users', { count: 3 }, 30);

    await expect(consumer.cache.get('/users')).resolves.toEqual({ count: 3 });

    await app.close();
  });

  it('caches GET responses end-to-end and evicts after successful POST', async () => {
    const listHandler = vi.fn(() => ({ count: Date.now() }));

    @Controller('/products')
    class ProductController {
      @Get('/')
      @UseInterceptor(CacheInterceptor)
      list() {
        return listHandler();
      }

      @Post('/refresh')
      @UseInterceptor(CacheInterceptor)
      @CacheEvict('/products')
      refresh() {
        return { refreshed: true };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [createCacheModule({ store: 'memory' })],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });

    const firstGetResponse = createResponse();
    await app.dispatch(createRequest('/products', 'GET', '/products?page=1'), firstGetResponse);

    const secondGetResponse = createResponse();
    await app.dispatch(createRequest('/products', 'GET', '/products?page=9'), secondGetResponse);

    expect(firstGetResponse.body).toEqual(secondGetResponse.body);
    expect(listHandler).toHaveBeenCalledTimes(1);

    const postResponse = createResponse();
    await app.dispatch(createRequest('/products/refresh', 'POST'), postResponse);
    expect(postResponse.statusCode).toBe(201);

    const thirdGetResponse = createResponse();
    await app.dispatch(createRequest('/products', 'GET', '/products?page=1'), thirdGetResponse);

    expect(listHandler).toHaveBeenCalledTimes(2);

    await app.close();
  });
});
