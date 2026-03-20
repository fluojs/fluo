import { Inject } from '@konekti/core';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from './tokens.js';

export const REDIS_SERVICE = Symbol.for('konekti.redis.service');

@Inject([REDIS_CLIENT])
export class RedisService {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
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
