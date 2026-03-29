import type { CacheStore } from './types.js';
import { cloneCacheValue } from './clone.js';

interface MemoryCacheEntry<T = unknown> {
  expiresAt?: number;
  value: T;
}

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

export class MemoryStore implements CacheStore {
  private readonly entries = new Map<string, MemoryCacheEntry>();
  private nextSweepAt = 0;

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
      const ttlMilliseconds = Math.max(1, Math.floor(ttlSeconds * 1000));
      entry.expiresAt = now + ttlMilliseconds;
    }

    this.entries.set(key, entry);

    if (entry.expiresAt !== undefined) {
      this.nextSweepAt = this.nextSweepAt === 0 ? entry.expiresAt : Math.min(this.nextSweepAt, entry.expiresAt);
    }
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async reset(): Promise<void> {
    this.entries.clear();
    this.nextSweepAt = 0;
  }
}
