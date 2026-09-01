import { describe, expect, it } from 'vitest';

import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import type { CacheStore, NormalizedCacheModuleOptions, NormalizedCacheTtlJitterOptions } from './types.js';

const baseOptions: NormalizedCacheModuleOptions = {
  global: false,
  httpKeyStrategy: 'route',
  keyPrefix: 'fluo:cache:',
  principalScopeResolver: undefined,
  store: 'memory',
  ttl: 0,
  ttlJitter: undefined,
};

class TtlRecordingStore implements CacheStore {
  readonly ttlValues: Array<number | undefined> = [];

  async get<T>(): Promise<T | undefined> {
    return undefined;
  }

  async set<T>(_key: string, _value: T, ttlSeconds?: number): Promise<void> {
    this.ttlValues.push(ttlSeconds);
  }

  async del(): Promise<void> {}

  async reset(): Promise<void> {}
}

function createCacheService(store: CacheStore, jitter: NormalizedCacheTtlJitterOptions): CacheService {
  return new CacheService(store, { ...baseOptions, ttlJitter: jitter });
}

describe('CacheModule.forRoot — malformed TTL jitter options', () => {
  it.each([null, false, 0, '', []])('rejects non-object ttlJitter value %#', (ttlJitter) => {
    expect(() => Reflect.apply(CacheModule.forRoot, CacheModule, [{ ttlJitter }])).toThrow(
      '@fluojs/cache-manager ttlJitter must be an options object when provided.',
    );
  });
});

describe('CacheService — TTL jitter numeric boundaries', () => {
  it.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, -0.001, 1.001])(
    'rejects invalid random sample %s',
    async (sample) => {
      const store = new TtlRecordingStore();
      const cache = createCacheService(store, { mode: 'symmetric', random: () => sample, ratio: 0.1 });

      await expect(cache.set('invalid-sample', 'value', 10)).rejects.toThrow(
        '@fluojs/cache-manager ttlJitter.random must return a finite number from 0 through 1.',
      );

      expect(store.ttlValues).toEqual([]);
    },
  );

  it('keeps a fully shortened sub-millisecond TTL positive without raising its upper bound', async () => {
    const store = new TtlRecordingStore();
    const cache = createCacheService(store, { mode: 'shorten', random: () => 1, ratio: 1 });

    await cache.set('sub-millisecond', 'value', 0.0005);

    expect(store.ttlValues).toEqual([Number.MIN_VALUE]);
  });

  it('keeps maximum finite TTL lengthening finite without crossing the representable upper bound', async () => {
    const store = new TtlRecordingStore();
    const cache = createCacheService(store, { mode: 'lengthen', random: () => 1, ratio: 1 });

    await cache.set('maximum', 'value', Number.MAX_VALUE);

    expect(store.ttlValues).toEqual([Number.MAX_VALUE]);
  });

  it.each([
    { expected: Number.MIN_VALUE, sample: 0, ttl: 0.0005 },
    { expected: Number.MAX_VALUE, sample: 1, ttl: Number.MAX_VALUE },
  ])('keeps symmetric boundary result finite for ttl=$ttl and sample=$sample', async ({ expected, sample, ttl }) => {
    const store = new TtlRecordingStore();
    const cache = createCacheService(store, { mode: 'symmetric', random: () => sample, ratio: 1 });

    await cache.set('symmetric-boundary', 'value', ttl);

    expect(store.ttlValues).toEqual([expected]);
  });
});
