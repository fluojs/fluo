import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inject, Scope } from '@konekti/core';
import { defineControllerMetadata } from '@konekti/core/internal';
import { REDIS_CLIENT } from '@konekti/redis';
import { bootstrapApplication, defineModule, type ApplicationLogger } from '@konekti/runtime';

interface MockQueueConnection {
  closeCalls: number;
  connection: MockRedisConnection;
  name: string;
}

interface MockQueueJob {
  attemptsMade: number;
  data: Record<string, unknown>;
  id?: string;
  opts: {
    attempts?: number;
    backoff?: { delay?: number; type?: 'fixed' | 'exponential' };
  };
}

interface MockRedisConnection {
  connect: () => Promise<void>;
  disconnect: () => void;
  id: string;
  quit: () => Promise<'OK'>;
  status: string;
}

type FailedListener = (job: MockQueueJob | undefined, error: Error) => void

const bullmqState = vi.hoisted(() => {
  const queues = new Map<string, { closeCalls: number; jobs: MockQueueJob[]; name: string }>();
  const workers = new Map<
    string,
    {
      active: Set<Promise<void>>;
      closeCalls: number;
      closed: boolean;
      failedListeners: FailedListener[];
      failures: number;
      name: string;
      processor: (job: MockQueueJob) => Promise<unknown>;
      workerOpts: { concurrency?: number; limiter?: { duration: number; max: number } };
    }
  >();

  let sequence = 0;
  const failQueueCreation = new Set<string>();
  const failWorkerCreation = new Set<string>();

  function attemptsFor(job: MockQueueJob): number {
    if (typeof job.opts.attempts === 'number' && Number.isFinite(job.opts.attempts) && job.opts.attempts > 0) {
      return Math.trunc(job.opts.attempts);
    }

    return 1;
  }

  async function dispatch(name: string, job: MockQueueJob): Promise<void> {
    const worker = workers.get(name);

    if (!worker || worker.closed) {
      return;
    }

    const run = (async () => {
      while (true) {
        try {
          await worker.processor(job);
          return;
        } catch (error) {
          worker.failures += 1;
          job.attemptsMade += 1;

          if (job.attemptsMade < attemptsFor(job)) {
            continue;
          }

          const failure = error instanceof Error ? error : new Error('job failed');

          for (const listener of worker.failedListeners) {
            listener(job, failure);
          }

          return;
        }
      }
    })();

    worker.active.add(run);

    try {
      await run;
    } finally {
      worker.active.delete(run);
    }
  }

  return {
    clear() {
      queues.clear();
      workers.clear();
      failQueueCreation.clear();
      failWorkerCreation.clear();
      sequence = 0;
    },
    createQueue(name: string) {
      const queue = { closeCalls: 0, jobs: [] as MockQueueJob[], name };
      queues.set(name, queue);
      return queue;
    },
    createWorker(
      name: string,
      processor: (job: MockQueueJob) => Promise<unknown>,
      workerOpts: { concurrency?: number; limiter?: { duration: number; max: number } },
    ) {
      const worker = {
        active: new Set<Promise<void>>(),
        closeCalls: 0,
        closed: false,
        failedListeners: [] as FailedListener[],
        failures: 0,
        name,
        processor,
        workerOpts,
      };

      workers.set(name, worker);
      return worker;
    },
    describeQueues(): MockQueueConnection[] {
      return Array.from(queues.values()).map((queue) => ({
        closeCalls: queue.closeCalls,
        connection: { connect: async () => undefined, disconnect: () => undefined, id: '', quit: async () => 'OK', status: 'ready' },
        name: queue.name,
      }));
    },
    nextId() {
      sequence += 1;
      return String(sequence);
    },
    failQueueCreation,
    failWorkerCreation,
    queues,
    workers,
    async dispatch(name: string, job: MockQueueJob) {
      await dispatch(name, job);
    },
  };
});

