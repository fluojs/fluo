import {
  type CacheAtomicUpdate,
  type CacheStoreUpdateOptions,
  CacheUpdateError,
  CacheUpdateQueue,
  type CacheUpdateReducer,
  checkUpdateSignal,
  resolveUpdateExpiry,
} from '../atomic-update.js';
import { cloneCacheValue } from '../clone.js';
import type { CacheStore } from '../types.js';

interface MemoryCacheEntry<T = unknown> {
  expiresAt?: number;
  value: T;
}

const DEFAULT_MAX_MEMORY_CACHE_ENTRIES = 1_000;

function sweepExpiredEntries(entries: Map<string, MemoryCacheEntry>, now: number): number {
  let nextSweepAt = Number.POSITIVE_INFINITY;

  for (const [key, entry] of entries) {
    if (entry.expiresAt === undefined) {
      continue;
    }

    if (now >= entry.expiresAt) {
      entries.delete(key);
      continue;
    }

    nextSweepAt = Math.min(nextSweepAt, entry.expiresAt);
  }

  return Number.isFinite(nextSweepAt) ? nextSweepAt : 0;
}

function enforceEntryLimit(entries: Map<string, MemoryCacheEntry>): void {
  while (entries.size > DEFAULT_MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = entries.keys().next().value;

    if (oldestKey === undefined) {
      return;
    }

    entries.delete(oldestKey);
  }
}

function normalizePositiveTtlMilliseconds(ttlSeconds: number, maximumTtlMilliseconds: number): number {
  return Math.min(maximumTtlMilliseconds, Math.max(1, Math.floor(ttlSeconds * 1000)));
}

/**
 * Represents the memory store.
 */
export class MemoryStore implements CacheStore {
  private readonly entries = new Map<string, MemoryCacheEntry>();
  private nextSweepAt = 0;
  private readonly updates = new CacheUpdateQueue();
  /** Atomic updates are local to this MemoryStore instance, including shared service facades. */
  readonly atomicUpdate: CacheAtomicUpdate = {
    scope: 'local-process',
    update: <T>(key: string, reducer: CacheUpdateReducer<T>, options: CacheStoreUpdateOptions = {}) =>
      this.updates.run(key, options, async (signal, maxAttempts) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          checkUpdateSignal(signal);
          const snapshot = this.get<T>(key);
          const entry = this.entries.get(key);
          const value = await snapshot;
          checkUpdateSignal(signal);
          const decision = await reducer(value, { signal, attempt });
          checkUpdateSignal(signal);
          if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            throw new CacheUpdateError('invalidated');
          }
          if (this.entries.get(key) !== entry) continue;
          switch (decision.action) {
            case 'delete':
              this.entries.delete(key);
              return undefined;
            case 'set': {
              const expiresAt = resolveUpdateExpiry(
                decision.ttlSeconds, entry?.expiresAt, entry !== undefined, options.defaultTtlSeconds ?? 0,
              );
              const replacement = { value: cloneCacheValue(decision.value), expiresAt };
              this.entries.delete(key);
              this.entries.set(key, replacement);
              enforceEntryLimit(this.entries);
              if (expiresAt !== undefined) {
                this.nextSweepAt = this.nextSweepAt === 0 ? expiresAt : Math.min(this.nextSweepAt, expiresAt);
              }
              return cloneCacheValue(decision.value);
            }
          }
        }
        throw new CacheUpdateError('conflict');
      }),
  };

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const now = Date.now();

    if (now >= this.nextSweepAt) {
      this.nextSweepAt = sweepExpiredEntries(this.entries, now);
    }

    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
      this.entries.delete(key);
      this.nextSweepAt = sweepExpiredEntries(this.entries, now);
      return undefined;
    }

    return cloneCacheValue(entry.value as T);
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds = 0): Promise<void> {
    const now = Date.now();

    if (now >= this.nextSweepAt) {
      this.nextSweepAt = sweepExpiredEntries(this.entries, now);
    }

    const entry: MemoryCacheEntry<T> = {
      value: cloneCacheValue(value),
    };

    if (ttlSeconds > 0) {
      const maximumTtlMilliseconds = Number.MAX_SAFE_INTEGER - now;
      const ttlMilliseconds = normalizePositiveTtlMilliseconds(ttlSeconds, maximumTtlMilliseconds);
      entry.expiresAt = now + ttlMilliseconds;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    enforceEntryLimit(this.entries);

    if (entry.expiresAt !== undefined) {
      this.nextSweepAt = this.nextSweepAt === 0 ? entry.expiresAt : Math.min(this.nextSweepAt, entry.expiresAt);
    }
  }

  async del(key: string): Promise<void> {
    this.updates.invalidate(key);
    this.entries.delete(key);
  }

  async reset(): Promise<void> {
    this.updates.invalidate();
    this.entries.clear();
    this.nextSweepAt = 0;
  }
}
