import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { CacheModule, CacheService } from '@fluojs/cache-manager';
import { REDIS_CLIENT, RedisModule } from '@fluojs/redis';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRedisFixture } from '../../../../testing/redis-native-fixture.mjs';

/**
 * Native composition fixture for the Cache manager and Redis package guides
 * (apps/docs/content/docs/packages/cache-manager.mdx and redis.mdx).
 *
 * Evidence scope: a real redis:7.4-alpine server proves the documented
 * Redis-store composition: DI-resolved clients (default and named), JSON
 * entries under the configured keyPrefix, prefix-scoped reset that preserves
 * application-owned keys, read-through remembering over Redis, and the
 * opt-in WATCH-based atomic update capability. Requires Docker; consistent
 * with the repository's native suites, it fails rather than skips when the
 * fixture is unavailable.
 */

/**
 * Structural raw-client surface used by these fixtures; the runtime object is
 * the real ioredis client owned by the Redis registration (the repository's
 * tsconfig.tools.json cannot resolve ioredis declarations from the tooling
 * tree, so the driver's declarations are not imported here).
 */
interface RedisLike extends NodeJS.EventEmitter {
  status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
}

const containerName = `fluo-docs-guides-cache-redis-${randomUUID()}`;
const exec = promisify(execFile);
let fixture: Awaited<ReturnType<typeof startRedisFixture>> | undefined;

beforeAll(async () => {
  fixture = await startRedisFixture({
    containerName,
    diagnosticPath: resolve('.artifacts/redis-native-fixture/docs-package-guides.json'),
    execFile: exec,
    spawn,
  });
}, 70_000);

afterAll(async () => {
  await fixture?.cleanup();
});

function createCacheApp(port: number, keyPrefix: string, options?: { clientName?: string; atomicUpdates?: boolean }) {
  const redisModule = options?.clientName === undefined
    ? RedisModule.forRoot({ host: '127.0.0.1', port })
    : RedisModule.forRoot({ host: '127.0.0.1', port, name: options.clientName });

  class CacheStackModule {}
  // Module composition follows the guide's "Redis storage" fragment: the
  // cache resolves its client through @fluojs/redis; the Redis registration
  // owns the client lifecycle.
  defineModule(CacheStackModule, {
    imports: [
      redisModule,
      CacheModule.forRoot({
        store: 'redis',
        ttl: 60,
        keyPrefix,
        redis: {
          ...(options?.clientName !== undefined && { clientName: options.clientName }),
          ...(options?.atomicUpdates !== undefined && { atomicUpdates: options.atomicUpdates }),
        },
      }),
    ],
  });
  return { CacheStackModule };
}

describe('cache-manager guide fixtures: Redis-backed store over a lifecycle-managed client', () => {
  it('persists JSON entries under the configured keyPrefix and round-trips values', async () => {
    const keyPrefix = `docs:${randomUUID()}:`;
    const { CacheStackModule } = createCacheApp(fixture!.port, keyPrefix);
    const context = await FluoFactory.createApplicationContext(CacheStackModule);

    try {
      const cache = await context.get(CacheService);
      const rawClient = await context.get<RedisLike>(REDIS_CLIENT);

      await cache.set('greeting', { hello: 'world' });
      await expect(cache.get('greeting')).resolves.toEqual({ hello: 'world' });

      // The RedisStore entry envelope is JSON with the millisecond expiry.
      const raw = await rawClient.get(`${keyPrefix}greeting`);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as { value: unknown; expiresAt?: number };
      expect(parsed.value).toEqual({ hello: 'world' });
      expect(typeof parsed.expiresAt).toBe('number');

      await cache.del('greeting');
      await expect(cache.get('greeting')).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it('resets only the cache-owned prefix and preserves application-owned keys', async () => {
    const keyPrefix = `docs:${randomUUID()}:`;
    const { CacheStackModule } = createCacheApp(fixture!.port, keyPrefix);
    const context = await FluoFactory.createApplicationContext(CacheStackModule);

    try {
      const cache = await context.get(CacheService);
      const rawClient = await context.get<RedisLike>(REDIS_CLIENT);

      await cache.set('in-scope', 'cache-data');
      await rawClient.set('myapp:other', 'app-data');

      await cache.reset();

      expect(await rawClient.get(`${keyPrefix}in-scope`)).toBeNull();
      expect(await rawClient.get('myapp:other')).toBe('app-data');
    } finally {
      await context.close();
    }
  });

  it('resolves a named Redis client through redis.clientName and remembers over Redis', async () => {
    const keyPrefix = `docs:${randomUUID()}:`;
    const { CacheStackModule } = createCacheApp(fixture!.port, keyPrefix, { clientName: 'cache' });
    const context = await FluoFactory.createApplicationContext(CacheStackModule);

    try {
      const cache = await context.get(CacheService);
      let loaderRuns = 0;

      const first = await cache.remember('catalog', async () => {
        loaderRuns += 1;
        return [{ id: 1 }];
      });
      const second = await cache.remember('catalog', async () => {
        loaderRuns += 1;
        return [{ id: 2 }];
      });

      expect(first).toEqual([{ id: 1 }]);
      expect(second).toEqual([{ id: 1 }]);
      expect(loaderRuns).toBe(1);
    } finally {
      await context.close();
    }
  });

  it('applies opt-in WATCH-based atomic updates against the native server', async () => {
    const keyPrefix = `docs:${randomUUID()}:`;
    const { CacheStackModule } = createCacheApp(fixture!.port, keyPrefix, { atomicUpdates: true });
    const context = await FluoFactory.createApplicationContext(CacheStackModule);

    try {
      const cache = await context.get(CacheService);

      const results = await Promise.all([
        cache.update<number>('hits', (value) => ({ action: 'set', value: (value ?? 0) + 1 })),
        cache.update<number>('hits', (value) => ({ action: 'set', value: (value ?? 0) + 1 })),
      ]);

      expect(results).toEqual([1, 2]);
      await expect(cache.get('hits')).resolves.toBe(2);
    } finally {
      await context.close();
    }
  });

  it('closes the cache service on shutdown while the Redis registration quits its own client', async () => {
    const keyPrefix = `docs:${randomUUID()}:`;
    const { CacheStackModule } = createCacheApp(fixture!.port, keyPrefix);
    const context = await FluoFactory.createApplicationContext(CacheStackModule);
    const cache = await context.get(CacheService);
    const rawClient = await context.get<RedisLike>(REDIS_CLIENT);
    await cache.set('before-close', 'v');

    const ended = once(rawClient, 'end', { signal: AbortSignal.timeout(5_000) }).then(() => undefined);
    await context.close();
    await ended;

    // The cache is closed, but the client's teardown came from the Redis
    // module that owns it - the cache never closes a client itself.
    await expect(cache.get('before-close')).resolves.toBeUndefined();
    expect(rawClient.status).toBe('end');
  });
});
