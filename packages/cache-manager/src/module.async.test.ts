import { Inject, type Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import { CACHE_OPTIONS } from './tokens.js';
import type { CacheStore, RedisCompatibleClient } from './types.js';

class MemoryRedisClient implements RedisCompatibleClient {
  readonly storage = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: Array<string | number>): Promise<'OK'> {
    this.storage.set(key, value);
    return 'OK';
  }

  async del(key: string, ...keys: string[]): Promise<number> {
    let deleted = 0;

    for (const current of [key, ...keys]) {
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

    const matchIndex = args.indexOf('MATCH');
    const pattern = String(args[matchIndex + 1] ?? '*');
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;

    return ['0', Array.from(this.storage.keys()).filter((key) => key.startsWith(prefix))];
  }
}

class RecordingStore implements CacheStore {
  readonly entries = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async reset(): Promise<void> {
    this.entries.clear();
  }
}

@Inject(CacheService)
class CacheConsumer {
  constructor(readonly cache: CacheService) {}
}

describe('CacheModule.forRootAsync', () => {
  it('resolves injected dependencies and normalizes factory options once', async () => {
    const CACHE_SETTINGS = Symbol('cache-settings') as Token<{ readonly ttl: number }>;
    const factoryCalls: Array<{ readonly ttl: number }> = [];

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CacheModule.forRootAsync({
          inject: [CACHE_SETTINGS],
          useFactory: async (...deps: unknown[]) => {
            const settings = deps[0] as { readonly ttl: number };
            factoryCalls.push(settings);

            return { keyPrefix: 'async:cache:', store: 'memory' as const, ttl: settings.ttl };
          },
        }),
      ],
      providers: [CacheConsumer],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: CACHE_SETTINGS, useValue: { ttl: 42 } }],
      rootModule: AppModule,
    });

    try {
      const consumer = await app.container.resolve(CacheConsumer);
      const interceptor = await app.container.resolve(CacheInterceptor);
      const resolvedOptions = await app.container.resolve(CACHE_OPTIONS);

      await consumer.cache.set('/async', { ok: true });

      expect(interceptor).toBeInstanceOf(CacheInterceptor);
      expect(factoryCalls).toEqual([{ ttl: 42 }]);
      expect(resolvedOptions).toMatchObject({
        global: false,
        httpKeyStrategy: 'route',
        keyPrefix: 'async:cache:',
        store: 'memory',
        ttl: 42,
      });
      await expect(consumer.cache.get('/async')).resolves.toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('rejects dependencies that are local to the importing parent module', async () => {
    const LOCAL_CACHE_SETTINGS = Symbol('local-cache-settings') as Token<{ readonly ttl: number }>;

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CacheModule.forRootAsync({
          inject: [LOCAL_CACHE_SETTINGS],
          useFactory: (...deps: unknown[]) => ({ store: 'memory', ttl: (deps[0] as { ttl: number }).ttl }),
        }),
      ],
      providers: [
        CacheConsumer,
        { provide: LOCAL_CACHE_SETTINGS, useValue: { ttl: 10 } },
      ],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(/local-cache-settings/);
  });

  it('owns global visibility from the async registration option instead of the factory result', () => {
    const localModule = CacheModule.forRootAsync({ useFactory: () => ({ global: true, store: 'memory' }) });
    const globalModule = CacheModule.forRootAsync({ global: true, useFactory: () => ({ store: 'memory' }) });

    expect(getModuleMetadata(localModule)?.global).toBe(false);
    expect(getModuleMetadata(globalModule)?.global).toBe(true);
  });

  it('propagates a rejected factory as a bootstrap failure', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CacheModule.forRootAsync({
          useFactory: async () => {
            throw new Error('cache configuration source unavailable');
          },
        }),
      ],
      providers: [CacheConsumer],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'cache configuration source unavailable',
    );
  });

  it('supports the redis store with an injected client resolved through the factory', async () => {
    const REDIS_KEY_PREFIX = Symbol('redis-key-prefix') as Token<string>;

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CacheModule.forRootAsync({
          inject: [REDIS_KEY_PREFIX],
          useFactory: (...deps: unknown[]) => ({
            keyPrefix: deps[0] as string,
            store: 'redis' as const,
          }),
        }),
      ],
      providers: [CacheConsumer],
    });

    const redisClient = new MemoryRedisClient();
    const app = await bootstrapApplication({
      providers: [
        { provide: REDIS_KEY_PREFIX, useValue: 'tenant-async:cache:' },
        { provide: REDIS_CLIENT, useValue: redisClient },
      ],
      rootModule: AppModule,
    });

    try {
      const consumer = await app.container.resolve(CacheConsumer);

      await consumer.cache.set('/users', { count: 5 }, 30);

      expect(JSON.parse(redisClient.storage.get('tenant-async:cache:/users') ?? 'null')).toMatchObject({
        value: { count: 5 },
      });
    } finally {
      await app.close();
    }
  });

  it('supports a custom store instance returned by the factory', async () => {
    const store = new RecordingStore();

    class AppModule {}
    defineModule(AppModule, {
      imports: [CacheModule.forRootAsync({ useFactory: async () => ({ store }) })],
      providers: [CacheConsumer],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      const consumer = await app.container.resolve(CacheConsumer);

      await consumer.cache.set('/custom', { ok: true }, 15);

      expect(store.entries.get('/custom')).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});
