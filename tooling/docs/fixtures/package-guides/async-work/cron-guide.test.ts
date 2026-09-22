import { Cron, CronExpression, Interval, SCHEDULING_REGISTRY, type SchedulingRegistry } from '@fluojs/cron';
import { FluoFactory } from '@fluojs/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { startRedisFixture } from '../../../../testing/redis-native-fixture.mjs';
import { createCronGuideApp, createDistributedCronGuideApp } from './cron-guide-app';
import { boundedWait, createDeferred } from './helpers';

/**
 * Guide fixture for the Cron guide (apps/docs/content/docs/packages/cron.mdx).
 *
 * Evidence scope: decorator-time expression/method validation, bootstrap
 * discovery as observed through the scheduling registry, dynamic registry
 * semantics (self-disabling timeouts, rollback-safe updates, duplicate-name
 * rejection, removal), and - against a real redis:7.4-alpine server - a
 * distributed task holding a Redis lease while its callback runs and
 * releasing it in the post-run path. All waits are event barriers with a
 * bounded reject timer; no sleeps, no polling.
 */

describe('cron guide fixtures: decorator discovery and validation', () => {
  it('exposes decorator tasks as immutable registry descriptors after bootstrap', async () => {
    const { AppModule } = createCronGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const tasks = registry.getAll();

      const reconcile = tasks.find((task) => task.name === 'billing.reconcile');
      expect(reconcile).toMatchObject({
        source: 'decorator',
        kind: 'cron',
        expression: CronExpression.EVERY_MINUTE,
        enabled: true,
      });

      const initialSync = tasks.find((task) => task.name === 'BillingTasks.initialSync');
      // Decorator tasks without an explicit name option are keyed as
      // `<ClassName>.<methodName>` by the discovery contract.
      expect(initialSync).toMatchObject({
        source: 'decorator',
        kind: 'timeout',
        ms: 5_000,
        enabled: true,
      });
    } finally {
      await context.close();
    }
  });

  it('validates cron expressions and method placement when the decorator is evaluated', () => {
    expect(() => {
      class BrokenExpression {
        @Cron('not-a-cron')
        boom(): Promise<void> {
          return Promise.resolve();
        }
      }

      return BrokenExpression;
    }).toThrow('@Cron(): invalid cron expression');

    expect(() => {
      class StaticTask {
        @Interval(1_000)
        static tick(): Promise<void> {
          return Promise.resolve();
        }
      }

      return StaticTask;
    }).toThrow('@Interval() cannot be used on static methods');
  });
});

describe('cron guide fixtures: dynamic registry semantics', () => {
  it('runs a dynamic timeout once and leaves it disabled in the registry', async () => {
    const { AppModule } = createCronGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const fired = createDeferred<void>();

      registry.addTimeout('guide.one-shot', 1, () => {
        fired.resolve();
      });

      // Event barrier: the callback itself resolves the deferred, bounded by
      // a reject timer - no polling, no sleep.
      await boundedWait(fired.promise, 'dynamic timeout tick');

      // The self-disable happens in the tick pipeline after the callback
      // returns; one event-loop turn lets that in-flight microtask chain
      // settle before the descriptor is read.
      await boundedWait(
        new Promise<void>((resolve) => setImmediate(resolve)),
        'timeout tick settle',
      );

      const descriptor = registry.get('guide.one-shot');
      expect(descriptor).toMatchObject({ source: 'dynamic', kind: 'timeout', enabled: false });

      expect(registry.remove('guide.one-shot')).toBe(true);
      expect(registry.get('guide.one-shot')).toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it('rejects duplicate task names and invalid cron expressions atomically', async () => {
    const { AppModule } = createCronGuideApp();
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const noop = (): void => undefined;

      registry.addCron('guide.cron', '0 * * * *', noop);

      expect(() => registry.addCron('guide.cron', '0 */2 * * *', noop)).toThrow(/Duplicate scheduling task name/);

      expect(() => registry.addCron('guide.bad', 'not-a-cron', noop)).toThrow(
        '@Cron(): invalid cron expression "not-a-cron".',
      );
      expect(registry.get('guide.bad')).toBeUndefined();

      // With the default croner scheduler the replacement of a started named
      // task currently throws (croner's process-global job-name registry is
      // checked create-before-stop), which exercises the documented
      // transactional rollback: the previous expression remains active. See
      // this fixture README for the discrepancy report.
      expect(() => registry.updateCronExpression('guide.cron', '0 */2 * * *')).toThrow();
      expect(registry.get('guide.cron')?.expression).toBe('0 * * * *');

      expect(registry.remove('guide.absent')).toBe(false);
    } finally {
      await context.close();
    }
  });
});

describe('cron guide fixtures: native distributed locking', () => {
  const containerName = `fluo-docs-guides-async-work-${randomUUID()}`;
  const exec = promisify(execFile);
  let fixture: Awaited<ReturnType<typeof startRedisFixture>> | undefined;

  beforeAll(async () => {
    fixture = await startRedisFixture({
      containerName,
      diagnosticPath: resolve('.artifacts/redis-native-fixture/docs-package-guides-async-work.json'),
      execFile: exec,
      spawn,
    });
  }, 70_000);

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('holds a Redis lease while a distributed tick runs and releases it for the next tick', async () => {
    const { AppModule, LockProbe: Probe } = createDistributedCronGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const registry = await context.get<SchedulingRegistry>(SCHEDULING_REGISTRY);
      const probe = await context.get(Probe);
      const lockKey = 'fluo:cron:guide:locked-poll';
      const leaseTokens: string[] = [];

      let resolveFirstTick!: () => void;
      let resolveSecondTick!: () => void;
      const firstTick = new Promise<void>((resolve) => {
        resolveFirstTick = resolve;
      });
      const secondTick = new Promise<void>((resolve) => {
        resolveSecondTick = resolve;
      });

      registry.addInterval(
        'locked-poll',
        5,
        async () => {
          // Inside the callback the task must own the Redis lease.
          leaseTokens.push((await probe.readLock(lockKey)) ?? '');
          if (leaseTokens.length === 1) {
            resolveFirstTick();
          } else {
            resolveSecondTick();
            registry.disable('locked-poll');
          }
        },
        { distributed: true },
      );

      await boundedWait(firstTick, 'first distributed tick');
      expect(leaseTokens[0].length).toBeGreaterThan(0);

      // The task stays enabled; the second tick's body can only run if the
      // first tick's post-run release freed the Redis lease, so this barrier
      // is the release evidence. A skipped (guard-blocked) tick never
      // resolves it, and the bounded wait fails the test in that case.
      await boundedWait(secondTick, 'lease re-acquired after release');
      expect(leaseTokens[1].length).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  }, 30_000);
});
