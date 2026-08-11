import { REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CronExpression } from './expressions.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduledJob, CronScheduler, SchedulingRegistry } from './types.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

class DelayedFirstReleaseRedisClient {
  private readonly allowFirstRelease = createDeferred();
  private readonly firstReleaseStarted = createDeferred();
  private readonly locks = new Map<string, string>();
  private taskReleaseCalls = 0;

  expire(key: string): void {
    this.locks.delete(key);
  }

  finishFirstRelease(): void {
    this.allowFirstRelease.resolve();
  }

  hasLock(key: string): boolean {
    return this.locks.has(key);
  }

  waitForFirstRelease(): Promise<void> {
    return this.firstReleaseStarted.promise;
  }

  async set(key: string, value: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, value);
    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, token: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      return this.locks.get(key) === token ? 1 : 0;
    }

    if (!script.includes('DEL')) {
      return 0;
    }

    if (!key.includes('__probe')) {
      this.taskReleaseCalls += 1;

      if (this.taskReleaseCalls === 1) {
        this.firstReleaseStarted.resolve();
        await this.allowFirstRelease.promise;
      } else if (this.taskReleaseCalls === 2) {
        return 0;
      }
    }

    if (this.locks.get(key) !== token) {
      return 0;
    }

    this.locks.delete(key);
    return 1;
  }
}

class ExpiringLeaseRedisClient {
  private readonly locks = new Map<string, string>();

  expire(key: string): void {
    this.locks.delete(key);
  }

  hasLock(key: string): boolean {
    return this.locks.has(key);
  }

  async set(key: string, value: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, value);
    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, token: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      return this.locks.get(key) === token ? 1 : 0;
    }

    if (!script.includes('DEL') || this.locks.get(key) !== token) {
      return 0;
    }

    this.locks.delete(key);
    return 1;
  }
}

function createManualScheduler(): {
  readonly callbacks: Array<() => Promise<void>>;
  readonly scheduler: CronScheduler;
} {
  const callbacks: Array<() => Promise<void>> = [];
  const scheduler: CronScheduler = (_expression, _options, callback): CronScheduledJob => {
    callbacks.push(callback);
    return { stop: () => {} };
  };

  return { callbacks, scheduler };
}

describe('Cron distributed lease race safety', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not let a stale release delete a newer lease with the same configured owner', async () => {
    // Given
    vi.useFakeTimers();
    const redis = new DelayedFirstReleaseRedisClient();
    const firstScheduler = createManualScheduler();
    const secondScheduler = createManualScheduler();
    const firstTaskFinished = createDeferred();
    const firstTaskStarted = createDeferred();
    const secondTaskFinished = createDeferred();
    const secondTaskStarted = createDeferred();
    const lockKey = 'lease-race:shared-task';

    class FirstAppModule {}
    defineModule(FirstAppModule, {
      imports: [
        CronModule.forRoot({
          distributed: { enabled: true, keyPrefix: 'lease-race', lockTtlMs: 60_000, ownerId: 'shared-owner' },
          scheduler: firstScheduler.scheduler,
          shutdown: { timeoutMs: 50 },
        }),
      ],
    });
    class SecondAppModule {}
    defineModule(SecondAppModule, {
      imports: [
        CronModule.forRoot({
          distributed: { enabled: true, keyPrefix: 'lease-race', lockTtlMs: 60_000, ownerId: 'shared-owner' },
          scheduler: secondScheduler.scheduler,
        }),
      ],
    });

    const firstApp = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: FirstAppModule,
    });
    const secondApp = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: SecondAppModule,
    });
    const firstRegistry = await firstApp.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const secondRegistry = await secondApp.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    firstRegistry.addCron('shared-task', CronExpression.EVERY_SECOND, async () => {
      firstTaskStarted.resolve();
      await firstTaskFinished.promise;
    });
    secondRegistry.addCron('shared-task', CronExpression.EVERY_SECOND, async () => {
      secondTaskStarted.resolve();
      await secondTaskFinished.promise;
    });

    const firstTick = requireValue(firstScheduler.callbacks[0], 'Expected the first cron callback.')();
    await firstTaskStarted.promise;
    const closePromise = firstApp.close();
    await Promise.resolve();
    firstTaskFinished.resolve();
    await redis.waitForFirstRelease();
    await vi.advanceTimersByTimeAsync(50);
    await firstTick;
    await closePromise;
    redis.expire(lockKey);

    const secondTick = requireValue(secondScheduler.callbacks[0], 'Expected the second cron callback.')();
    await secondTaskStarted.promise;

    // When
    redis.finishFirstRelease();
    await Promise.resolve();

    // Then
    expect(redis.hasLock(lockKey)).toBe(true);

    secondTaskFinished.resolve();
    await secondTick;
    await secondApp.close();
  });

  it('preserves a newer same-manager lease when stale work settles before shutdown', async () => {
    // Given
    const redis = new ExpiringLeaseRedisClient();
    const scheduled = createManualScheduler();
    const staleTaskFinished = createDeferred();
    const staleTaskStarted = createDeferred();
    const currentTaskFinished = createDeferred();
    const currentTaskStarted = createDeferred();
    const lockKey = 'lease-race:shared-task';

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: { enabled: true, keyPrefix: 'lease-race', lockTtlMs: 60_000 },
          scheduler: scheduled.scheduler,
          shutdown: { timeoutMs: 0 },
        }),
      ],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron(
      'stale-task',
      CronExpression.EVERY_SECOND,
      async () => {
        staleTaskStarted.resolve();
        await staleTaskFinished.promise;
      },
      { key: 'shared-task' },
    );
    registry.addCron(
      'current-task',
      CronExpression.EVERY_SECOND,
      async () => {
        currentTaskStarted.resolve();
        await currentTaskFinished.promise;
      },
      { key: 'shared-task' },
    );

    const staleTick = requireValue(scheduled.callbacks[0], 'Expected the stale cron callback.')();
    await staleTaskStarted.promise;
    redis.expire(lockKey);
    const currentTick = requireValue(scheduled.callbacks[1], 'Expected the current cron callback.')();
    await currentTaskStarted.promise;
    staleTaskFinished.resolve();
    await staleTick;

    // When
    await app.close();

    // Then
    try {
      expect(redis.hasLock(lockKey)).toBe(true);
    } finally {
      currentTaskFinished.resolve();
      await currentTick;
    }
  });
});
