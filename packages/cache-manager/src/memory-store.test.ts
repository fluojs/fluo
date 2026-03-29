import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryStore } from './memory-store.js';

describe('MemoryStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires entries lazily on read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    const store = new MemoryStore();

    await store.set('users:list', { count: 1 }, 1);

    await expect(store.get('users:list')).resolves.toEqual({ count: 1 });

    vi.advanceTimersByTime(1_001);

    await expect(store.get('users:list')).resolves.toBeUndefined();
  });

  it('keeps active entries while evicting only expired ones', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    const store = new MemoryStore();

    await store.set('cache:a', { value: 'a' }, 1);
    await store.set('cache:b', { value: 'b' }, 10);

    vi.advanceTimersByTime(1_500);

    await expect(store.get('cache:a')).resolves.toBeUndefined();
    await expect(store.get('cache:b')).resolves.toEqual({ value: 'b' });
  });

  it('resets all managed keys', async () => {
    const store = new MemoryStore();

    await store.set('a:1', 1, 60);
    await store.set('a:2', 2, 60);
    await store.set('b:1', 3, 60);

    await store.reset();

    await expect(store.get('a:1')).resolves.toBeUndefined();
    await expect(store.get('a:2')).resolves.toBeUndefined();
    await expect(store.get('b:1')).resolves.toBeUndefined();
  });

  it('treats ttl=0 as no-expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    const store = new MemoryStore();

    await store.set('users:list', { count: 1 }, 0);
    vi.advanceTimersByTime(60_000);

    await expect(store.get('users:list')).resolves.toEqual({ count: 1 });
  });

  it('returns immutable snapshots instead of leaking internal object references', async () => {
    const store = new MemoryStore();
    const value = { nested: { count: 1 } };

    await store.set('users:list', value, 60);
    value.nested.count = 99;

    const first = await store.get<typeof value>('users:list');
    expect(first).toEqual({ nested: { count: 1 } });

    if (!first) {
      throw new Error('Expected cached value to be defined.');
    }

    first.nested.count = 42;

    await expect(store.get('users:list')).resolves.toEqual({ nested: { count: 1 } });
  });
});