vi.mock('bullmq', () => ({
  Queue: class MockBullQueue {
    private readonly queue;

    constructor(private readonly name: string, _options: { connection: MockRedisConnection }) {
      if (bullmqState.failQueueCreation.has(name)) {
        throw new Error(`queue construct fail:${name}`);
      }

      this.queue = bullmqState.createQueue(name);
    }

    async add(_jobName: string, data: Record<string, unknown>, opts: MockQueueJob['opts'] = {}): Promise<{ id: string }> {
      const job: MockQueueJob = {
        attemptsMade: 0,
        data,
        id: bullmqState.nextId(),
        opts,
      };

      this.queue.jobs.push(job);
      await bullmqState.dispatch(this.name, job);

      return { id: job.id ?? '' };
    }

    async close(): Promise<void> {
      this.queue.closeCalls += 1;
    }
  },
  Worker: class MockBullWorker {
    private readonly worker;

    constructor(
      name: string,
      processor: (job: MockQueueJob) => Promise<unknown>,
      options: {
        concurrency?: number;
        connection: MockRedisConnection;
        limiter?: { duration: number; max: number };
      },
    ) {
      if (bullmqState.failWorkerCreation.has(name)) {
        throw new Error(`worker construct fail:${name}`);
      }

      this.worker = bullmqState.createWorker(name, processor, options);
    }

    on(event: string, listener: FailedListener): this {
      if (event === 'failed') {
        this.worker.failedListeners.push(listener);
      }

      return this;
    }

    async close(): Promise<void> {
      if (this.worker.closed) {
        return;
      }

      this.worker.closeCalls += 1;
      this.worker.closed = true;
      await Promise.allSettled(Array.from(this.worker.active));
    }
  },
}));

import { QueueWorker } from './decorators.js';
import { getQueueWorkerMetadata } from './metadata.js';
import { QueueModule } from './module.js';
import { QueueLifecycleService } from './service.js';
import { QUEUE } from './tokens.js';
import type { Queue } from './types.js';

class MockRedisClient {
  private duplicateSequence = 0;
  failConnectOnDuplicate: number | undefined;

  readonly deadLetters = new Map<string, string[]>();
  readonly duplicates: MockRedisConnection[] = [];

  duplicate(): MockRedisConnection {
    this.duplicateSequence += 1;
    const id = `dup-${this.duplicateSequence}`;
    const duplicateIndex = this.duplicateSequence;
    const connection: MockRedisConnection = {
      connect: async () => {
        if (this.failConnectOnDuplicate === duplicateIndex) {
          throw new Error(`connect fail:${id}`);
        }

        connection.status = 'ready';
      },
      disconnect: () => {
        connection.status = 'end';
      },
      id,
      quit: async () => {
        connection.status = 'end';
        return 'OK';
      },
      status: 'wait',
    };

    this.duplicates.push(connection);

    return connection;
  }

  async rpush(key: string, value: string): Promise<number> {
    const entries = this.deadLetters.get(key) ?? [];
    entries.push(value);
    this.deadLetters.set(key, entries);
    return entries.length;
  }
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

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, reject, resolve };
}

