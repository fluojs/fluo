import { Inject, type Token } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { REDIS_CLIENT } from '@fluojs/redis';
import { FluoFactory, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import { CACHE_OPTIONS } from './tokens.js';
import type {
  CacheAsyncModuleOptions,
  CacheModuleOptions,
  CacheObservation,
  CacheObserver,
  CacheStore,
  RedisCompatibleClient,
} from './types.js';

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

class CacheSettingsService {
  readonly ttl = 42;
}

@Inject(CacheService)
class CacheConsumer {
  constructor(readonly cache: CacheService) {}
}

describe('CacheModule.forRootAsync', () => {
  describe.each(['root', 'sync factory', 'async factory'] as const)('%s remember policy', (registration) => {
    it.each([undefined, 'throw', 'bypass'] as const)('applies rememberCacheErrors %s to the resolved service', async (rememberCacheErrors) => {
      const failure = new Error('store read failed');
      const store = new RecordingStore();
      vi.spyOn(store, 'get').mockRejectedValue(failure);
      const options: CacheModuleOptions = { store, rememberCacheErrors };
      const useFactory = vi.fn(() => registration === 'async factory' ? Promise.resolve(options) : options);
      const module = registration === 'root'
        ? CacheModule.forRoot(options)
        : CacheModule.forRootAsync({ useFactory });
      expect(useFactory).not.toHaveBeenCalled();
      class AppModule {}
      defineModule(AppModule, { imports: [module], providers: [CacheConsumer] });
      const app = await FluoFactory.create(AppModule);

      try {
        const consumer = await app.container.resolve(CacheConsumer);
        const loader = vi.fn(async () => 'loaded');
        expect(await app.container.resolve(CACHE_OPTIONS)).toMatchObject({
          rememberCacheErrors: rememberCacheErrors ?? 'throw',
        });

        const result = consumer.cache.remember('key', loader);

        if (rememberCacheErrors === 'bypass') {
          await expect(result).resolves.toBe('loaded');
          expect(loader).toHaveBeenCalledTimes(1);
          expect(store.entries.get('key')).toBe('loaded');
        } else {
          await expect(result).rejects.toBe(failure);
          expect(loader).not.toHaveBeenCalled();
        }
      } finally {
        await app.close();
      }
    });
  });

  it.each(['sync', 'async'])('rejects invalid rememberCacheErrors from a %s factory only at resolution', async (kind) => {
    const options: CacheModuleOptions = {};
    Object.defineProperty(options, 'rememberCacheErrors', { enumerable: true, value: null });
    const useFactory = vi.fn(() => kind === 'async' ? Promise.resolve(options) : options);
    const module = CacheModule.forRootAsync({ useFactory });
    expect(useFactory).not.toHaveBeenCalled();
    class AppModule {}
    defineModule(AppModule, { imports: [module], providers: [CacheConsumer] });

    await expect(FluoFactory.create(AppModule).then(async (app) => {
      await app.close();
    })).rejects.toThrow(/rememberCacheErrors.*"throw".*"bypass"/);
    expect(useFactory).toHaveBeenCalledTimes(1);
  });

  describe.each(['sync', 'async'])('%s factory store validation', (kind) => {
    it.each([
      { label: 'unknown string', store: 'mongo', error: /store.*"memory".*"redis"/ },
      { label: 'empty string', store: '', error: /store.*"memory".*"redis"/ },
      { label: 'empty object', store: {}, error: /store.*get.*set.*del.*reset/ },
      ...(['get', 'set', 'del', 'reset'] as const).flatMap((method) =>
        ['missing', 'non-callable'].map((shape) => {
          const store = {
            get: async () => undefined,
            set: async () => undefined,
            del: async () => undefined,
            reset: async () => undefined,
          };
          if (shape === 'missing') {
            Reflect.deleteProperty(store, method);
          } else {
            Object.defineProperty(store, method, { value: 42 });
          }
          return { label: `${shape} ${method}`, store, error: new RegExp(`store.*${method}`) };
        }),
      ),
    ])('rejects $label at bootstrap before constructing a cache consumer', async ({ store, error }) => {
      const options: CacheModuleOptions = {};
      Object.defineProperty(options, 'store', { enumerable: true, value: store });
      const useFactory = vi.fn(() => kind === 'async' ? Promise.resolve(options) : options);
      const consumerCreated = vi.fn();
      @Inject(CacheService)
      class Consumer {
        constructor(readonly cache: CacheService) {
          consumerCreated();
        }
      }

      const cacheModule = CacheModule.forRootAsync({ useFactory });

      expect(useFactory).not.toHaveBeenCalled();
      class AppModule {}
      defineModule(AppModule, { imports: [cacheModule], providers: [Consumer] });
      const bootstrap = FluoFactory.create(AppModule);
      // Close a mistakenly accepted app as well, so RED does not leak resources.
      await expect(bootstrap.then(async (app) => {
        await app.close();
      })).rejects.toThrow(error);
      expect(useFactory).toHaveBeenCalledTimes(1);
      expect(consumerCreated).not.toHaveBeenCalled();
    });
  });

  it('validates a deferred factory result only after it resolves', async () => {
    let signalStarted!: () => void;
    let resolveOptions!: (options: CacheModuleOptions) => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const result = new Promise<CacheModuleOptions>((resolve) => {
      resolveOptions = resolve;
    });
    const options: CacheModuleOptions = {};
    Object.defineProperty(options, 'store', { enumerable: true, value: 'mongo' });
    const useFactory = vi.fn(() => {
      signalStarted();
      return result;
    });
    const cacheModule = CacheModule.forRootAsync({ useFactory });
    expect(useFactory).not.toHaveBeenCalled();
    class AppModule {}
    defineModule(AppModule, { imports: [cacheModule], providers: [CacheConsumer] });
    const bootstrap = FluoFactory.create(AppModule);
    const rejected = expect(bootstrap.then(async (app) => {
      await app.close();
    })).rejects.toThrow(/store.*"memory".*"redis"/);
    await started;

    resolveOptions(options);

    await rejected;
  });

  it.each([{}, { store: undefined }, { store: 'memory' }] satisfies CacheModuleOptions[])(
    'keeps memory defaults and usable cache operations for factory result %j',
    async (options) => {
      class AppModule {}
      defineModule(AppModule, {
        imports: [CacheModule.forRootAsync({ useFactory: async () => options })],
        providers: [CacheConsumer],
      });

      const app = await FluoFactory.create(AppModule);

      try {
        expect(await app.container.resolve(CACHE_OPTIONS)).toMatchObject({ store: 'memory', ttl: 300 });
        const consumer = await app.container.resolve(CacheConsumer);
        await consumer.cache.set('default', 'value');
        await expect(consumer.cache.get('default')).resolves.toBe('value');
      } finally {
        await app.close();
      }
    },
  );

  it('resolves injected dependencies and normalizes factory options once', async () => {
    const factoryCalls: CacheSettingsService[] = [];

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CacheModule.forRootAsync({
          inject: [CacheSettingsService],
          useFactory: async (settings: CacheSettingsService) => {
            factoryCalls.push(settings);

            return { keyPrefix: 'async:cache:', store: 'memory' as const, ttl: settings.ttl };
          },
        }),
      ],
      providers: [CacheConsumer],
    });

    const app = await FluoFactory.create(AppModule, {
      providers: [{ provide: CacheSettingsService, useValue: new CacheSettingsService() }],
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
        httpKeyStrategy: 'route+query',
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

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(/local-cache-settings/);
  });

  it('owns global visibility from the async registration option instead of an untrusted factory property', () => {
    const untrustedFactoryResult: Awaited<ReturnType<CacheAsyncModuleOptions['useFactory']>> = {
      store: 'memory',
    };
    Object.defineProperty(untrustedFactoryResult, 'global', { enumerable: true, value: true });

    const localModule = CacheModule.forRootAsync({ useFactory: () => untrustedFactoryResult });
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

    await expect(FluoFactory.create(AppModule)).rejects.toThrow(
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
    const app = await FluoFactory.create(AppModule, {
      providers: [
        { provide: REDIS_KEY_PREFIX, useValue: 'tenant-async:cache:' },
        { provide: REDIS_CLIENT, useValue: redisClient },
      ],
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

    const app = await FluoFactory.create(AppModule);

    try {
      const consumer = await app.container.resolve(CacheConsumer);

      await consumer.cache.set('/custom', { ok: true }, 15);

      expect(store.entries.get('/custom')).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('registers an observer returned by the async factory with CacheService', async () => {
    // Given: an async factory returning a recording observer.
    const observations: CacheObservation[] = [];
    const observer: CacheObserver = {
      onCacheOperation(observation) {
        observations.push(observation);
      },
    };
    class AppModule {}
    defineModule(AppModule, {
      imports: [CacheModule.forRootAsync({ useFactory: () => ({ observer, store: 'memory' }) })],
      providers: [CacheConsumer],
    });
    const app = await FluoFactory.create(AppModule);

    try {
      const consumer = await app.container.resolve(CacheConsumer);

      // When: the injected cache service reads a missing value.
      await consumer.cache.get('factory-observer-key');

      // Then: the factory-supplied observer receives the privacy-safe operation outcome.
      expect(observations).toEqual([
        { durationMs: expect.any(Number), operation: 'get', outcome: 'miss' },
      ]);
    } finally {
      await app.close();
    }
  });
});
