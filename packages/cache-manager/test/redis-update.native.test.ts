import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { REDIS_CLIENT, RedisModule } from '@fluojs/redis';
import { type ApplicationContext, defineModule, FluoFactory } from '@fluojs/runtime';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CACHE_STORE, CacheModule, CacheService } from '../src/index.js';
import type { CacheStore, RedisAtomicClient } from '../src/index.js';

function deferred() {
  let resolveSignal: (() => void) | undefined;
  let rejectSignal: ((reason: unknown) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveSignal = resolve;
    rejectSignal = reject;
  });
  return {
    promise,
    resolve() {
      if (!resolveSignal) throw new Error('Signal resolver was not initialized.');
      resolveSignal();
    },
    reject(reason: unknown) {
      if (!rejectSignal) throw new Error('Signal rejector was not initialized.');
      rejectSignal(reason);
    },
  };
}

const exec = promisify(execFile);
const containerName = `fluo-cache-update-${randomUUID()}`;
const ready = deferred();
const exited = deferred();
let port: number;
let firstClient: Redis;
let secondClient: Redis;
let first: CacheService;
let second: CacheService;
let prefix: string;
let firstApp: ApplicationContext;
let secondApp: ApplicationContext;

async function createApp(keyPrefix: string) {
  class AppModule {}
  defineModule(AppModule, {
    imports: [
      RedisModule.forRoot({ host: '127.0.0.1', port, retryStrategy: () => null }),
      CacheModule.forRoot({ store: 'redis', keyPrefix, ttl: 60, redis: { atomicUpdates: true } }),
    ],
  });
  return FluoFactory.createApplicationContext(AppModule);
}

