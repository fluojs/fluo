import type { ThrottlerStore, ThrottlerStoreEntry } from './types.js';

export function createMemoryThrottlerStore(): ThrottlerStore {
  const map = new Map<string, ThrottlerStoreEntry>();
  let nextSweepAt = 0;

  return {
    get(key) {
      return map.get(key);
    },
    set(key, entry) {
      map.set(key, entry);
    },
    increment(key) {
      const entry = map.get(key);

      if (!entry) {
        return 0;
      }

      entry.count++;
      return entry.count;
    },
    evict(now) {
      if (now < nextSweepAt) {
        return;
      }

      let next = Number.POSITIVE_INFINITY;

      for (const [key, entry] of map) {
        if (now >= entry.resetAt) {
          map.delete(key);
          continue;
        }

        next = Math.min(next, entry.resetAt);
      }

      nextSweepAt = Number.isFinite(next) ? next : 0;
    },
  };
}
