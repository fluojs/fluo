import { Controller, type FrameworkRequest, type FrameworkResponse, Get, UseInterceptors } from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheInterceptor } from './interceptor.js';
import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import { MemoryStore } from './stores/memory-store.js';
import { RedisStore } from './stores/redis-store.js';
import type {
  CacheStore,
  NormalizedCacheModuleOptions,
  NormalizedCacheTtlJitterOptions,
  RedisCompatibleClient,
} from './types.js';

const baseOptions: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 0,
  ttlJitter: undefined,
};

interface RecordedWrite {
  key: string;
  ttlSeconds: number | undefined;
}

class RecordingStore implements CacheStore {
  readonly writes: RecordedWrite[] = [];

  async get<T>(): Promise<T | undefined> {
    return undefined;
  }

  async set<T>(key: string, _value: T, ttlSeconds?: number): Promise<void> {
    this.writes.push({ key, ttlSeconds });
  }

  async del(): Promise<void> {}

  async reset(): Promise<void> {}
}

function createCacheService(
  store: CacheStore,
  ttlJitter: NormalizedCacheTtlJitterOptions,
  ttl = 600,
): CacheService {
  return new CacheService(store, { ...baseOptions, ttl, ttlJitter });
}

function createRequest(path: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: undefined,
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  const response: FrameworkResponse & { body?: unknown } = {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      response.setStatus(status);
      response.setHeader('Location', location);
      response.committed = true;
    },
    send(body: unknown) {
      response.body = body;
      response.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      response.headers[name] = value;
    },
    setStatus(code: number) {
      response.statusCode = code;
    },
    statusCode: 200,
  };

  return response;
}

describe('CacheInterceptor — TTL jitter on the HTTP cache path', () => {
  it('writes a jittered TTL for a cached GET response through the real dispatch pipeline', async () => {
    const store = new RecordingStore();

    @Controller('/products')
    @UseInterceptors(CacheInterceptor)
    class ProductController {
      @Get('/')
      list() {
        return { items: ['a'] };
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [ProductController],
      imports: [
        CacheModule.forRoot({
          store,
          ttl: 600,
          ttlJitter: { mode: 'lengthen', random: () => 1, ratio: 0.25 },
        }),
      ],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    try {
      await app.dispatch(createRequest('/products'), createResponse());

      expect(store.writes).toEqual([{ key: '/products', ttlSeconds: 750 }]);
    } finally {
      await app.close();
    }
  });
});

class MemoryRedisClient implements RedisCompatibleClient {
  readonly expiries: Array<number | undefined> = [];
  readonly storage = new Map<string, string>();

  async del(): Promise<number> {
    return 0;
  }

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async scan(): Promise<[string, string[]]> {
    return ['0', []];
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK'> {
    const expiryIndex = args.indexOf('EX');

    this.expiries.push(expiryIndex >= 0 ? Number(args[expiryIndex + 1]) : undefined);
    this.storage.set(key, value);
    return 'OK';
  }
}

describe('CacheService — TTL jitter store parity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies one jittered TTL before store handoff on the memory and Redis paths', async () => {
    const memoryStore = new MemoryStore();
    const memorySet = vi.spyOn(memoryStore, 'set');
    const jitter: NormalizedCacheTtlJitterOptions = {
      mode: 'lengthen',
      random: () => 1,
      ratio: 0.5,
    };
    const memoryCache = createCacheService(memoryStore, jitter);
    const redisClient = new MemoryRedisClient();
    const redisCache = createCacheService(new RedisStore(redisClient, { keyPrefix: 'test:' }), jitter);

    await memoryCache.set('parity', 'value');
    await redisCache.set('parity', 'value');

    expect(memorySet).toHaveBeenCalledWith('parity', 'value', 900);
    expect(redisClient.expiries).toEqual([900]);
  });

  it('round-trips a maximum lengthened TTL through memory and Redis with finite Redis expiry metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    const value = { source: 'maximum-ttl' };
    const jitter: NormalizedCacheTtlJitterOptions = {
      mode: 'lengthen',
      random: () => 1,
      ratio: 1,
    };
    const memoryStore = new MemoryStore();
    const memoryCache = createCacheService(memoryStore, jitter, Number.MAX_VALUE);
    const redisClient = new MemoryRedisClient();
    const redisCache = createCacheService(new RedisStore(redisClient, { keyPrefix: 'test:' }), jitter, Number.MAX_VALUE);

    await memoryCache.set('maximum', value);
    await redisCache.set('maximum', value);

    expect(await memoryCache.get('maximum')).toEqual(value);
    await expect(redisCache.get('maximum')).resolves.toEqual(value);
    expect(redisClient.expiries).toHaveLength(1);
    expect(Number.isSafeInteger(redisClient.expiries[0] ?? Number.NaN)).toBe(true);

    const memoryEntries: unknown = Reflect.get(memoryStore, 'entries');

    if (!(memoryEntries instanceof Map)) {
      throw new Error('MemoryStore did not retain its cache entries.');
    }

    const memoryEntry: unknown = memoryEntries.get('maximum');
    const storedEntry: unknown = JSON.parse(redisClient.storage.get('test:maximum') ?? '{}');

    if (typeof memoryEntry !== 'object' || memoryEntry === null || typeof storedEntry !== 'object' || storedEntry === null) {
      throw new Error('Built-in cache stores did not retain maximum TTL entries.');
    }

    const memoryExpiresAt = Reflect.get(memoryEntry, 'expiresAt');
    const redisExpiresAt = Reflect.get(storedEntry, 'expiresAt');

    expect(Number.isSafeInteger(memoryExpiresAt)).toBe(true);
    expect(redisExpiresAt).toBe(memoryExpiresAt);
    expect(Number.isSafeInteger(redisExpiresAt)).toBe(true);
  });
});