beforeAll(async () => {
  const server = spawn('docker', [
    'run', '--rm', '--name', containerName, '-p', '127.0.0.1::6379',
    'redis:7.4-alpine', 'redis-server', '--save', '', '--appendonly', 'no',
  ]);
  let output = '';
  server.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes('Ready to accept connections')) ready.resolve();
  });
  server.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  server.once('error', (error) => { ready.reject(error); exited.resolve(); });
  server.once('close', (code) => {
    ready.reject(new Error(`Redis fixture exited with ${code}: ${output}`));
    exited.resolve();
  });
  await ready.promise;
  const address = await exec('docker', ['port', containerName, '6379/tcp']);
  port = Number(address.stdout.trim().split(':').at(-1));
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid Redis fixture port: ${address.stdout}`);
});

beforeEach(async () => {
  prefix = `test:${randomUUID()}:`;
  [firstApp, secondApp] = await Promise.all([createApp(prefix), createApp(prefix)]);
  [firstClient, secondClient, first, second] = await Promise.all([
    firstApp.get<Redis>(REDIS_CLIENT),
    secondApp.get<Redis>(REDIS_CLIENT),
    firstApp.get(CacheService),
    secondApp.get(CacheService),
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([firstApp?.close(), secondApp?.close()]);
});

afterAll(async () => {
  await exec('docker', ['stop', '--time', '1', containerName]);
  await exited.promise;
});

describe('Redis WATCH atomic updates against a native server', () => {
  it('retries a conflicting reducer from the other connection rather than losing an increment', async () => {
    // Given
    const entered = deferred();
    const release = deferred();
    const snapshots: Array<number | undefined> = [];
    const update = first.update<number>('counter', async (value, { attempt }) => {
      snapshots.push(value);
      if (attempt === 1) {
        entered.resolve();
        await release.promise;
      }
      return { action: 'set', value: (value ?? 0) + 1 };
    });
    await entered.promise;

    // When
    await second.update<number>('counter', (value) => ({ action: 'set', value: (value ?? 0) + 1 }));
    release.resolve();

    // Then
    await expect(update).resolves.toBe(2);
    expect(snapshots).toEqual([undefined, 1]);
    await expect(first.get('counter')).resolves.toBe(2);
  });

  it('preserves concurrent increments across independent stores and does not hold another key', async () => {
    // Given
    const entered = deferred();
    const release = deferred();
    const slow = first.update('slow', async () => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: 1 };
    });
    await entered.promise;

    // When
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? first : second).update<number>('counter', (value) => ({
        action: 'set', value: (value ?? 0) + 1,
      }))));

    // Then
    expect(results).toHaveLength(20);
    await expect(second.get('counter')).resolves.toBe(20);
    release.resolve();
    await slow;
  });

  it.each(['del', 'reset', 'delete-recreate', 'missing-delete-recreate'] as const)(
    'rejects late results after remote %s without confusing invalidation with a write conflict',
    async (operation) => {
      // Given
      if (operation !== 'missing-delete-recreate') await first.set('key', 1);
      const entered = deferred();
      const release = deferred();
      let attempts = 0;
      const update = first.update<number>('key', async (value) => {
        attempts += 1;
        entered.resolve();
        await release.promise;
        return { action: 'set', value: (value ?? 0) + 1 };
      });
      const rejected = expect(update).rejects.toMatchObject({ code: 'invalidated' });
      await entered.promise;

      // When
      if (operation === 'reset') await second.reset();
      else await second.del('key');
      const recreated = operation === 'delete-recreate' || operation === 'missing-delete-recreate';
      if (recreated) await second.set('key', 100);
      release.resolve();

      // Then
      await rejected;
      expect(attempts).toBe(1);
      await expect(first.get('key')).resolves.toBe(recreated ? 100 : undefined);
    },
  );

  it('invalidates a watched missing key on remote reset and preserves unrelated namespaces', async () => {
    // Given
    const outsideKey = `outside:${randomUUID()}`;
    await firstClient.set(outsideKey, 'unrelated');
    const entered = deferred();
    const release = deferred();
    const update = first.update('missing', async () => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: 1 };
    });
    const rejected = expect(update).rejects.toMatchObject({ code: 'invalidated' });
    await entered.promise;

    // When
    await second.reset();
    release.resolve();

    // Then
    await rejected;
    await expect(firstClient.get(outsideKey)).resolves.toBe('unrelated');
    await expect(first.get('missing')).resolves.toBeUndefined();
    await firstClient.del(outsideKey);
  });

  it('preserves absolute expiry, renews in seconds, and removes expiry explicitly', async () => {
    // Given
    await first.set('key', 1, 60);
    const beforeRaw = await firstClient.get(`${prefix}key`);
    const before: { expiresAt: number } = JSON.parse(beforeRaw ?? '{}');

    // When
    await first.update('key', () => ({ action: 'set', value: 2 }));
    const inherited = await firstClient.pexpiretime(`${prefix}key`);
    const now = Date.now();
    await first.update('key', () => ({ action: 'set', value: 3, ttlSeconds: 120.125 }));
    const renewed = await firstClient.pexpiretime(`${prefix}key`);
    await first.update('key', () => ({ action: 'set', value: false, ttlSeconds: 0 }));

    // Then
    expect(inherited).toBe(before.expiresAt);
    expect(renewed).toBeGreaterThanOrEqual(now + 120_125);
    await expect(firstClient.pttl(`${prefix}key`)).resolves.toBe(-1);
    await expect(first.get('key')).resolves.toBe(false);
  });

  it('reads logically expired and missing values as undefined, then uses the module TTL', async () => {
    // Given
    await firstClient.set(`${prefix}expired`, JSON.stringify({ value: 99, expiresAt: Date.now() - 1 }));
    const inputs: unknown[] = [];
    const now = Date.now();

    // When
    for (const key of ['expired', 'missing']) {
      await first.update(key, (value) => {
        inputs.push(value);
        return { action: 'set', value: 1 };
      });
    }

    // Then
    expect(inputs).toEqual([undefined, undefined]);
    expect(await firstClient.pexpiretime(`${prefix}expired`)).toBeGreaterThanOrEqual(now + 60_000);
    expect(await firstClient.pexpiretime(`${prefix}missing`)).toBeGreaterThanOrEqual(now + 60_000);
  });

  it('rejects a watched native expiry without waiting on wall-clock timing', async () => {
    // Given
    await first.set('key', 1, 60);
    const entered = deferred();
    const release = deferred();
    const update = first.update<number>('key', async (value) => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: (value ?? 0) + 1, ttlSeconds: 60 };
    });
    const rejected = expect(update).rejects.toMatchObject({ code: 'invalidated' });
    await entered.promise;

    // When
    await secondClient.pexpireat(`${prefix}key`, 1);
    release.resolve();

    // Then
    await rejected;
    await expect(first.get('key')).resolves.toBeUndefined();
  });

  it('returns explicit deletion and cleans per-key invalidation metadata on reset', async () => {
    // Given
    await first.set('key', 1);
    await first.del('missing');

    // When
    const result = await first.update('key', () => ({ action: 'delete' }));
    await first.reset();

    // Then
    expect(result).toBeUndefined();
    await expect(first.get('key')).resolves.toBeUndefined();
    expect(await firstClient.keys(`${prefix}*`)).toEqual([`${prefix}\0atomic-update-epoch`]);
    await expect(first.get('\0atomic-update-epoch')).rejects.toBeInstanceOf(RangeError);
    await expect(createApp('')).rejects.toThrow(RangeError);
  });

  it('propagates serialization and native transaction errors and releases isolated connections', async () => {
    // Given
    const duplicates: Redis[] = [];
    const disconnected: Promise<void>[] = [];
    const duplicate = firstClient.duplicate.bind(firstClient);
    vi.spyOn(firstClient, 'duplicate').mockImplementation((clientOptions) => {
      const client = duplicate(clientOptions);
      duplicates.push(client);
      disconnected.push(new Promise<void>((resolve) => client.once('end', resolve)));
      return client;
    });
    const invalidJson = first.update('key', () => ({ action: 'set', value: 1n }));

    // When
    const serialization = expect(invalidJson).rejects.toBeInstanceOf(TypeError);
    await serialization;
    await firstClient.config('SET', 'min-replicas-to-write', '1');
    const nativeError = first.update('key', () => ({ action: 'set', value: 1 }));

    // Then
    try {
      await expect(nativeError).rejects.toThrow(/NOREPLICAS|EXECABORT/);
    } finally {
      await firstClient.config('SET', 'min-replicas-to-write', '0');
    }
    await Promise.all(disconnected);
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((client) => client.status === 'end')).toBe(true);
    await expect(firstClient.ping()).resolves.toBe('PONG');
  });

  it('bounds conflicts and drains the isolated connection after caller cancellation and shutdown', async () => {
    // Given
    const entered = deferred();
    const release = deferred();
    const update = first.update('key', async () => {
      entered.resolve();
      await release.promise;
      return { action: 'set', value: 1 };
    }, { maxAttempts: 1 });
    const rejected = expect(update).rejects.toMatchObject({ code: 'conflict' });
    await entered.promise;

    // When
    await second.set('key', 10);
    release.resolve();

    // Then
    await rejected;
    await expect(first.get('key')).resolves.toBe(10);
    const controller = new AbortController();
    const running = deferred();
    const aborted = deferred();
    const finish = deferred();
    const cancelled = first.update('key', async (_value, { signal }) => {
      signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      running.resolve();
      await finish.promise;
      return { action: 'set', value: 2 };
    }, { signal: controller.signal });
    const cancellation = expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    await running.promise;
    controller.abort();
    await aborted.promise;
    const closed = first.close();
    finish.resolve();
    await Promise.all([cancellation, closed]);
    await expect(second.get('key')).resolves.toBe(10);
    await expect(firstClient.ping()).resolves.toBe('PONG');
  });

  it('accepts the actual ioredis atomic seam and resolves the distributed capability through DI', async () => {
    // Given / When / Then
    const compatible: RedisAtomicClient = firstClient;
    expect(compatible).toBe(firstClient);
    const store = await firstApp.get<CacheStore>(CACHE_STORE);
    expect(store.atomicUpdate?.scope).toBe('distributed');
  });
});
