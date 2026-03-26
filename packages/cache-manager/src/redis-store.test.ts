import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisStore } from './redis-store.js';
import type { RedisCompatibleClient } from './types.js';

class MockRedisClient implements RedisCompatibleClient {
  readonly deletedKeys: string[][] = [];
  readonly setCalls: Array<{ args: Array<string | number>; key: string; value: string }> = [];
  readonly scanCalls: Array<{ cursor: string; pattern: string }> = [];
  readonly storage = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: Array<string | number>): Promise<'OK'> {
    this.setCalls.push({ args: _args, key, value });
    this.storage.set(key, value);
    return 'OK';
  }

  async del(key: string, ...keys: string[]): Promise<number> {
    const allKeys = [key, ...keys];
    this.deletedKeys.push(allKeys);

    let removed = 0;

    for (const current of allKeys) {
      if (this.storage.delete(current)) {
        removed += 1;
      }
    }

    return removed;
  }

  async scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]> {
    const matchIndex = args.findIndex((value) => value === 'MATCH');
    const rawPattern = matchIndex >= 0 ? args[matchIndex + 1] : '*';
    const pattern = typeof rawPattern === 'string' ? rawPattern : '*';
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    this.scanCalls.push({ cursor, pattern });

    if (cursor !== '0') {
      return ['0', []];
    }

    const keys = Array.from(this.storage.keys()).filter((key) => key.startsWith(prefix));
    return ['0', keys];
  }
}

describe('RedisStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes and reads JSON-coded cache entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    const client = new MockRedisClient();
    const store = new RedisStore(client, { keyPrefix: 'cache:' });

    await store.set('users:1', { id: 'u1' }, 30);
    const cached = await store.get<{ id: string }>('users:1');

    expect(cached).toEqual({ id: 'u1' });
  });

  it('returns undefined for malformed payloads without deleting', async () => {
    const client = new MockRedisClient();
    const store = new RedisStore(client, { keyPrefix: 'cache:' });

    client.storage.set('cache:bad', '{"expiresAt": "not-number"}');

    await expect(store.get('bad')).resolves.toBeUndefined();
    expect(client.deletedKeys).not.toContainEqual(['cache:bad']);
  });

  it('uses scoped scan+del reset instead of flush-all behavior', async () => {
    const client = new MockRedisClient();
    const store = new RedisStore(client, { keyPrefix: 'konekti:cache:' });

    client.storage.set('konekti:cache:users:1', '{"expiresAt":999999,"value":1}');
    client.storage.set('konekti:cache:users:2', '{"expiresAt":999999,"value":2}');
    client.storage.set('konekti:cache:orders:1', '{"expiresAt":999999,"value":3}');
    client.storage.set('another-prefix:noop', '{"expiresAt":999999,"value":4}');

    await store.reset();

    expect(client.scanCalls[0]).toEqual({
      cursor: '0',
      pattern: 'konekti:cache:*',
    });
    expect(client.storage.has('konekti:cache:users:1')).toBe(false);
    expect(client.storage.has('konekti:cache:users:2')).toBe(false);
    expect(client.storage.has('konekti:cache:orders:1')).toBe(false);
    expect(client.storage.has('another-prefix:noop')).toBe(true);
  });

  it('stores ttl=0 entries without redis expiry arguments', async () => {
    const client = new MockRedisClient();
    const store = new RedisStore(client, { keyPrefix: 'cache:' });

    await store.set('users:1', { id: 'u1' }, 0);

    expect(client.setCalls[0]).toEqual({
      args: [],
      key: 'cache:users:1',
      value: JSON.stringify({ value: { id: 'u1' } }),
    });
  });
});
