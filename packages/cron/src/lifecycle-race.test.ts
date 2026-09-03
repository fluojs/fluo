import { REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

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

function createRetainedCallbackScheduler(): {
  readonly callbacks: Array<() => Promise<void>>;
  readonly scheduler: CronScheduler;
  readonly stopStarted: Promise<void>;
  readonly stops: Array<ReturnType<typeof vi.fn>>;
} {
  const callbacks: Array<() => Promise<void>> = [];
  const stopStarted = createDeferred();
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const scheduler: CronScheduler = (_expression, _options, callback): CronScheduledJob => {
    const stop = vi.fn(stopStarted.resolve);
    callbacks.push(callback);
    stops.push(stop);
    return { stop };
  };

  return { callbacks, scheduler, stopStarted: stopStarted.promise, stops };
}

class DeferredAcquisitionRedisClient {
  private readonly acquisitionStarted = createDeferred();
  private readonly allowAcquisition = createDeferred();
  private readonly locks = new Map<string, string>();

  completeAcquisition(): void {
    this.allowAcquisition.resolve();
  }

  hasLock(key: string): boolean {
    return this.locks.has(key);
  }

  waitForAcquisition(): Promise<void> {
    return this.acquisitionStarted.promise;
  }

  async set(key: string, token: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (key.includes(':__probe:')) {
      this.locks.set(key, token);
      return 'OK';
    }

    this.acquisitionStarted.resolve();
    await this.allowAcquisition.promise;

    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, token);
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

describe('Cron lifecycle race safety', () => {
  it('does not execute a queued tick while shutdown drains active work', async () => {
    // Given
    const scheduled = createRetainedCallbackScheduler();
    const activeTaskFinished = createDeferred();
    const activeTaskStarted = createDeferred();
    let runs = 0;
    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('active-during-shutdown', CronExpression.EVERY_SECOND, async () => {
      activeTaskStarted.resolve();
      await activeTaskFinished.promise;
    });
    registry.addCron('queued-during-shutdown', CronExpression.EVERY_SECOND, () => {
      runs += 1;
    });
    const activeTick = requireValue(scheduled.callbacks[0], 'Expected an active cron callback.')();
    const queuedTick = requireValue(scheduled.callbacks[1], 'Expected a queued cron callback.');
    await activeTaskStarted.promise;

    // When
    const closePromise = app.close();
    await scheduled.stopStarted;

    // Then
    try {
      await queuedTick();
      expect(runs).toBe(0);
    } finally {
      activeTaskFinished.resolve();
      await Promise.all([activeTick, closePromise]);
    }
  });

  it('does not execute a provisional replacement before the previous handle stops', async () => {
    // Given
    const scheduled = createRetainedCallbackScheduler();
    const provisionalTicks: Array<Promise<void>> = [];
    let runs = 0;
    const scheduler: CronScheduler = (expression, options, callback) => {
      const handle = scheduled.scheduler(expression, options, callback);

      if (scheduled.callbacks.length === 2) {
        provisionalTicks.push(callback());
      }

      return handle;
    };
    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('transactional-replacement', CronExpression.EVERY_SECOND, () => {
      runs += 1;
    });
    const previousStop = requireValue(scheduled.stops[0], 'Expected the previous cron handle.');
    previousStop.mockImplementationOnce(() => {
      throw new Error('previous handle stop failed');
    });

    // When
    expect(() => registry.updateCronExpression('transactional-replacement', CronExpression.EVERY_5_SECONDS)).toThrow(
      'previous handle stop failed',
    );
    await Promise.all(provisionalTicks);

    // Then
    expect(runs).toBe(0);

    await app.close();
  });

  it('does not execute a callback queued by a successfully retired handle', async () => {
    // Given
    const scheduled = createRetainedCallbackScheduler();
    let runs = 0;
    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('successful-replacement', CronExpression.EVERY_SECOND, () => {
      runs += 1;
    });
    const retiredTick = requireValue(scheduled.callbacks[0], 'Expected the previous cron callback.');
    registry.updateCronExpression('successful-replacement', CronExpression.EVERY_5_SECONDS);

    // When
    try {
      await retiredTick();

      // Then
      expect(runs).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('releases a lease acquired after shutdown starts without running the task body', async () => {
    // Given
    const redis = new DeferredAcquisitionRedisClient();
    const scheduled = createRetainedCallbackScheduler();
    let runs = 0;
    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: { enabled: true, keyPrefix: 'shutdown-acquisition', lockTtlMs: 60_000 },
          scheduler: scheduled.scheduler,
        }),
      ],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    registry.addCron('acquired-after-shutdown', CronExpression.EVERY_SECOND, () => {
      runs += 1;
    });
    const tick = requireValue(scheduled.callbacks[0], 'Expected a distributed cron callback.')();
    await redis.waitForAcquisition();

    // When
    const closePromise = app.close();
    await scheduled.stopStarted;
    redis.completeAcquisition();
    await Promise.all([tick, closePromise]);

    // Then
    expect(runs).toBe(0);
    expect(redis.hasLock('shutdown-acquisition:acquired-after-shutdown')).toBe(false);
  });
});
