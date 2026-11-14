import { Inject } from '@fluojs/core';
import { FrameworkService } from '@fluojs/core/internal';

import {
  CacheUpdateError,
  type CacheUpdateErrorCode,
  type CacheUpdateOptions,
  type CacheUpdateReducer,
} from './atomic-update.js';
import { CacheOperationObserver } from './operation-observer.js';
import { StoreOperationScheduler } from './store-operation-scheduler.js';
import { CACHE_OPTIONS, CACHE_STORE } from './tokens.js';
import { applyCacheTtlJitter } from './ttl-jitter.js';
import type { CacheStore, NormalizedCacheModuleOptions } from './types.js';

// allow: SIZE_OK — cache lifecycle and in-flight invalidation form one indivisible state machine.
interface InflightLoad<T = unknown> {
  generation: number;
  invalidated: boolean;
  writeBypassed: boolean;
  promise: Promise<T>;
}

interface MonotonicClock {
  now(): number;
}

const systemCacheClock: MonotonicClock = globalThis.performance;

/**
 * Application-level cache facade used for direct cache reads, writes, and read-through loading.
 */
@Inject(CACHE_STORE, CACHE_OPTIONS)
@FrameworkService({ id: '@fluojs/cache-manager/CacheService', version: 1 })
export class CacheService {
  private readonly inflight = new Map<string, InflightLoad>();
  private readonly pendingLoads = new Map<string, Map<number, number>>();
  private readonly pendingInvalidations = new Map<string, number>();
  private readonly invalidatedInflight = new Set<string>();
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private resetVersion = 0;
  private readonly storeOperations = new StoreOperationScheduler();
  private readonly updates = new Map<string, Set<AbortController>>();

  private beginPendingLoad(key: string, generation: number): void {
    const generations = this.pendingLoads.get(key) ?? new Map<number, number>();

    generations.set(generation, (generations.get(generation) ?? 0) + 1);
    this.pendingLoads.set(key, generations);
  }

  private endPendingLoad(key: string, generation: number): void {
    const generations = this.pendingLoads.get(key);

    if (!generations?.has(generation)) {
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

    // A hit or failed read must release markers too, but only after its whole load cycle drains.
    if (this.inflight.get(key)?.generation !== generation) {
      if (this.pendingInvalidations.get(key) === generation) {
        this.pendingInvalidations.delete(key);
      }
      if (this.resetVersion === generation) {
        this.invalidatedInflight.delete(key);
      }
    }
  }

  private readonly operationObserver: CacheOperationObserver;

  constructor(
    private readonly store: CacheStore,
    private readonly options: NormalizedCacheModuleOptions,
    clock: MonotonicClock = systemCacheClock,
  ) {
    this.operationObserver = new CacheOperationObserver(options.observer, clock);
  }

  /**
   * Read a cached value by key.
   *
   * @param key Cache entry key.
   * @returns The cached value, or `undefined` when the key is missing or expired.
   */
  get<T = unknown>(key: string): Promise<T | undefined> {
    return this.operationObserver.observeRead(
      'get',
      () => this.readFromStore<T>(key),
      (value) => (value === undefined ? 'miss' : 'hit'),
    );
  }

  private readFromStore<T>(key: string, onStoreError?: () => void): Promise<T | undefined> {
    if (this.closed) {
      return Promise.resolve(undefined);
    }

    return this.storeOperations.run(async () => {
      if (this.closed) {
        return undefined;
      }

      try {
        return await this.store.get<T>(key);
      } catch (error) {
        if (!onStoreError) throw error;
        onStoreError();
        return undefined;
      }
    });
  }

  /**
   * Store a value in the configured cache store.
   *
   * @param key Cache entry key.
   * @param value Value to cache.
   * @param ttlSeconds Optional per-call TTL override in seconds.
   * @returns A promise that resolves after the write completes.
   *
   * @remarks
   * When `ttlJitter` is configured, a positive resolved TTL is jittered once here, before store handoff,
   * so every store observes the same effective expiry. `ttl: 0` stays a no-expiry write and invalid TTL
   * values still skip the write entirely.
   */
  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.operationObserver.observeWrite('set', () => this.writeToStore(key, value, ttlSeconds));
  }

