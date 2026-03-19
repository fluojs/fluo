import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inject } from '@konekti/core';
import { REDIS_CLIENT } from '@konekti/redis';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';

import { Cron } from './decorators.js';
import { CronExpression } from './expressions.js';
import { getCronTaskMetadataEntries } from './metadata.js';
import { createCronModule } from './module.js';
import type { CronScheduleOptions, CronScheduledJob, CronScheduler } from './types.js';

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

interface ScheduledRecord {
  callback: () => Promise<void>;
  expression: string;
  options: CronScheduleOptions;
  stop: ReturnType<typeof vi.fn>;
  tick: () => Promise<void>;
}

class InMemoryLockRedisClient {
  private readonly locks = new Map<string, string>();

  async set(key: string, value: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, value);
    return 'OK';
  }

  async eval(_script: string, _keysLength: number, key: string, owner: string): Promise<number> {
    if (this.locks.get(key) !== owner) {
      return 0;
    }

    this.locks.delete(key);
    return 1;
  }
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

function createManualScheduler(): { records: ScheduledRecord[]; scheduler: CronScheduler } {
  const records: ScheduledRecord[] = [];
  const scheduler: CronScheduler = (expression, options, callback): CronScheduledJob => {
    let stopped = false;
    const stop = vi.fn(() => {
      stopped = true;
    });
    const record: ScheduledRecord = {
      callback,
      expression,
      options,
      stop,
      tick: async () => {
        if (stopped) {
          return;
        }

        await callback();
      },
    };

    records.push(record);

    return {
      stop,
    };
  };

  return { records, scheduler };
}

function createLogger(events: string[]): ApplicationLogger {
  return {
    debug(message: string, context?: string) {
      events.push(`debug:${context ?? 'none'}:${message}`);
    },
    error(message: string, error?: unknown, context?: string) {
      events.push(`error:${context ?? 'none'}:${message}:${error instanceof Error ? error.message : 'none'}`);
    },
    log(message: string, context?: string) {
      events.push(`log:${context ?? 'none'}:${message}`);
    },
    warn(message: string, context?: string) {
      events.push(`warn:${context ?? 'none'}:${message}`);
    },
  };
}

