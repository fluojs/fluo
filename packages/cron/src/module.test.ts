import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inject, Scope } from '@fluojs/core';
import { defineControllerMetadata } from '@fluojs/core/internal';
import { REDIS_CLIENT } from '@fluojs/redis';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@fluojs/runtime';

import { Cron, Interval, Timeout } from './decorators.js';
import { CronExpression } from './expressions.js';
import { getCronTaskMetadataEntries, getSchedulingTaskMetadataEntries } from './metadata.js';
import { CronModule } from './module.js';
import { SCHEDULING_REGISTRY } from './tokens.js';
import type { CronScheduleOptions, CronScheduledJob, CronScheduler, SchedulingRegistry } from './types.js';

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

  async eval(script: string, _keysLength: number, key: string, owner: string, _ttl?: string): Promise<number> {
    if (this.locks.get(key) !== owner) {
      return 0;
    }

    if (script.includes('PEXPIRE')) {
      return 1;
    }

    if (!script.includes('DEL')) {
      return 0;
    }

    this.locks.delete(key);
    return 1;
  }
}

class LockLossOnRenewRedisClient {
  private readonly locks = new Map<string, string>();

  async set(key: string, value: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, value);
    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, owner: string, _ttl?: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      if (this.locks.get(key) !== owner) {
        return 0;
      }

      this.locks.delete(key);
      return 0;
    }

    if (!script.includes('DEL')) {
      return 0;
    }

    if (this.locks.get(key) !== owner) {
      return 0;
    }

    this.locks.delete(key);
    return 1;
  }
}

class RenewalErrorOnRenewRedisClient {
  private readonly locks = new Map<string, string>();

  async set(key: string, value: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, value);
    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, owner: string, _ttl?: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      throw new Error('renew failed');
    }

    if (!script.includes('DEL')) {
      return 0;
    }

    if (this.locks.get(key) !== owner) {
      return 0;
    }

    this.locks.delete(key);
    return 1;
  }
}

class OverlappingRenewalRedisClient {
  private readonly locks = new Map<string, string>();
  private renewalCalls = 0;

  constructor(private readonly firstRenewalResult: Deferred<number>) {}

  async set(key: string, value: string, _mode: 'PX', _ttl: number, _existence: 'NX'): Promise<'OK' | null> {
    if (this.locks.has(key)) {
      return null;
    }

    this.locks.set(key, value);
    return 'OK';
  }

