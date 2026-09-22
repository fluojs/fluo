import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { getRedisServiceToken, REDIS_CLIENT, RedisService } from '@fluojs/redis';
import { FluoFactory } from '@fluojs/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startRedisFixture } from '../../../../testing/redis-native-fixture.mjs';
import {
  createDuplicateRegistrationsApp,
  createSessionsApp,
} from './redis-sessions.example';

/**
 * Native guide fixture for the Redis package guide
 * (apps/docs/content/docs/packages/redis.mdx).
 *
 * Evidence scope: a real redis:7.4-alpine server (repository fixture harness,
 * isolated container, ephemeral loopback port) proves the lifecycle-managed
 * client contract end to end: bootstrap connect, JSON codec, EX/PX/persistent
 * TTL semantics, named client identities, duplicate registration rejection,
 * and graceful quit on close. Requires Docker; consistent with the
 * repository's native suites, it fails rather than skips when the fixture is
 * unavailable.
 */

/**
 * Structural raw-client surface used by these fixtures. The repository's
 * tsconfig.tools.json cannot resolve `ioredis` declarations from the tooling
 * tree, so the fixture types the raw client structurally instead of importing
 * the driver's declarations; the runtime object is the real ioredis client.
 */
interface RedisLike extends NodeJS.EventEmitter {
  status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  ttl(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
}

const containerName = `fluo-docs-guides-redis-${randomUUID()}`;
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

describe('redis guide fixtures: lifecycle-managed default client', () => {
  it('connects on bootstrap, round-trips JSON, and returns null for missing keys', async () => {
    const { SessionsModule, SessionStore } = createSessionsApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(SessionsModule);

    try {
      const store = await context.get(SessionStore);
      const rawClient = await context.get<RedisLike>(REDIS_CLIENT);
      expect(rawClient.status).toBe('ready');
      expect(store.rawClient()).toBe(rawClient);

      await store.save('s1', 'u1');
      await expect(store.find('s1')).resolves.toEqual({
        userId: 'u1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await expect(store.find('missing')).resolves.toBeNull();

      await store.destroy('s1');
      await expect(store.find('s1')).resolves.toBeNull();
    } finally {
      await context.close();
    }
  });

  it('maps integer TTLs to EX, fractional TTLs to PX, and omitted TTLs to persistent keys', async () => {
    const { SessionsModule, SessionStore } = createSessionsApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(SessionsModule);

    try {
      const store = await context.get(SessionStore);
      const rawClient = await context.get<RedisLike>(REDIS_CLIENT);

      await store.save('s-ex', 'u1');
      const ttl = await rawClient.ttl('session:s-ex');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);

      // Fractional seconds are handed to Redis as PX with milliseconds rounded up.
      await store.saveWithTtl('s-px', 'u1', 0.25);
      const pttl = await rawClient.pttl('session:s-px');
      expect(pttl).toBeGreaterThan(0);
      expect(pttl).toBeLessThanOrEqual(250);

      // Omitting the TTL writes a persistent key.
      await store.saveWithTtl('s-persist', 'u1');
      expect(await rawClient.ttl('session:s-persist')).toBe(-1);
    } finally {
      await context.close();
    }
  });

  it('quits gracefully on application close', async () => {
    const { SessionsModule } = createSessionsApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(SessionsModule);
    const rawClient = await context.get<RedisLike>(REDIS_CLIENT);

    // Subscribe before triggering: the 'end' status event is the observable
    // graceful-teardown signal (ioredis processes the QUIT reply on the
    // socket close tick, so polling status would be a timing assumption).
    const ended = once(rawClient, 'end', { signal: AbortSignal.timeout(5_000) }).then(() => undefined);

    await context.close();
    await ended;

    expect(rawClient.status).toBe('end');
  });
});

describe('redis guide fixtures: named clients and registration identity', () => {
  it('binds named registrations to distinct clients and facades', async () => {
    const { SessionsModule, AnalyticsStore } = createSessionsApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(SessionsModule);

    try {
      const store = await context.get(AnalyticsStore);
      const identity = store.clientIdentity();

      expect(identity.defaultClient).not.toBe(identity.analyticsClient);
      expect(identity.analyticsFacadeIsDefault).toBe(false);
      await expect(context.get(getRedisServiceToken('analytics'))).resolves.toBeInstanceOf(RedisService);
    } finally {
      await context.close();
    }
  });

  it('rejects duplicate registration identities before creating a second client', async () => {
    const { DuplicateRegistrationsModule } = createDuplicateRegistrationsApp({
      host: '127.0.0.1',
      port: fixture!.port,
    });

    await expect(FluoFactory.createApplicationContext(DuplicateRegistrationsModule)).rejects.toThrow(
      'Duplicate @fluojs/redis registration identity "default".',
    );
  });
});