describe('@konekti/cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes cron metadata from @Cron() using standard decorators', () => {
    class TaskService {
      @Cron(CronExpression.EVERY_10_SECONDS, { name: 'heartbeat', timezone: 'UTC' })
      heartbeat() {}
    }

    const entries = getCronTaskMetadataEntries(TaskService.prototype);

    expect(entries).toEqual([
      {
        metadata: {
          expression: CronExpression.EVERY_10_SECONDS,
          options: {
            name: 'heartbeat',
            timezone: 'UTC',
          },
        },
        propertyKey: 'heartbeat',
      },
    ]);
  });

  it('discovers cron tasks across imported modules and resolves DI-backed instances', async () => {
    const scheduled = createManualScheduler();

    class TickStore {
      count = 0;
    }

    @Inject([TickStore])
    class FeatureCronService {
      constructor(private readonly store: TickStore) {}

      @Cron(CronExpression.EVERY_SECOND)
      onTick() {
        this.store.count += 1;
      }
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [TickStore, FeatureCronService],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FeatureModule, createCronModule({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const store = await app.container.resolve(TickStore);

    expect(scheduled.records).toHaveLength(1);
    expect(scheduled.records[0]?.options.name).toBe('FeatureCronService.onTick');

    await scheduled.records[0]!.tick();

    expect(store.count).toBe(1);

    await app.close();
  });

  it('isolates task errors so a failing cron task does not block others', async () => {
    const scheduled = createManualScheduler();
    const loggerEvents: string[] = [];

    class TickStore {
      count = 0;
    }

    @Inject([TickStore])
    class SuccessTask {
      constructor(private readonly store: TickStore) {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'success-task' })
      run() {
        this.store.count += 1;
      }
    }

    class FailingTask {
      @Cron(CronExpression.EVERY_SECOND, { name: 'failing-task' })
      run() {
        throw new Error('boom');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createCronModule({ scheduler: scheduled.scheduler })],
      providers: [TickStore, SuccessTask, FailingTask],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      mode: 'test',
      rootModule: AppModule,
    });
    const store = await app.container.resolve(TickStore);

    const successRecord = scheduled.records.find((record) => record.options.name === 'success-task');
    const failingRecord = scheduled.records.find((record) => record.options.name === 'failing-task');

    expect(successRecord).toBeDefined();
    expect(failingRecord).toBeDefined();

    await failingRecord!.tick();
    await successRecord!.tick();

    expect(store.count).toBe(1);
    expect(loggerEvents.some((event) => event.includes('Cron task failing-task failed.'))).toBe(true);

    await app.close();
  });

  it('stops all scheduled jobs during application shutdown', async () => {
    const scheduled = createManualScheduler();

    class TaskService {
      @Cron(CronExpression.EVERY_SECOND)
      run() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createCronModule({ scheduler: scheduled.scheduler })],
      providers: [TaskService],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });

    expect(scheduled.records).toHaveLength(1);

    await app.close();

    expect(scheduled.records[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('uses distributed Redis locking so only one app executes the same task tick', async () => {
    const firstScheduler = createManualScheduler();
    const secondScheduler = createManualScheduler();
    const redis = new InMemoryLockRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();

    class SharedStore {
      count = 0;
    }

    @Inject([SharedStore])
    class DistributedTaskService {
      constructor(private readonly store: SharedStore) {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'distributed-task' })
      async run() {
        this.store.count += 1;
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createCronModule({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-test',
            lockTtlMs: 60_000,
          },
          scheduler: firstScheduler.scheduler,
        }),
      ],
      providers: [SharedStore, DistributedTaskService],
    });

    class SecondAppModule {}
    defineModule(SecondAppModule, {
      imports: [
        createCronModule({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-test',
            lockTtlMs: 60_000,
          },
          scheduler: secondScheduler.scheduler,
        }),
      ],
      providers: [SharedStore, DistributedTaskService],
    });

    const appOne = await bootstrapApplication({
      mode: 'test',
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const appTwo = await bootstrapApplication({
      mode: 'test',
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: SecondAppModule,
    });

    const firstTick = firstScheduler.records[0]!.tick();
    await started.promise;
    await secondScheduler.records[0]!.tick();

    release.resolve();
    await firstTick;

    const firstStore = await appOne.container.resolve(SharedStore);
    const secondStore = await appTwo.container.resolve(SharedStore);

    expect(firstStore.count + secondStore.count).toBe(1);

    await appOne.close();
    await appTwo.close();
  });

  it('releases owned distributed locks during shutdown so another node can continue', async () => {
    const firstScheduler = createManualScheduler();
    const secondScheduler = createManualScheduler();
    const redis = new InMemoryLockRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();

    class SharedStore {
      count = 0;
    }

    @Inject([SharedStore])
    class DistributedTaskService {
      constructor(private readonly store: SharedStore) {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'distributed-shutdown-release' })
      async run() {
        this.store.count += 1;
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        createCronModule({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-shutdown-release',
            lockTtlMs: 60_000,
          },
          scheduler: firstScheduler.scheduler,
        }),
      ],
      providers: [SharedStore, DistributedTaskService],
    });

    class SecondAppModule {}
    defineModule(SecondAppModule, {
      imports: [
        createCronModule({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-shutdown-release',
            lockTtlMs: 60_000,
          },
          scheduler: secondScheduler.scheduler,
        }),
      ],
      providers: [SharedStore, DistributedTaskService],
    });

    const appOne = await bootstrapApplication({
      mode: 'test',
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const appTwo = await bootstrapApplication({
      mode: 'test',
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: SecondAppModule,
    });

    const firstTick = firstScheduler.records[0]!.tick();
    await started.promise;

    const closePromise = appOne.close();
    await secondScheduler.records[0]!.tick();

    const firstStoreBeforeRelease = await appOne.container.resolve(SharedStore);
    const secondStoreBeforeRelease = await appTwo.container.resolve(SharedStore);

    expect(firstStoreBeforeRelease.count + secondStoreBeforeRelease.count).toBe(1);

    release.resolve();
    await firstTick;
    await closePromise;
    await secondScheduler.records[0]!.tick();

    const firstStore = await appOne.container.resolve(SharedStore);
    const secondStore = await appTwo.container.resolve(SharedStore);

    expect(firstStore.count + secondStore.count).toBe(2);

    await appTwo.close();
  });

  it('runs on real scheduler timing with fake timers and stops after close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.500Z'));

    class TickStore {
      count = 0;
    }

    @Inject([TickStore])
    class DefaultSchedulerTaskService {
      constructor(private readonly store: TickStore) {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'default-scheduler-tick' })
      run() {
        this.store.count += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [createCronModule()],
      providers: [TickStore, DefaultSchedulerTaskService],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const store = await app.container.resolve(TickStore);

    expect(store.count).toBe(0);

    await vi.advanceTimersByTimeAsync(400);
    expect(store.count).toBe(0);

    await vi.advanceTimersByTimeAsync(200);
    expect(store.count).toBe(1);

    await app.close();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.count).toBe(1);
  });
});