  private async writeToStore<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
    onStoreError?: () => void,
  ): Promise<void> {
    const resolvedTtl = ttlSeconds ?? this.options.ttl;

    if (this.closed || !Number.isFinite(resolvedTtl) || resolvedTtl < 0) {
      return;
    }

    const effectiveTtl = applyCacheTtlJitter(resolvedTtl, this.options.ttlJitter);

    await this.storeOperations.run(async () => {
      if (this.closed) {
        return;
      }

      try {
        await this.store.set<T>(key, value, effectiveTtl);
      } catch (error) {
        if (!onStoreError) throw error;
        onStoreError();
      }
    });
  }

  /**
   * Atomically reduce one key using the store's explicit capability.
   *
   * @param key Cache entry key.
   * @param reducer Pure reducer; repeated attempts must not perform external side effects.
   * @param options Optional caller cancellation and total attempt limit (default 16).
   * @returns The committed value, or `undefined` after explicit deletion.
   * @throws CacheUpdateError for unsupported stores, invalidation, cancellation, close, or exhausted conflicts.
   * @remarks Omitted decision TTL preserves live expiry; missing entries use the module TTL.
   * Update TTLs are not jittered. Shutdown drains reducers even when they ignore cancellation.
   */
  async update<T>(key: string, reducer: CacheUpdateReducer<T>, options: CacheUpdateOptions = {}): Promise<T | undefined> {
    if (this.closed) return Promise.reject(new CacheUpdateError('closed'));
    const capability = this.store.atomicUpdate;
    if (!capability) return Promise.reject(new CacheUpdateError('unsupported'));
    const controller = new AbortController();
    const controllers = this.updates.get(key) ?? new Set<AbortController>();
    controllers.add(controller);
    this.updates.set(key, controllers);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      let admit: (() => void) | undefined;
      const admission = new Promise<void>((resolve) => { admit = resolve; });
      // The store registers synchronously, even while this facade waits behind an exclusive boundary.
      const pending = capability.update(key, reducer, {
        ...options, signal, admission, defaultTtlSeconds: this.options.ttl,
      });
      const tracked = this.storeOperations.run(() => {
        admit?.();
        return pending;
      });
      // Observe an early capability rejection even while the scheduler is behind a reset.
      const [value] = await Promise.all([pending, tracked]);
      return value;
    } finally {
      controllers.delete(controller);
      if (controllers.size === 0) this.updates.delete(key);
    }
  }

  private invalidateUpdates(key?: string, code: CacheUpdateErrorCode = 'invalidated'): void {
    for (const [activeKey, controllers] of this.updates) {
      if (key !== undefined && key !== activeKey) continue;
      for (const controller of controllers) controller.abort(new CacheUpdateError(code));
    }
  }

  /**
   * Load a value through the cache, de-duplicating concurrent misses for the same key.
   *
   * @param key Cache entry key.
   * @param loader Async loader invoked on cache miss.
   * @param ttlSeconds Optional per-call TTL override in seconds.
   * @returns The cached or freshly loaded value.
   * @remarks
   * `rememberCacheErrors: 'bypass'` contains only store get/set failures while retaining
   * same-instance coalescing and invalidation. Each affected caller observes `error` even
   * when its value resolves. Loader and TTL preparation failures are never retried or bypassed.
   */
  async remember<T = unknown>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds?: number,
  ): Promise<T> {
    const [value] = await this.operationObserver.observeRead(
      'remember',
      () => this.rememberThroughStore(key, loader, ttlSeconds),
      ([, outcome]) => outcome,
    );

    return value;
  }

  private async rememberThroughStore<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number | undefined,
  ): Promise<readonly [T, 'hit' | 'miss' | 'error']> {
    if (this.closed) {
      return [await loader(), 'miss'];
    }

    const resetVersion = this.resetVersion;
    const bypass = this.options.rememberCacheErrors === 'bypass';
    let readBypassed = false;
    this.beginPendingLoad(key, resetVersion);

    try {
      const cached = await this.readFromStore<T>(key, bypass ? () => { readBypassed = true; } : undefined);

      if (cached !== undefined) {
        return [cached, 'hit'];
      }

      if (this.closed || this.resetVersion !== resetVersion) {
        return [await loader(), readBypassed ? 'error' : 'miss'];
      }

      const existing = this.inflight.get(key) as InflightLoad<T> | undefined;

      if (existing && existing.generation === resetVersion) {
        const value = await existing.promise;
        return [value, readBypassed || existing.writeBypassed ? 'error' : 'miss'];
      }

      if (existing) {
        this.inflight.delete(key);
      }

      const entry: InflightLoad<T> = {
        generation: resetVersion,
        invalidated: this.pendingInvalidations.get(key) === resetVersion,
        writeBypassed: false,
        promise: Promise.resolve(undefined as T),
      };

      // Register the shared promise before invoking even a synchronously throwing loader.
      const promise = Promise.resolve().then(loader).then(async (value) => {
        if (this.closed || entry.invalidated || this.resetVersion !== resetVersion) {
          return value;
        }

        await this.writeToStore(key, value, ttlSeconds, bypass ? () => { entry.writeBypassed = true; } : undefined);

        // Reset drains this write and clears it itself; a later delete could erase a fresh value.
        if (!this.closed && entry.invalidated && this.resetVersion === resetVersion) {
          await this.deleteFromStore(key);
        }

        return value;
      }).finally(() => {
        if (this.inflight.get(key) === entry) {
          this.inflight.delete(key);
        }
      });

      entry.promise = promise;
      this.inflight.set(key, entry);
      const value = await promise;
      return [value, readBypassed || entry.writeBypassed ? 'error' : 'miss'];
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
    await this.operationObserver.observeWrite('del', () => this.invalidateKey(key));
  }

  private async invalidateKey(key: string): Promise<void> {
    if (this.closed) {
      return;
    }

    this.invalidateUpdates(key);
    const entry = this.inflight.get(key);

    if (entry) {
      entry.invalidated = true;
    }

    // Reads still pending after the current loader settles belong to the same invalidated cycle.
    if (this.pendingLoads.get(key)?.has(this.resetVersion)) {
      this.pendingInvalidations.set(key, this.resetVersion);
      this.invalidatedInflight.add(key);
    }

    await this.deleteFromStore(key);
  }

  /**
   * Clear every cache entry owned by the configured store.
   *
   * @returns A promise that resolves after the store reset completes.
   */
  async reset(): Promise<void> {
    await this.operationObserver.observeWrite('reset', () => this.resetStore());
  }

  private async resetStore(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.invalidateUpdates();
    this.resetVersion += 1;
    this.inflight.clear();
    this.pendingLoads.clear();
    this.pendingInvalidations.clear();
    this.invalidatedInflight.clear();
    await this.storeOperations.runExclusive(async () => {
      if (this.closed) {
        return;
      }

      await this.store.reset();
    });
  }

  /**
   * Close the configured store when it exposes an optional teardown hook.
   *
   * Concurrent and repeated calls share the first teardown completion and failure.
   *
   * @returns A promise that resolves after store teardown completes.
   */
  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = this.operationObserver.observeWrite('close', () => this.closeStore());

    return this.closePromise;
  }

  private closeStore(): Promise<void> {
    this.closed = true;
    this.invalidateUpdates(undefined, 'closed');
    this.resetVersion += 1;
    this.inflight.clear();
    this.pendingLoads.clear();
    this.pendingInvalidations.clear();
    this.invalidatedInflight.clear();

    return this.storeOperations.runExclusive(async () => {
      if (this.store.close) {
        await this.store.close();
        return;
      }

      if (this.store.dispose) {
        await this.store.dispose();
      }
    });
  }

  private async deleteFromStore(key: string): Promise<void> {
    await this.storeOperations.run(async () => {
      if (this.closed) {
        return;
      }

      await this.store.del(key);
    });
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
