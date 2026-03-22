import type { ThrottlerConsumeInput, ThrottlerStore, ThrottlerStoreEntry } from './types.js';

function consumeWindow(
  entry: ThrottlerStoreEntry | undefined,
  { now, ttlSeconds }: ThrottlerConsumeInput,
): ThrottlerStoreEntry {
  const resetAt = now + ttlSeconds * 1000;

  if (!entry || now >= entry.resetAt) {
    return {
      count: 1,
      resetAt,
    };
  }

  return {
    count: entry.count + 1,
    resetAt: entry.resetAt,
  };
}

export function createMemoryThrottlerStore(): ThrottlerStore {
  const map = new Map<string, ThrottlerStoreEntry>();
  let nextSweepAt = 0;

  return {
    consume(key, input) {
      const { now } = input;

      if (now < nextSweepAt) {
        const nextEntry = consumeWindow(map.get(key), input);
        map.set(key, nextEntry);
        nextSweepAt = Math.min(nextSweepAt, nextEntry.resetAt);
        return nextEntry;
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

      const nextEntry = consumeWindow(map.get(key), input);
      map.set(key, nextEntry);
      nextSweepAt = nextSweepAt === 0 ? nextEntry.resetAt : Math.min(nextSweepAt, nextEntry.resetAt);
      return nextEntry;
    },
  };
}
