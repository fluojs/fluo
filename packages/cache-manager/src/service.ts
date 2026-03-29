import { Inject } from '@konekti/core';

import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

@Inject([CACHE_STORE, CACHE_OPTIONS])
export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly invalidationVersion = new Map<string, number>();
  private resetVersion = 0;

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
    const keyVersion = this.invalidationVersion.get(key) ?? 0;
    const resetVersion = this.resetVersion;
    const cached = await this.get<T>(key);

    if (cached !== undefined) {
      return cached;
    }

    const existing = this.inflight.get(key) as Promise<T> | undefined;

    if (existing) {
      return existing;
    }

    const promise = loader().then(async (value) => {
      const currentKeyVersion = this.invalidationVersion.get(key) ?? 0;

      if (currentKeyVersion !== keyVersion || this.resetVersion !== resetVersion) {
        return value;
      }

      await this.set(key, value, ttlSeconds);
      return value;
    }).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  async del(key: string): Promise<void> {
    this.invalidationVersion.set(key, (this.invalidationVersion.get(key) ?? 0) + 1);
    await this.store.del(key);
  }

  async reset(): Promise<void> {
    this.resetVersion += 1;
    this.invalidationVersion.clear();
    await this.store.reset();
  }
}
