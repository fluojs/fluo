import { REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

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

class OneTimeStaleReleaseFailureRedisClient {
  private firstTaskToken: string | undefined;
  private readonly locks = new Map<string, string>();
  private staleReleaseFailed = false;

  get staleReleaseFailures(): number {
    return this.staleReleaseFailed ? 1 : 0;
  }

  expire(key: string): void {
    this.locks.delete(key);
  }

  hasLock(key: string): boolean {
    return this.locks.has(key);
  }

  async set(key: string, token: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, token);

    if (!key.includes('__probe') && this.firstTaskToken === undefined) {
      this.firstTaskToken = token;
    }

    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, token: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      return this.locks.get(key) === token ? 1 : 0;
    }

    if (!script.includes('DEL')) {
      return 0;
    }

    if (token === this.firstTaskToken && !this.staleReleaseFailed) {
      this.staleReleaseFailed = true;
      throw new Error('stale release failed once');
    }

    if (this.locks.get(key) !== token) {
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

describe('Cron stopped-state release retry race safety', () => {
  it('preserves a newer same-manager shared-key lease until its running task settles', async () => {
    // Given
    const redis = new OneTimeStaleReleaseFailureRedisClient();
    const scheduled = createManualScheduler();
    const staleTaskFinished = createDeferred();
    const staleTaskStarted = createDeferred();
    const currentTaskFinished = createDeferred();
    const currentTaskStarted = createDeferred();
    const lockKey = 'stopped-retry-race:shared-task';

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: { enabled: true, keyPrefix: 'stopped-retry-race', lockTtlMs: 60_000 },
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
    await app.close();

    // When
    staleTaskFinished.resolve();
    await staleTick;

    // Then
    expect(redis.staleReleaseFailures).toBe(1);
    expect(redis.hasLock(lockKey)).toBe(true);

    currentTaskFinished.resolve();
    await currentTick;
    expect(redis.hasLock(lockKey)).toBe(false);
  });
});
