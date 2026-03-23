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

function sweepExpiredEntries(map: Map<string, ThrottlerStoreEntry>, now: number): number {
  let nextSweepAt = Number.POSITIVE_INFINITY;

  for (const [entryKey, entry] of map) {
    if (now >= entry.resetAt) {
      map.delete(entryKey);
      continue;
    }

    nextSweepAt = Math.min(nextSweepAt, entry.resetAt);
  }

  return Number.isFinite(nextSweepAt) ? nextSweepAt : 0;
}

export function createMemoryThrottlerStore(): ThrottlerStore {
  const map = new Map<string, ThrottlerStoreEntry>();
  let nextSweepAt = 0;

  return {
    consume(key, input) {
      const { now } = input;

      if (now >= nextSweepAt) {
        nextSweepAt = sweepExpiredEntries(map, now);
      }

      const nextEntry = consumeWindow(map.get(key), input);
      map.set(key, nextEntry);
      nextSweepAt = nextSweepAt === 0 ? nextEntry.resetAt : Math.min(nextSweepAt, nextEntry.resetAt);
      return nextEntry;
    },
  };
}
