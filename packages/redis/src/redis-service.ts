import { Inject } from '@konekti/core';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from './tokens.js';

function decodeRedisValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

@Inject([REDIS_CLIENT])
export class RedisService {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | string | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }

    return decodeRedisValue(raw) as T | string;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds !== undefined && ttlSeconds > 0) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  getRawClient(): Redis {
    return this.client;
  }
}