describe('@konekti/queue', () => {
  beforeEach(() => {
    bullmqState.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes queue worker metadata from @QueueWorker() using standard decorators', () => {
    class WelcomeJob {
      constructor(public readonly userId: string) {}
    }

    @QueueWorker(WelcomeJob, { attempts: 3, concurrency: 5, jobName: 'welcome-job' })
    class WelcomeWorker {
      async handle(_job: WelcomeJob): Promise<void> {}
    }

    expect(getQueueWorkerMetadata(WelcomeWorker)).toEqual({
      jobType: WelcomeJob,
      options: {
        attempts: 3,
        concurrency: 5,
        jobName: 'welcome-job',
      },
    });
  });

  it('resolves QueueLifecycleService directly and keeps QUEUE as a compatibility alias', async () => {
    const redis = new MockRedisClient();

    class RedisTestModule {}
    defineModule(RedisTestModule, {
      exports: [REDIS_CLIENT],
      global: true,
      providers: [
        {
          provide: REDIS_CLIENT,
          useValue: redis,
        },
      ],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [RedisTestModule, QueueModule.forRoot()],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const queueByClass = await app.container.resolve(QueueLifecycleService);
    const queueByToken = await app.container.resolve<Queue>(QUEUE);

    expect(queueByClass).toBeInstanceOf(QueueLifecycleService);
    expect(typeof queueByToken.enqueue).toBe('function');

    await app.close();
  });

  it('discovers queue workers across imported modules and rehydrates job prototypes before handle(job)', async () => {
    class SendWelcomeEmailJob {
      constructor(public readonly userId: string) {}

      subject(): string {
        return `welcome:${this.userId}`;
      }
    }

    class WorkerStore {
      isPrototypeRehydrated = false;
      subject = '';
    }

    @Inject(WorkerStore)
    @QueueWorker(SendWelcomeEmailJob)
    class SendWelcomeEmailWorker {
      constructor(private readonly store: WorkerStore) {}

      async handle(job: SendWelcomeEmailJob): Promise<void> {
        this.store.isPrototypeRehydrated = job instanceof SendWelcomeEmailJob;
        this.store.subject = job.subject();
      }
    }

    @Inject(QUEUE)
    class UserService {
      constructor(private readonly queue: Queue) {}

      async register(userId: string): Promise<string> {
        return this.queue.enqueue(new SendWelcomeEmailJob(userId));
      }
    }

    class FeatureModule {}
    defineModule(FeatureModule, {
      providers: [WorkerStore, SendWelcomeEmailWorker],
    });

    class AppModule {}
    defineModule(AppModule, {
      imports: [FeatureModule, QueueModule.forRoot()],
      providers: [UserService],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const userService = await app.container.resolve(UserService);
    const workerStore = await app.container.resolve(WorkerStore);

    const jobId = await userService.register('user-1');

    expect(jobId).toBe('1');
    expect(workerStore.isPrototypeRehydrated).toBe(true);
    expect(workerStore.subject).toBe('welcome:user-1');

    await app.close();
  });

  it('warns and skips @QueueWorker() classes registered with non-singleton scopes', async () => {
    const loggerEvents: string[] = [];

    class ScopedJob {
      constructor(public readonly id: string) {}
    }

    @Scope('transient')
    @QueueWorker(ScopedJob)
    class TransientWorker {
      async handle(_job: ScopedJob): Promise<void> {}
    }

    @Scope('request')
    @QueueWorker(ScopedJob, { jobName: 'request-worker' })
    class RequestControllerWorker {
      async handle(_job: ScopedJob): Promise<void> {}
    }

    defineControllerMetadata(RequestControllerWorker, { basePath: '/queue-scope-test' });

    class AppModule {}
    defineModule(AppModule, {
      controllers: [RequestControllerWorker],
      imports: [QueueModule.forRoot()],
      providers: [TransientWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const queue = await app.container.resolve<Queue>(QUEUE);

    await expect(queue.enqueue(new ScopedJob('x'))).rejects.toThrow('No @QueueWorker() registered for job type ScopedJob.');
    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:QueueLifecycleService:TransientWorker in module AppModule declares @QueueWorker() but is registered with transient scope.',
        ),
      ),
    ).toBe(true);
    expect(
      loggerEvents.some((event) =>
        event.includes(
          'warn:QueueLifecycleService:RequestControllerWorker in module AppModule declares @QueueWorker() but is registered with request scope.',
        ),
      ),
    ).toBe(true);

    await app.close();
  });

  it('uses decorator attempts/backoff and writes dead-letter records on terminal failure', async () => {
    const loggerEvents: string[] = [];

    class FailingJob {
      constructor(public readonly target: string) {}
    }

    @QueueWorker(FailingJob, {
      attempts: 2,
      backoff: { delayMs: 250, type: 'exponential' },
      jobName: 'failing-job',
    })
    class FailingWorker {
      async handle(_job: FailingJob): Promise<void> {
        throw new Error('failed on purpose');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot({ defaultAttempts: 5, defaultConcurrency: 4 })],
      providers: [FailingWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const queue = await app.container.resolve<Queue>(QUEUE);

    const jobId = await queue.enqueue(new FailingJob('invoice-1'));

    expect(jobId).toBe('1');
    const queueJobs = bullmqState.queues.get('failing-job')?.jobs ?? [];

    expect(queueJobs).toHaveLength(1);
    expect(queueJobs[0]?.opts.attempts).toBe(2);
    expect(queueJobs[0]?.opts.backoff).toEqual({
      delay: 250,
      type: 'exponential',
    });
    expect(bullmqState.workers.get('failing-job')?.failures).toBe(2);

    const deadLetters = redis.deadLetters.get('konekti:queue:dead-letter:failing-job') ?? [];

    expect(deadLetters).toHaveLength(1);
    expect(JSON.parse(deadLetters[0]!)).toMatchObject({
      attemptsMade: 2,
      errorMessage: 'failed on purpose',
      jobId: '1',
      jobName: 'failing-job',
      payload: { target: 'invoice-1' },
    });
    expect(loggerEvents.some((event) => event.includes('Failed to append dead-letter record'))).toBe(false);

    await app.close();
  });

  it('keeps dead-letter payload immutable when worker mutates nested payload fields', async () => {
    class MutableFailingJob {
      constructor(public readonly meta: { role: string }) {}
    }

    @QueueWorker(MutableFailingJob, {
      attempts: 1,
      jobName: 'mutable-failing-job',
    })
    class MutableFailingWorker {
      async handle(job: MutableFailingJob): Promise<void> {
        job.meta.role = 'mutated';
        throw new Error('mutated and failed');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [MutableFailingWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const queue = await app.container.resolve<Queue>(QUEUE);

    await queue.enqueue(new MutableFailingJob({ role: 'original' }));

    const deadLetters = redis.deadLetters.get('konekti:queue:dead-letter:mutable-failing-job') ?? [];
    expect(deadLetters).toHaveLength(1);
    expect(JSON.parse(deadLetters[0]!)).toMatchObject({
      payload: {
        meta: {
          role: 'original',
        },
      },
    });

    await app.close();
  });

  it('allows enqueue during another provider onApplicationBootstrap', async () => {
    class BootstrapJob {
      constructor(public readonly value: string) {}
    }

    class WorkerStore {
      received: string[] = [];
    }

    @Inject(WorkerStore)
    @QueueWorker(BootstrapJob)
    class BootstrapWorker {
      constructor(private readonly store: WorkerStore) {}

      async handle(job: BootstrapJob): Promise<void> {
        this.store.received.push(job.value);
      }
    }

    @Inject(QUEUE)
    class BootstrapPublisher {
      constructor(private readonly queue: Queue) {}

      async onApplicationBootstrap(): Promise<void> {
        await this.queue.enqueue(new BootstrapJob('bootstrapped'));
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [WorkerStore, BootstrapWorker, BootstrapPublisher],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const workerStore = await app.container.resolve(WorkerStore);

    expect(workerStore.received).toEqual(['bootstrapped']);

    await app.close();
  });

  it('waits for dead-letter writes that begin during shutdown', async () => {
    const releaseDeadLetter = createDeferred<void>();

    class ShutdownFailingJob {
      constructor(public readonly id: string) {}
    }

    @QueueWorker(ShutdownFailingJob, { attempts: 1, jobName: 'shutdown-failing-job' })
    class ShutdownFailingWorker {
      async handle(_job: ShutdownFailingJob): Promise<void> {
        throw new Error('shutdown failure');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [ShutdownFailingWorker],
    });

    const redis = new MockRedisClient();
    const originalRpush = redis.rpush.bind(redis);
    let unblockDeadLetter = false;
    redis.rpush = async (key: string, value: string): Promise<number> => {
      if (!unblockDeadLetter) {
        await releaseDeadLetter.promise;
      }

      return originalRpush(key, value);
    };

    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const queue = await app.container.resolve<Queue>(QUEUE);

    const enqueuePromise = queue.enqueue(new ShutdownFailingJob('job-1'));
    await Promise.resolve();

    const closePromise = app.close();
    await Promise.resolve();

    unblockDeadLetter = true;
    releaseDeadLetter.resolve();

    await enqueuePromise;
    await closePromise;

    const deadLetters = redis.deadLetters.get('konekti:queue:dead-letter:shutdown-failing-job') ?? [];
    expect(deadLetters).toHaveLength(1);
  });

  it('rolls back partially initialized workers, queues, and connections when startup fails', async () => {
    class StartupFirstJob {
      constructor(public readonly id: string) {}
    }

    class StartupSecondJob {
      constructor(public readonly id: string) {}
    }

    @QueueWorker(StartupFirstJob)
    class StartupFirstWorker {
      async handle(_job: StartupFirstJob): Promise<void> {}
    }

    @QueueWorker(StartupSecondJob)
    class StartupSecondWorker {
      async handle(_job: StartupSecondJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [StartupFirstWorker, StartupSecondWorker],
    });

    bullmqState.failWorkerCreation.add('StartupSecondJob');

    const redis = new MockRedisClient();

    await expect(
      bootstrapApplication({
        providers: [{ provide: REDIS_CLIENT, useValue: redis }],
        rootModule: AppModule,
      }),
    ).rejects.toThrow('worker construct fail:StartupSecondJob');

    expect(bullmqState.queues.get('StartupFirstJob')?.closeCalls).toBe(1);
    expect(bullmqState.workers.get('StartupFirstJob')?.closeCalls).toBe(1);
    expect(redis.duplicates.length).toBe(4);
    expect(redis.duplicates.every((connection) => connection.status === 'end')).toBe(true);
  });

  it('returns deterministic state-aware errors for enqueue after shutdown', async () => {
    class ShutdownStateJob {
      constructor(public readonly value: string) {}
    }

    @QueueWorker(ShutdownStateJob)
    class ShutdownStateWorker {
      async handle(_job: ShutdownStateJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [ShutdownStateWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    const queue = await app.container.resolve<Queue>(QUEUE);

    await app.close();

    await expect(queue.enqueue(new ShutdownStateJob('x'))).rejects.toThrow('Queue lifecycle state is stopped.');
  });

  it('times out dead-letter drain writes during shutdown and logs once', async () => {
    vi.useFakeTimers();
    const loggerEvents: string[] = [];

    class TimeoutFailingJob {
      constructor(public readonly id: string) {}
    }

    @QueueWorker(TimeoutFailingJob, { attempts: 1, jobName: 'timeout-failing-job' })
    class TimeoutFailingWorker {
      async handle(_job: TimeoutFailingJob): Promise<void> {
        throw new Error('timeout failure');
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [TimeoutFailingWorker],
    });

    const redis = new MockRedisClient();
    redis.rpush = () => new Promise<number>(() => undefined);

    const app = await bootstrapApplication({
      logger: createLogger(loggerEvents),
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const queue = await app.container.resolve<Queue>(QUEUE);

    await queue.enqueue(new TimeoutFailingJob('job-1'));

    const closePromise = app.close();
    await vi.advanceTimersByTimeAsync(5_000);
    await closePromise;

    expect(
      loggerEvents.filter((event) =>
        event.includes('error:QueueLifecycleService:Dead-letter write did not complete within shutdown timeout.'),
      ),
    ).toHaveLength(1);
  });

  it('passes rate limiter options from @QueueWorker() to Bull worker configuration', async () => {
    class RateLimitedJob {
      constructor(public readonly value: string) {}
    }

    @QueueWorker(RateLimitedJob, { rateLimiter: { duration: 1_000, max: 10 } })
    class RateLimitedWorker {
      async handle(_job: RateLimitedJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [RateLimitedWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    await app.container.resolve<Queue>(QUEUE);

    const worker = bullmqState.workers.get('RateLimitedJob');
    expect(worker?.workerOpts.limiter).toEqual({
      duration: 1_000,
      max: 10,
    });

    await app.close();
  });

  it('normalizes invalid decorator rate limiter values before creating Bull worker', async () => {
    class InvalidRateLimitedJob {
      constructor(public readonly value: string) {}
    }

    @QueueWorker(InvalidRateLimitedJob, { rateLimiter: { duration: -500, max: 0 } })
    class InvalidRateLimitedWorker {
      async handle(_job: InvalidRateLimitedJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot()],
      providers: [InvalidRateLimitedWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    await app.container.resolve<Queue>(QUEUE);

    const worker = bullmqState.workers.get('InvalidRateLimitedJob');
    expect(worker?.workerOpts.limiter).toEqual({
      duration: 1_000,
      max: 1,
    });

    await app.close();
  });

  it('normalizes invalid module defaultRateLimiter values before creating Bull worker', async () => {
    class DefaultRateLimitedJob {
      constructor(public readonly value: string) {}
    }

    @QueueWorker(DefaultRateLimitedJob)
    class DefaultRateLimitedWorker {
      async handle(_job: DefaultRateLimitedJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [QueueModule.forRoot({ defaultRateLimiter: { duration: Number.NaN, max: -3 } })],
      providers: [DefaultRateLimitedWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });

    await app.container.resolve<Queue>(QUEUE);

    const worker = bullmqState.workers.get('DefaultRateLimitedJob');
    expect(worker?.workerOpts.limiter).toEqual({
      duration: 1_000,
      max: 1,
    });

    await app.close();
  });

  it('applies module defaults for attempts/concurrency and shuts down idempotently', async () => {
    class DefaultedJob {
      constructor(public readonly value: string) {}
    }

    @QueueWorker(DefaultedJob)
    class DefaultedWorker {
      async handle(_job: DefaultedJob): Promise<void> {}
    }

    class AppModule {}
    defineModule(AppModule, {
      imports: [
        QueueModule.forRoot({
          defaultAttempts: 4,
          defaultBackoff: { delayMs: 600, type: 'fixed' },
          defaultConcurrency: 3,
        }),
      ],
      providers: [DefaultedWorker],
    });

    const redis = new MockRedisClient();
    const app = await bootstrapApplication({
      providers: [{ provide: REDIS_CLIENT, useValue: redis }],
      rootModule: AppModule,
    });
    const queue = await app.container.resolve<Queue>(QUEUE);

    await queue.enqueue(new DefaultedJob('ok'));

    const worker = bullmqState.workers.get('DefaultedJob');
    const queueJobs = bullmqState.queues.get('DefaultedJob')?.jobs ?? [];

    expect(worker?.workerOpts.concurrency).toBe(3);
    expect(queueJobs[0]?.opts.attempts).toBe(4);
    expect(queueJobs[0]?.opts.backoff).toEqual({
      delay: 600,
      type: 'fixed',
    });

    await app.close();

    expect(worker?.closeCalls).toBe(1);
    expect(bullmqState.queues.get('DefaultedJob')?.closeCalls).toBe(1);
    expect(redis.duplicates.every((connection) => connection.status === 'end')).toBe(true);
  });
});
