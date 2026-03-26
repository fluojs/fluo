import { Inject } from '@konekti/core';

import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

@Inject([CACHE_STORE, CACHE_OPTIONS])
export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: CacheStore,
    private readonly options: NormalizedCacheModuleOptions,
  ) {}

  get<T = unknown>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get<T>(key));
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const resolvedTtl = ttlSeconds ?? this.options.ttl;

    if (!Number.isFinite(resolvedTtl) || resolvedTtl < 0) {
      return;
    }

    await this.store.set<T>(key, value, resolvedTtl);
  }

  async remember<T = unknown>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);

    if (cached !== undefined) {
      return cached;
    }

    const existing = this.inflight.get(key) as Promise<T> | undefined;

    if (existing) {
      return existing;
    }

    const promise = loader().then(async (value) => {
      await this.set(key, value, ttlSeconds);
      return value;
    }).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  async del(key: string): Promise<void> {
    await this.store.del(key);
  }

  async reset(): Promise<void> {
    await this.store.reset();
  }
}
