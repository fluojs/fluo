import { getModuleMetadata } from '@fluojs/core/internal';
import { describe, expect, it, vi } from 'vitest';

import { CacheModule } from './module.js';
import { CacheService } from './service.js';
import { CACHE_OPTIONS } from './tokens.js';
import type {
  CacheStore,
  NormalizedCacheModuleOptions,
  NormalizedCacheTtlJitterOptions,
} from './types.js';

const baseOptions: NormalizedCacheModuleOptions = {
  global: false,
  keyPrefix: 'fluo:cache:',
  store: 'memory',
  ttl: 0,
  httpKeyStrategy: 'route',
  principalScopeResolver: undefined,
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

function createCacheService(store: CacheStore, options: Partial<NormalizedCacheModuleOptions> = {}) {
  return new CacheService(store, { ...baseOptions, ...options });
}

function jitter(
  ratio: number,
  random: () => number,
  mode: NormalizedCacheTtlJitterOptions['mode'] = 'symmetric',
): NormalizedCacheTtlJitterOptions {
  return { mode, random, ratio };
}

function createSequenceRandom(values: readonly number[]): () => number {
  let index = 0;

  return () => {
    const value = values[index % values.length] ?? 0;
    index += 1;
    return value;
  };
}

describe('CacheService — opt-in TTL jitter', () => {
  it('writes the exact resolved TTL when jitter is not configured', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, { ttl: 600 });

    await cache.set('posts:recent', ['a']);

    expect(store.writes).toEqual([{ key: 'posts:recent', ttlSeconds: 600 }]);
  });

  it('spreads a shared positive TTL across keys written in the same tick', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 600,
      ttlJitter: jitter(0.1, createSequenceRandom([0, 0.25, 0.5, 0.75, 1])),
    });

    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.set('d', 4);
    await cache.set('e', 5);

    expect(store.writes.map((write) => write.ttlSeconds)).toEqual([540, 570, 600, 630, 660]);
  });

  it('applies jitter to a per-call TTL override instead of the module default', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 600,
      ttlJitter: jitter(0.5, () => 1),
    });

    await cache.set('override', 'value', 100);

    expect(store.writes).toEqual([{ key: 'override', ttlSeconds: 150 }]);
  });

  it('only shortens TTL in shorten mode and only lengthens TTL in lengthen mode', async () => {
    const shortenStore = new RecordingStore();
    const shortenCache = createCacheService(shortenStore, {
      ttl: 600,
      ttlJitter: jitter(0.2, createSequenceRandom([0.5, 1]), 'shorten'),
    });

    await shortenCache.set('short:half', 1);
    await shortenCache.set('short:max', 2);

    const lengthenStore = new RecordingStore();
    const lengthenCache = createCacheService(lengthenStore, {
      ttl: 600,
      ttlJitter: jitter(0.2, createSequenceRandom([0.5, 1]), 'lengthen'),
    });

    await lengthenCache.set('long:half', 1);
    await lengthenCache.set('long:max', 2);

    expect(shortenStore.writes.map((write) => write.ttlSeconds)).toEqual([540, 480]);
    expect(lengthenStore.writes.map((write) => write.ttlSeconds)).toEqual([660, 720]);
  });

  it('keeps ttl 0 as a no-expiry write instead of jittering it into an expiring entry', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 0,
      ttlJitter: jitter(0.5, () => 1),
    });

    await cache.set('forever', 'value');

    expect(store.writes).toEqual([{ key: 'forever', ttlSeconds: 0 }]);
  });

  it('keeps invalid TTL values non-writing even when jitter is configured', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 600,
      ttlJitter: jitter(0.5, () => 0),
    });

    await cache.set('negative', 'value', -1);
    await cache.set('not-a-number', 'value', Number.NaN);
    await cache.set('infinite', 'value', Number.POSITIVE_INFINITY);

    expect(store.writes).toEqual([]);
  });

  it('never collapses a jittered positive TTL into the no-expiry value', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 10,
      ttlJitter: jitter(1, () => 1, 'shorten'),
    });

    await cache.set('floor', 'value');

    const [write] = store.writes;

    expect(write?.ttlSeconds).toBeGreaterThan(0);
  });

  it('jitters a remember write through the same seam', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 600,
      ttlJitter: jitter(0.1, () => 0),
    });
    const loader = vi.fn(async () => 'loaded');

    await expect(cache.remember('remembered', loader)).resolves.toBe('loaded');

    expect(store.writes).toEqual([{ key: 'remembered', ttlSeconds: 540 }]);
  });

  it('ignores an out-of-range random sample by clamping it into the configured bounds', async () => {
    const store = new RecordingStore();
    const cache = createCacheService(store, {
      ttl: 600,
      ttlJitter: jitter(0.5, createSequenceRandom([-3, 4, Number.NaN])),
    });

    await cache.set('low', 'value');
    await cache.set('high', 'value');
    await cache.set('nan', 'value');

    expect(store.writes.map((write) => write.ttlSeconds)).toEqual([300, 900, 600]);
  });
});

function readNormalizedOptions(module: ReturnType<typeof CacheModule.forRoot>): NormalizedCacheModuleOptions {
  const providers = getModuleMetadata(module)?.providers ?? [];
  const optionsProvider = providers.find(
    (provider: unknown): provider is { provide: typeof CACHE_OPTIONS; useValue: NormalizedCacheModuleOptions } =>
      typeof provider === 'object' &&
      provider !== null &&
      'provide' in provider &&
      'useValue' in provider &&
      provider.provide === CACHE_OPTIONS,
  );

  if (!optionsProvider) {
    throw new Error('Cache module registration did not expose normalized options.');
  }

  return optionsProvider.useValue;
}

describe('CacheModule.forRoot — TTL jitter configuration', () => {
  it('leaves jitter disabled when the option is omitted', () => {
    expect(readNormalizedOptions(CacheModule.forRoot({ ttl: 600 })).ttlJitter).toBeUndefined();
  });

  it('normalizes a configured jitter option to an explicit mode', () => {
    const random = () => 0.5;

    expect(readNormalizedOptions(CacheModule.forRoot({ ttl: 600, ttlJitter: { ratio: 0.2, random } })).ttlJitter).toEqual({
      mode: 'symmetric',
      random,
      ratio: 0.2,
    });
  });

  it('rejects an unusable jitter ratio at module registration', () => {
    expect(() => CacheModule.forRoot({ ttl: 600, ttlJitter: { ratio: 0 } })).toThrow(
      '@fluojs/cache-manager ttlJitter.ratio must be a finite number greater than 0 and at most 1.',
    );
    expect(() => CacheModule.forRoot({ ttl: 600, ttlJitter: { ratio: 1.5 } })).toThrow(
      '@fluojs/cache-manager ttlJitter.ratio must be a finite number greater than 0 and at most 1.',
    );
  });

  it('rejects an invalid jitter mode from untyped consumers', () => {
    expect(() =>
      Reflect.apply(CacheModule.forRoot, CacheModule, [{ ttlJitter: { mode: 'sideways', ratio: 0.1 } }]),
    ).toThrow("@fluojs/cache-manager ttlJitter.mode must be 'symmetric', 'shorten', or 'lengthen'.");
  });

  it('rejects an invalid random source from untyped consumers', () => {
    expect(() => Reflect.apply(CacheModule.forRoot, CacheModule, [{ ttlJitter: { random: 1, ratio: 0.1 } }])).toThrow(
      '@fluojs/cache-manager ttlJitter.random must be a function when provided.',
    );
  });
});
