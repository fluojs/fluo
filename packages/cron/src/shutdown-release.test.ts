import { REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Cron } from './decorators.js';
import { CronExpression } from './expressions.js';
import { CronModule } from './module.js';
import type { CronPlatformStatusSnapshot } from './status.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduler, SchedulingRegistry } from './types.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface ShutdownReleaseScenario {
  readonly finishTask: () => void;
  readonly statusService: StatusAwareSchedulingRegistry;
  readonly tickPromise: Promise<void>;
}

interface StatusAwareSchedulingRegistry extends SchedulingRegistry {
  createPlatformStatusSnapshot(): CronPlatformStatusSnapshot;
}

class HangingReleaseRedisClient {
  private readonly hangingRelease = new Promise<number>(() => {});
  private readonly locks = new Map<string, string>();

  async set(key: string, owner: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, owner);
    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, owner: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      return this.locks.get(key) === owner ? 1 : 0;
    }

    if (!script.includes('DEL') || this.locks.get(key) !== owner) {
      return 0;
    }

    if (key.includes('__probe')) {
      this.locks.delete(key);
      return 1;
    }

    return await this.hangingRelease;
  }
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

function createManualScheduler(): { readonly scheduler: CronScheduler; readonly tick: () => Promise<void> } {
  let scheduledTick: (() => Promise<void>) | undefined;
  const scheduler: CronScheduler = (_expression, _options, callback) => {
    scheduledTick = callback;
    return { stop: () => {} };
  };

  return {
    scheduler,
    tick: async () => {
      if (scheduledTick === undefined) {
        throw new Error('Expected the shutdown release task to be scheduled.');
      }

      await scheduledTick();
    },
  };
}

function isStatusAwareSchedulingRegistry(registry: SchedulingRegistry): registry is StatusAwareSchedulingRegistry {
  return (
    'createPlatformStatusSnapshot' in registry && typeof registry.createPlatformStatusSnapshot === 'function'
  );
}

async function createShutdownReleaseScenario(): Promise<ShutdownReleaseScenario> {
  const scheduled = createManualScheduler();
  const started = createDeferred();
  const finished = createDeferred();

  class DistributedTaskService {
    @Cron(CronExpression.EVERY_SECOND, { name: 'bounded-post-shutdown-release' })
    async run(): Promise<void> {
      started.resolve();
      await finished.promise;
    }
  }

  class AppModule {}
  defineModule(AppModule, {
    imports: [
      CronModule.forRoot({
        distributed: {
          enabled: true,
          keyPrefix: 'bounded-post-shutdown-release',
          lockTtlMs: 60_000,
        },
        scheduler: scheduled.scheduler,
        shutdown: { timeoutMs: 50 },
      }),
    ],
    providers: [DistributedTaskService],
  });

  const app = await bootstrapApplication({
    providers: [{ provide: REDIS_CLIENT, useValue: new HangingReleaseRedisClient() }],
    rootModule: AppModule,
  });
  const registry = await app.container.resolve(SCHEDULING_REGISTRY);

  if (!isStatusAwareSchedulingRegistry(registry)) {
    throw new Error('Expected the scheduling registry to expose Cron status snapshots.');
  }

  const tickPromise = scheduled.tick();
  await started.promise;

  const closePromise = app.close();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(50);
  await closePromise;

  return {
    finishTask: finished.resolve,
    statusService: registry,
    tickPromise,
  };
}

describe('Cron distributed release during shutdown', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('settles task-finally lock release within the shutdown timeout after shutdown has elapsed', async () => {
    // Given
    vi.useFakeTimers();
    const scenario = await createShutdownReleaseScenario();
    let tickSettled = false;
    void scenario.tickPromise.then(() => {
      tickSettled = true;
    });

    // When
    scenario.finishTask();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(49);

    // Then
    expect(tickSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    expect(tickSettled).toBe(true);
  });

  it('retains unresolved ownership when task-finally lock release reaches the shutdown timeout', async () => {
    // Given
    vi.useFakeTimers();
    const scenario = await createShutdownReleaseScenario();
    let tickSettled = false;
    void scenario.tickPromise.then(() => {
      tickSettled = true;
    });

    // When
    scenario.finishTask();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    // Then
    expect(tickSettled).toBe(true);
    expect(scenario.statusService.createPlatformStatusSnapshot().details.ownedLocks).toBe(1);
  });
});
