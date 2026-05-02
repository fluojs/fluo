import { Inject } from '@fluojs/core';

import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

/**
 * Application-level cache facade used for direct cache reads, writes, and read-through loading.
 */
@Inject(CACHE_STORE, CACHE_OPTIONS)
export class CacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly pendingLoads = new Map<string, number>();
  private readonly invalidatedInflight = new Set<string>();
  private closed = false;
  private resetVersion = 0;

  private beginPendingLoad(key: string): void {
    this.pendingLoads.set(key, (this.pendingLoads.get(key) ?? 0) + 1);
  }

  private endPendingLoad(key: string): void {
    const remaining = (this.pendingLoads.get(key) ?? 0) - 1;

    if (remaining > 0) {
      this.pendingLoads.set(key, remaining);
      return;
    }

    this.pendingLoads.delete(key);
  }

  constructor(
    private readonly store: CacheStore,
    private readonly options: NormalizedCacheModuleOptions,
  ) {}

  /**
   * Read a cached value by key.
   *
   * @param key Cache entry key.
   * @returns The cached value, or `undefined` when the key is missing or expired.
   */
  get<T = unknown>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get<T>(key));
  }

  /**
   * Store a value in the configured cache store.
   *
   * @param key Cache entry key.
   * @param value Value to cache.
   * @param ttlSeconds Optional per-call TTL override in seconds.
   * @returns A promise that resolves after the write completes.
   */
  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const resolvedTtl = ttlSeconds ?? this.options.ttl;

    if (!Number.isFinite(resolvedTtl) || resolvedTtl < 0) {
      return;
    }

    await this.store.set<T>(key, value, resolvedTtl);
  }

  /**
   * Load a value through the cache, de-duplicating concurrent misses for the same key.
   *
   * @param key Cache entry key.
   * @param loader Async loader invoked on cache miss.
   * @param ttlSeconds Optional per-call TTL override in seconds.
   * @returns The cached or freshly loaded value.
   */
  async remember<T = unknown>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    this.beginPendingLoad(key);

    try {
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
        if (this.invalidatedInflight.has(key) || this.resetVersion !== resetVersion) {
          return value;
        }

        await this.set(key, value, ttlSeconds);

        if (this.invalidatedInflight.has(key) || this.resetVersion !== resetVersion) {
          await this.store.del(key);
        }

        return value;
      }).finally(() => {
        this.inflight.delete(key);
        this.invalidatedInflight.delete(key);
      });

      this.inflight.set(key, promise);
      return promise;
    } finally {
      this.endPendingLoad(key);
    }
  }

  /**
   * Delete a single cache entry.
   *
   * @param key Cache entry key.
   * @returns A promise that resolves after the entry is removed.
   */
  async del(key: string): Promise<void> {
    if (this.pendingLoads.has(key) || this.inflight.has(key)) {
      this.invalidatedInflight.add(key);
    }

    await this.store.del(key);
  }

  /**
   * Clear every cache entry owned by the configured store.
   *
   * @returns A promise that resolves after the store reset completes.
   */
  async reset(): Promise<void> {
    this.resetVersion += 1;
    this.inflight.clear();
    this.pendingLoads.clear();
    this.invalidatedInflight.clear();
    await this.store.reset();
  }

  /**
   * Close the configured store when it exposes an optional teardown hook.
   *
   * @returns A promise that resolves after store teardown completes.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.inflight.clear();
    this.pendingLoads.clear();
    this.invalidatedInflight.clear();

    if (this.store.close) {
      await this.store.close();
      return;
    }

    if (this.store.dispose) {
      await this.store.dispose();
    }
  }

  /**
   * Runtime shutdown hook that releases resource-owning stores during application close.
   *
   * @returns A promise that resolves after store teardown completes.
   */
  onModuleDestroy(): Promise<void> {
    return this.close();
  }
}
