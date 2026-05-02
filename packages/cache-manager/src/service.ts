import { Inject } from '@fluojs/core';

import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

interface InflightLoad<T = unknown> {
  generation: number;
  invalidated: boolean;
  promise: Promise<T>;
}

/**
 * Application-level cache facade used for direct cache reads, writes, and read-through loading.
 */
@Inject(CACHE_STORE, CACHE_OPTIONS)
export class CacheService {
  private readonly inflight = new Map<string, InflightLoad>();
  private readonly pendingLoads = new Map<string, Map<number, number>>();
  private readonly pendingInvalidations = new Map<string, number>();
  private readonly invalidatedInflight = new Set<string>();
  private closed = false;
  private resetVersion = 0;

  private beginPendingLoad(key: string, generation: number): void {
    const generations = this.pendingLoads.get(key) ?? new Map<number, number>();

    generations.set(generation, (generations.get(generation) ?? 0) + 1);
    this.pendingLoads.set(key, generations);
  }

  private endPendingLoad(key: string, generation: number): void {
    const generations = this.pendingLoads.get(key);

    if (!generations) {
      return;
    }

    const remaining = (generations.get(generation) ?? 0) - 1;

    if (remaining > 0) {
      generations.set(generation, remaining);
      return;
    }

    generations.delete(generation);

    if (generations.size === 0) {
      this.pendingLoads.delete(key);
    }
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
    const resetVersion = this.resetVersion;
    this.beginPendingLoad(key, resetVersion);

    try {
      const cached = await this.get<T>(key);

      if (cached !== undefined) {
        return cached;
      }

      const existing = this.inflight.get(key) as InflightLoad<T> | undefined;

      if (existing) {
        return existing.promise;
      }

      const entry: InflightLoad<T> = {
        generation: resetVersion,
        invalidated: this.pendingInvalidations.get(key) === resetVersion,
        promise: Promise.resolve(undefined as T),
      };

      const promise = loader().then(async (value) => {
        if (entry.invalidated || this.resetVersion !== resetVersion) {
          return value;
        }

        await this.set(key, value, ttlSeconds);

        if (entry.invalidated || this.resetVersion !== resetVersion) {
          await this.store.del(key);
        }

        return value;
      }).finally(() => {
        if (this.inflight.get(key) === entry) {
          this.inflight.delete(key);
          this.invalidatedInflight.delete(key);
        }

        if (this.pendingInvalidations.get(key) === entry.generation) {
          this.pendingInvalidations.delete(key);
        }
      });

      entry.promise = promise;
      this.inflight.set(key, entry);
      return promise;
    } finally {
      this.endPendingLoad(key, resetVersion);
    }
  }

  /**
   * Delete a single cache entry.
   *
   * @param key Cache entry key.
   * @returns A promise that resolves after the entry is removed.
   */
  async del(key: string): Promise<void> {
    const entry = this.inflight.get(key);

    if (entry) {
      entry.invalidated = true;
      this.invalidatedInflight.add(key);
    } else if (this.pendingLoads.has(key)) {
      this.pendingInvalidations.set(key, this.resetVersion);
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
    this.pendingInvalidations.clear();
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
    this.pendingInvalidations.clear();
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
