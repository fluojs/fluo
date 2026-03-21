import type Redis from 'ioredis';

import type { ThrottlerStore, ThrottlerStoreEntry } from './types.js';

export class RedisThrottlerStore implements ThrottlerStore {
  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<ThrottlerStoreEntry | undefined> {
    const raw = await this.client.get(key);

    if (raw === null) {
      return undefined;
    }

    return JSON.parse(raw) as ThrottlerStoreEntry;
  }

  async set(key: string, entry: ThrottlerStoreEntry): Promise<void> {
    const ttlMs = entry.resetAt - Date.now();
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    if (ttlSeconds <= 0) {
      return;
    }

    await this.client.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
  }

  async increment(key: string): Promise<number> {
    const raw = await this.client.get(key);

    if (raw === null) {
      return 0;
    }

    const entry = JSON.parse(raw) as ThrottlerStoreEntry;
    entry.count++;
    const ttlMs = entry.resetAt - Date.now();
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    if (ttlSeconds > 0) {
      await this.client.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
    }

    return entry.count;
  }

  async evict(_now: number): Promise<void> {
    // Redis handles TTL-based expiry natively; no manual eviction needed.
  }
}