  async eval(script: string, _keysLength: number, key: string, owner: string, _ttl?: string): Promise<number> {
    if (script.includes('PEXPIRE')) {
      this.renewalCalls += 1;

      if (this.renewalCalls === 1) {
        return await this.firstRenewalResult.promise;
      }

      return this.locks.get(key) === owner ? 1 : 0;
    }

    if (!script.includes('DEL')) {
      return 0;
    }

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

describe('@fluojs/cron', () => {
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
          kind: 'cron',
          options: {
            name: 'heartbeat',
            timezone: 'UTC',
          },
        },
        propertyKey: 'heartbeat',
      },
    ]);
  });

  it('writes interval and timeout metadata using standard decorators', () => {
    class TaskService {
      @Interval(1_000, { name: 'heartbeat-interval' })
      heartbeat() {}

      @Timeout(5_000, { name: 'initial-timeout' })
      startupSync() {}
    }

    const entries = getSchedulingTaskMetadataEntries(TaskService.prototype);

    expect(entries).toEqual([
      {
        metadata: {
          kind: 'interval',
          ms: 1_000,
          options: {
            name: 'heartbeat-interval',
          },
        },
        propertyKey: 'heartbeat',
      },
      {
        metadata: {
          kind: 'timeout',
          ms: 5_000,
          options: {
            name: 'initial-timeout',
          },
        },
        propertyKey: 'startupSync',
      },
    ]);
  });

  it('throws during decoration when @Interval() or @Timeout() receives invalid ms', () => {
    expect(() => {
      class InvalidIntervalTask {
        @Interval(0)
        run() {}
      }

      return InvalidIntervalTask;
    }).toThrow('@Interval(): ms must be a positive integer.');

    expect(() => {
      class InvalidTimeoutTask {
        @Timeout(-1)
        run() {}
      }

      return InvalidTimeoutTask;
    }).toThrow('@Timeout(): ms must be a positive integer.');
  });

  it('rejects private methods for @Interval() and @Timeout()', () => {
    expect(() => {
      class InvalidIntervalTask {
        @Interval(1_000)
        #run() {}
      }

      return InvalidIntervalTask;
    }).toThrow('@Interval() cannot be used on private methods.');

    expect(() => {
      class InvalidTimeoutTask {
        @Timeout(1_000)
        #run() {}
      }

      return InvalidTimeoutTask;
    }).toThrow('@Timeout() cannot be used on private methods.');
  });

  it('discovers cron tasks across imported modules and resolves DI-backed instances', async () => {
    const scheduled = createManualScheduler();

    class TickStore {
      count = 0;
    }

    @Inject(TickStore)
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
      imports: [FeatureModule, CronModule.forRoot({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
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

    @Inject(TickStore)
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
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [TickStore, SuccessTask, FailingTask],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
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
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [TaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    expect(scheduled.records).toHaveLength(1);

    await app.close();

    expect(scheduled.records[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('rolls back partially scheduled jobs when startup fails', async () => {
    const firstStop = vi.fn();
    let scheduleCount = 0;
    const scheduler: CronScheduler = (_expression, _options, _callback) => {
      scheduleCount += 1;

      if (scheduleCount === 1) {
        return {
          stop: firstStop,
        };
      }

      throw new Error('scheduler boom');
    };

    class PartialScheduleTaskService {
      @Cron(CronExpression.EVERY_SECOND, { name: 'partial-schedule-1' })
      runOne() {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'partial-schedule-2' })
      runTwo() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler })],
      providers: [PartialScheduleTaskService],
    });

    await expect(
      bootstrapApplication({
        rootModule: AppModule,
      }),
    ).rejects.toThrow('scheduler boom');

    expect(firstStop).toHaveBeenCalledTimes(1);
  });

  it('warns when @Cron() is declared on a non-singleton provider and skips scheduling', async () => {
    const scheduled = createManualScheduler();
    const loggerEvents: string[] = [];

    class ReportService {
      @Cron('0 0 2 * * *')
      generateDailyReport() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [
        {
          provide: ReportService,
          scope: 'transient',
          useClass: ReportService,
        },
      ],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });

    expect(scheduled.records).toHaveLength(0);
    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:CronLifecycleService:ReportService in module AppModule declares scheduling methods (@Cron/@Interval/@Timeout) but is registered with transient scope.',
        ),
      ),
    ).toBe(true);

    await app.close();
  });

  it('warns when @Cron() is declared on non-singleton controllers and skips scheduling', async () => {
    const scheduled = createManualScheduler();
    const loggerEvents: string[] = [];

    @Scope('request')
    class RequestScopedReportController {
      @Cron('0 0 2 * * *')
      generateRequestScopedReport() {}
    }

    @Scope('transient')
    class TransientExportController {
      @Cron('0 30 2 * * *')
      generateTransientExport() {}
    }

    defineControllerMetadata(RequestScopedReportController, { basePath: '/reports' });
    defineControllerMetadata(TransientExportController, { basePath: '/exports' });

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RequestScopedReportController, TransientExportController],
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });

    expect(scheduled.records).toHaveLength(0);
    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:CronLifecycleService:RequestScopedReportController in module AppModule declares scheduling methods (@Cron/@Interval/@Timeout) but is registered with request scope.',
        ),
      ),
    ).toBe(true);
    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:CronLifecycleService:TransientExportController in module AppModule declares scheduling methods (@Cron/@Interval/@Timeout) but is registered with transient scope.',
        ),
      ),
    ).toBe(true);

    await app.close();
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

    @Inject(SharedStore)
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
        CronModule.forRoot({
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
        CronModule.forRoot({
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
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const appTwo = await bootstrapApplication({
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

  it('fails bootstrap before scheduling jobs when distributed mode is enabled without REDIS_CLIENT', async () => {
    const scheduler = createManualScheduler();

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, { name: 'distributed-missing-redis' })
      async run() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-missing-redis',
            lockTtlMs: 60_000,
          },
          scheduler: scheduler.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(
      'Cron distributed mode requires REDIS_CLIENT to be registered.',
    );
    expect(scheduler.records).toHaveLength(0);
  });

  it('fails bootstrap before scheduling jobs when REDIS_CLIENT cannot perform lock operations', async () => {
    const scheduler = createManualScheduler();

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, { name: 'distributed-invalid-redis' })
      async run() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-invalid-redis',
            lockTtlMs: 60_000,
          },
          scheduler: scheduler.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    await expect(
      bootstrapApplication({
        providers: [{ provide: REDIS_CLIENT, useValue: {} }],
        rootModule: AppModule,
      }),
    ).rejects.toThrow('Cron distributed mode requires REDIS_CLIENT to implement set/eval lock operations.');
    expect(scheduler.records).toHaveLength(0);
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

    @Inject(SharedStore)
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
        CronModule.forRoot({
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
        CronModule.forRoot({
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
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const appTwo = await bootstrapApplication({
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

    const secondStore = await appTwo.container.resolve(SharedStore);

    expect(secondStore.count).toBe(1);

    await appTwo.close();
  });

  it('runs on real scheduler timing with fake timers and stops after close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.500Z'));

    class TickStore {
      count = 0;
    }

    @Inject(TickStore)
    class DefaultSchedulerTaskService {
      constructor(private readonly store: TickStore) {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'default-scheduler-tick' })
      run() {
        this.store.count += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot()],
      providers: [TickStore, DefaultSchedulerTaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
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

  it('throws during decoration when @Cron() expression is invalid', () => {
    expect(() => {
      class InvalidCronTask {
        @Cron('not-a-cron')
        run() {}
      }

      return InvalidCronTask;
    }).toThrow('@Cron(): invalid cron expression "not-a-cron".');
  });

  it('fails bootstrap when distributed lock TTL is not a safe positive duration', async () => {
    const scheduler = createManualScheduler();

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, { name: 'distributed-invalid-ttl' })
      async run() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-invalid-ttl',
            lockTtlMs: 500,
          },
          scheduler: scheduler.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    await expect(
      bootstrapApplication({
        providers: [{ provide: REDIS_CLIENT, useValue: new InMemoryLockRedisClient() }],
        rootModule: AppModule,
      }),
    ).rejects.toThrow(/lockTtlMs/i);
    expect(scheduler.records).toHaveLength(0);
  });

  it('runs lifecycle hooks around successful cron execution', async () => {
    const scheduled = createManualScheduler();
    const events: string[] = [];

    class HookedTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        beforeRun: () => {
          events.push('before');
        },
        name: 'hooked-success-task',
        onSuccess: () => {
          events.push('success');
        },
      })
      run() {
        events.push('run');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [HookedTaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await scheduled.records[0]!.tick();

    expect(events).toEqual(['before', 'run', 'success', 'after']);

    await app.close();
  });

  it('runs error lifecycle hooks when cron task fails', async () => {
    const scheduled = createManualScheduler();
    const events: string[] = [];

    class HookedFailingTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        beforeRun: () => {
          events.push('before');
        },
        name: 'hooked-failing-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
        },
      })
      run() {
        events.push('run');
        throw new Error('hook boom');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [HookedFailingTaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await scheduled.records[0]!.tick();

    expect(events).toEqual(['before', 'run', 'error:hook boom', 'after']);

    await app.close();
  });

  it('runs onError and afterRun when beforeRun throws', async () => {
    const scheduled = createManualScheduler();
    const events: string[] = [];

    class BeforeRunFailingTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        beforeRun: () => {
          events.push('before');
          throw new Error('before boom');
        },
        name: 'before-run-failing-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
        },
        onSuccess: () => {
          events.push('success');
        },
      })
      run() {
        events.push('run');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [BeforeRunFailingTaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });

    await scheduled.records[0]!.tick();

    expect(events).toEqual(['before', 'error:before boom', 'after']);

    await app.close();
  });

  it('keeps afterRun deterministic when onError throws', async () => {
    const scheduled = createManualScheduler();
    const events: string[] = [];
    const loggerEvents: string[] = [];

    class OnErrorThrowingTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        beforeRun: () => {
          events.push('before');
          throw new Error('before boom');
        },
        name: 'on-error-throwing-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
          throw new Error('onError boom');
        },
      })
      run() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [OnErrorThrowingTaskService],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });

    await expect(scheduled.records[0]!.tick()).resolves.toBeUndefined();

    expect(events).toEqual(['before', 'error:before boom', 'after']);
    expect(loggerEvents.some((event) => event.includes('Cron onError hook on-error-throwing-task failed.'))).toBe(true);

    await app.close();
  });

  it('treats lock ownership loss during renewal as a failed tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));

    const scheduled = createManualScheduler();
    const redis = new LockLossOnRenewRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: string[] = [];

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        distributed: true,
        lockTtlMs: 2_000,
        name: 'lock-loss-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
        },
        onSuccess: () => {
          events.push('success');
        },
      })
      async run() {
        events.push('run');
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-lock-loss',
            lockTtlMs: 2_000,
          },
          scheduler: scheduled.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    const tickPromise = scheduled.records[0]!.tick();
    await started.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    release.resolve();
    await tickPromise;

    expect(events).toEqual([
      'run',
      'error:Distributed cron lock ownership lost for lock-loss-task.',
      'after',
    ]);

    await app.close();
  });

  it('treats lock renewal errors as a failed tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));

    const scheduled = createManualScheduler();
    const redis = new RenewalErrorOnRenewRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: string[] = [];

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        distributed: true,
        lockTtlMs: 2_000,
        name: 'lock-renew-error-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
        },
        onSuccess: () => {
          events.push('success');
        },
      })
      async run() {
        events.push('run');
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-lock-renew-error',
            lockTtlMs: 2_000,
          },
          scheduler: scheduled.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    const tickPromise = scheduled.records[0]!.tick();
    await started.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    release.resolve();
    await tickPromise;

    expect(events).toEqual([
      'run',
      'error:Distributed cron lock renewal failed for lock-renew-error-task.',
      'after',
    ]);

    await app.close();
  });

  it('logs successful distributed lock renewals and releases for operational tracing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));

    const scheduled = createManualScheduler();
    const loggerEvents: string[] = [];
    const redis = new InMemoryLockRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        distributed: true,
        lockTtlMs: 2_000,
        name: 'lock-trace-task',
      })
      async run() {
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-lock-trace',
            lockTtlMs: 2_000,
          },
          scheduler: scheduled.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    const tickPromise = scheduled.records[0]!.tick();
    await started.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    release.resolve();
    await tickPromise;

    expect(loggerEvents.some((event) => event.includes('log:CronLifecycleService:Renewed distributed cron lock for lock-trace-task.'))).toBe(true);
    expect(loggerEvents.some((event) => event.includes('log:CronLifecycleService:Released distributed cron lock for lock-trace-task.'))).toBe(true);

    await app.close();
  });

  it('awaits in-flight lock renewal attempts before deciding task success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));

    const scheduled = createManualScheduler();
    const firstRenewalResult = createDeferred<number>();
    const redis = new OverlappingRenewalRedisClient(firstRenewalResult);
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: string[] = [];

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        distributed: true,
        lockTtlMs: 2_000,
        name: 'lock-overlap-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
        },
        onSuccess: () => {
          events.push('success');
        },
      })
      async run() {
        events.push('run');
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-lock-overlap',
            lockTtlMs: 2_000,
          },
          scheduler: scheduled.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    const tickPromise = scheduled.records[0]!.tick();
    await started.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    release.resolve();
    firstRenewalResult.resolve(0);
    await tickPromise;

    expect(events).toEqual([
      'run',
      'error:Distributed cron lock ownership lost for lock-overlap-task.',
      'after',
    ]);

    await app.close();
  });

  it('evaluates due lock renewal even when interval callback has not fired yet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));

    const scheduled = createManualScheduler();
    const redis = new LockLossOnRenewRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: string[] = [];

    class DistributedTaskService {
      @Cron(CronExpression.EVERY_SECOND, {
        afterRun: () => {
          events.push('after');
        },
        distributed: true,
        lockTtlMs: 2_000,
        name: 'lock-due-renewal-task',
        onError: (error) => {
          events.push(`error:${error instanceof Error ? error.message : 'unknown'}`);
        },
        onSuccess: () => {
          events.push('success');
        },
      })
      async run() {
        events.push('run');
        started.resolve();
        await release.promise;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'cron-lock-due-renewal',
            lockTtlMs: 2_000,
          },
          scheduler: scheduled.scheduler,
        }),
      ],
      providers: [DistributedTaskService],
    });

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    const tickPromise = scheduled.records[0]!.tick();
    await started.promise;
    vi.setSystemTime(new Date('2026-03-20T00:00:01.000Z'));
    release.resolve();
    await tickPromise;

    expect(events).toEqual([
      'run',
      'error:Distributed cron lock ownership lost for lock-due-renewal-task.',
      'after',
    ]);

    await app.close();
  });

  it('schedules @Interval() and @Timeout() tasks through lifecycle bootstrap', async () => {
    vi.useFakeTimers();

    class TickStore {
      intervalCount = 0;
      timeoutCount = 0;
    }

    @Inject(TickStore)
    class TaskService {
      constructor(private readonly store: TickStore) {}

      @Interval(100)
      onInterval() {
        this.store.intervalCount += 1;
      }

      @Timeout(250)
      onTimeout() {
        this.store.timeoutCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot()],
      providers: [TickStore, TaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const store = await app.container.resolve(TickStore);

    await vi.advanceTimersByTimeAsync(100);
    expect(store.intervalCount).toBe(1);
    expect(store.timeoutCount).toBe(0);

    await vi.advanceTimersByTimeAsync(150);
    expect(store.intervalCount).toBe(2);
    expect(store.timeoutCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.timeoutCount).toBe(1);

    await app.close();
  });

  it('fails bootstrap on duplicate task names across cron/interval/timeout decorators', async () => {
    class DuplicateTaskService {
      @Cron(CronExpression.EVERY_SECOND, { name: 'duplicate-task' })
      cronTask() {}

      @Interval(1_000, { name: 'duplicate-task' })
      intervalTask() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot()],
      providers: [DuplicateTaskService],
    });

    await expect(bootstrapApplication({ rootModule: AppModule })).rejects.toThrow(/Duplicate scheduling task name/i);
  });

  it('exposes scheduling registry runtime controls and rejects updateCronExpression for non-cron tasks', async () => {
    const scheduled = createManualScheduler();
    const events: string[] = [];

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);

    registry.addCron('dynamic-cron', CronExpression.EVERY_SECOND, () => {
      events.push('cron');
    });

    expect(registry.get('dynamic-cron')?.kind).toBe('cron');
    expect(scheduled.records.some((record) => record.options.name === 'dynamic-cron')).toBe(true);

    registry.updateCronExpression('dynamic-cron', CronExpression.EVERY_5_SECONDS);
    expect(registry.get('dynamic-cron')?.expression).toBe(CronExpression.EVERY_5_SECONDS);

    registry.addInterval('dynamic-interval', 1_000, () => {
      events.push('interval');
    });
    registry.addTimeout('dynamic-timeout', 5_000, () => {
      events.push('timeout');
    });

    expect(registry.getAll().map((task: { name: string }) => task.name).sort()).toEqual([
      'dynamic-cron',
      'dynamic-interval',
      'dynamic-timeout',
    ]);

    expect(() => registry.updateCronExpression('dynamic-interval', CronExpression.EVERY_10_SECONDS)).toThrow(
      /supports only cron tasks/i,
    );

    expect(registry.disable('dynamic-cron')).toBe(true);
    expect(registry.get('dynamic-cron')?.enabled).toBe(false);

    expect(registry.enable('dynamic-cron')).toBe(true);
    expect(registry.get('dynamic-cron')?.enabled).toBe(true);

    expect(registry.remove('dynamic-timeout')).toBe(true);
    expect(registry.get('dynamic-timeout')).toBeUndefined();

    await app.close();
  });

  it('keeps timeout definitions in registry after firing and allows re-enable with full delay', async () => {
    vi.useFakeTimers();

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    let count = 0;

    registry.addTimeout('dynamic-once', 500, () => {
      count += 1;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(count).toBe(1);
    expect(registry.get('dynamic-once')?.enabled).toBe(false);

    expect(registry.enable('dynamic-once')).toBe(true);
    await vi.advanceTimersByTimeAsync(499);
    expect(count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(count).toBe(2);
    expect(registry.get('dynamic-once')?.enabled).toBe(false);

    await app.close();
  });

  it('cleans up cron, interval, and timeout schedules during shutdown', async () => {
    vi.useFakeTimers();
    const scheduled = createManualScheduler();

    class TickStore {
      intervalCount = 0;
      timeoutCount = 0;
    }

    @Inject(TickStore)
    class TaskService {
      constructor(private readonly store: TickStore) {}

      @Cron(CronExpression.EVERY_SECOND, { name: 'shutdown-cron' })
      cronTask() {}

      @Interval(100)
      intervalTask() {
        this.store.intervalCount += 1;
      }

      @Timeout(1_000)
      timeoutTask() {
        this.store.timeoutCount += 1;
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot({ scheduler: scheduled.scheduler })],
      providers: [TickStore, TaskService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const store = await app.container.resolve(TickStore);

    await vi.advanceTimersByTimeAsync(100);
    expect(store.intervalCount).toBe(1);

    await app.close();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.intervalCount).toBe(1);
    expect(store.timeoutCount).toBe(0);
    expect(scheduled.records[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('uses distributed lock path for dynamic interval tasks across nodes', async () => {
    vi.useFakeTimers();

    const redis = new InMemoryLockRedisClient();
    const started = createDeferred<void>();
    const release = createDeferred<void>();

    class Store {
      count = 0;
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'dynamic-distributed-interval',
            lockTtlMs: 60_000,
          },
        }),
      ],
      providers: [Store],
    });

    class SecondAppModule {}
    defineModule(SecondAppModule, {
      imports: [
        CronModule.forRoot({
          distributed: {
            enabled: true,
            keyPrefix: 'dynamic-distributed-interval',
            lockTtlMs: 60_000,
          },
        }),
      ],
      providers: [Store],
    });

    const appOne = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const appTwo = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: SecondAppModule,
    });

    const registryOne = await appOne.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const registryTwo = await appTwo.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    const storeOne = await appOne.container.resolve(Store);
    const storeTwo = await appTwo.container.resolve(Store);

    registryOne.addInterval('dynamic-distributed-task', 100, async () => {
      storeOne.count += 1;
      started.resolve();
      await release.promise;
    }, { distributed: true });
    registryTwo.addInterval('dynamic-distributed-task', 100, () => {
      storeTwo.count += 1;
    }, { distributed: true });

    await vi.advanceTimersByTimeAsync(100);
    await started.promise;
    await vi.advanceTimersByTimeAsync(100);
    release.resolve();
    await vi.advanceTimersByTimeAsync(1);

    expect(storeOne.count + storeTwo.count).toBe(1);

    await appOne.close();
    await appTwo.close();
  });

  it('warns and skips @Interval/@Timeout on non-singleton providers', async () => {
    vi.useFakeTimers();

    const loggerEvents: string[] = [];

    class NonSingletonTaskService {
      @Interval(100)
      onInterval() {}

      @Timeout(100)
      onTimeout() {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot()],
      providers: [
        {
          provide: NonSingletonTaskService,
          scope: 'transient',
          useClass: NonSingletonTaskService,
        },
      ],
    });

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      rootModule: AppModule,
    });

    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:CronLifecycleService:NonSingletonTaskService in module AppModule declares scheduling methods (@Cron/@Interval/@Timeout) but is registered with transient scope.',
        ),
      ),
    ).toBe(true);

    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);
    expect(registry.getAll()).toHaveLength(0);

    await app.close();
  });

  it('enforces global duplicate names for dynamic runtime registrations', async () => {
    class AppModule {}
    defineModule(AppModule, {
      imports: [CronModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const registry = await app.container.resolve<SchedulingRegistry>(SCHEDULING_REGISTRY);

    registry.addCron('global-duplicate', CronExpression.EVERY_SECOND, () => {});

    expect(() => registry.addInterval('global-duplicate', 1_000, () => {})).toThrow(/Duplicate scheduling task name/i);
    expect(() => registry.addTimeout('global-duplicate', 1_000, () => {})).toThrow(/Duplicate scheduling task name/i);

    await app.close();
  });

  });
