import { Inject, getClassDiMetadata, type Token } from '@konekti/core';
import type { Container, Provider } from '@konekti/di';
import { REDIS_CLIENT } from '@konekti/redis';
import {
  APPLICATION_LOGGER,
  COMPILED_MODULES,
  RUNTIME_CONTAINER,
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@konekti/runtime';
import { Queue as BullQueue, Worker as BullWorker, type ConnectionOptions, type JobsOptions, type Job as BullJob } from 'bullmq';

import { getQueueWorkerMetadata } from './metadata.js';
import { QUEUE_OPTIONS } from './tokens.js';
import type {
  NormalizedQueueModuleOptions,
  Queue,
  QueueBackoffOptions,
  QueueJobType,
  QueueRateLimiterOptions,
  QueueWorkerDescriptor,
} from './types.js';

type Scope = 'request' | 'singleton' | 'transient';
type QueuePayload = Record<string, unknown>;
type QueueInstance = BullQueue;
type WorkerInstance = BullWorker;

interface DiscoveryCandidate {
  moduleName: string;
  scope: Scope;
  targetType: Function;
  token: Token;
}

interface QueueOwnedConnection {
  connect(): Promise<unknown>;
  disconnect(): void;
  quit(): Promise<unknown>;
  status?: string;
}

interface QueueRedisClient {
  duplicate(): QueueOwnedConnection;
  rpush(key: string, value: string): Promise<unknown>;
}

function scopeFromProvider(provider: Provider): Scope {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);

  if (normalized < 1) {
    return fallback;
  }

  return normalized;
}

function hasQueueRedisClient(value: unknown): value is QueueRedisClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const client = value as { duplicate?: unknown; rpush?: unknown };

  return typeof client.duplicate === 'function' && typeof client.rpush === 'function';
}

function isQueuePayload(value: unknown): value is QueuePayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeJobPayload(job: object): QueuePayload {
  const serialized = JSON.parse(JSON.stringify(job)) as unknown;

  if (!isQueuePayload(serialized)) {
    throw new Error('Queue payload must be a plain object after JSON serialization.');
  }

  return serialized;
}

function rehydrateJobPayload<TJob extends object>(jobType: QueueJobType<TJob>, payload: QueuePayload): TJob {
  return Object.assign(Object.create(jobType.prototype), payload) as TJob;
}

function toBullBackoff(backoff: QueueBackoffOptions | undefined): JobsOptions['backoff'] {
  if (!backoff) {
    return undefined;
  }

  return {
    delay: normalizePositiveInteger(backoff.delayMs, 1_000),
    type: backoff.type ?? 'fixed',
  };
}

function deadLetterKey(jobName: string): string {
  return `konekti:queue:dead-letter:${jobName}`;
}

function normalizeRateLimiter(rateLimiter: QueueRateLimiterOptions | undefined): QueueRateLimiterOptions | undefined {
  if (!rateLimiter) {
    return undefined;
  }

  return {
    duration: normalizePositiveInteger(rateLimiter.duration, 1_000),
    max: normalizePositiveInteger(rateLimiter.max, 1),
  };
}

async function closeConnection(connection: QueueOwnedConnection): Promise<void> {
  if (connection.status === 'end') {
    return;
  }

  try {
    await connection.quit();
  } catch (error) {
    connection.disconnect();

    if (connection.status !== 'end') {
      throw error;
    }
  }
}

@Inject([QUEUE_OPTIONS, REDIS_CLIENT, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class QueueLifecycleService implements Queue, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
  private readonly descriptorsByJobType = new Map<QueueJobType, QueueWorkerDescriptor>();
  private readonly queuesByJobName = new Map<string, QueueInstance>();
  private readonly workersByJobName = new Map<string, WorkerInstance>();
  private readonly ownedConnections: QueueOwnedConnection[] = [];
  private readonly pendingDeadLetterWrites = new Set<Promise<void>>();
  private started = false;
  private startPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly options: NormalizedQueueModuleOptions,
    private readonly redisClient: unknown,
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureStarted();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  async enqueue<TJob extends object>(job: TJob): Promise<string> {
    await this.ensureStarted();

    const descriptor = this.descriptorsByJobType.get(job.constructor as QueueJobType);

    if (!descriptor) {
      throw new Error(`No @QueueWorker() registered for job type ${job.constructor.name}.`);
    }

    const queue = this.queuesByJobName.get(descriptor.jobName);

    if (!queue) {
      throw new Error(`Queue ${descriptor.jobName} is not initialized.`);
    }

    const queuedJob = await queue.add(descriptor.jobName, serializeJobPayload(job), {
      attempts: descriptor.attempts,
      backoff: toBullBackoff(descriptor.backoff),
    });

    return queuedJob.id ?? '';
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }

    if (!this.startPromise) {
      this.startPromise = (async () => {
        const redis = this.getRedisClient();
        this.discoverWorkers();
        await this.initializeWorkers(redis);
        this.started = true;
      })();
    }

    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = undefined;
      throw error;
    }
  }

  private getRedisClient(): QueueRedisClient {
    if (!hasQueueRedisClient(this.redisClient)) {
      throw new Error('@konekti/queue requires REDIS_CLIENT with duplicate() and rpush() methods.');
    }

    return this.redisClient;
  }

  private discoverWorkers(): void {
    this.descriptorsByJobType.clear();
    const seenJobNames = new Set<string>();

    for (const candidate of this.discoveryCandidates()) {
      const metadata = getQueueWorkerMetadata(candidate.targetType);

      if (!metadata) {
        continue;
      }

      if (candidate.scope !== 'singleton') {
        this.logger.warn(
          `${candidate.targetType.name} in module ${candidate.moduleName} declares @QueueWorker() but is registered with ${candidate.scope} scope. Queue workers are registered only for singleton providers.`,
          'QueueLifecycleService',
        );
        continue;
      }

      const jobType = metadata.jobType;

      if (this.descriptorsByJobType.has(jobType)) {
        this.logger.warn(
          `Duplicate @QueueWorker() registration for job type ${jobType.name} was ignored in ${candidate.moduleName}.`,
          'QueueLifecycleService',
        );
        continue;
      }

      const jobName = metadata.options.jobName ?? jobType.name;

      if (seenJobNames.has(jobName)) {
        this.logger.warn(
          `Duplicate queue job name ${jobName} was ignored in ${candidate.moduleName}.`,
          'QueueLifecycleService',
        );
        continue;
      }

      seenJobNames.add(jobName);
      this.descriptorsByJobType.set(jobType, {
        attempts: normalizePositiveInteger(metadata.options.attempts, this.options.defaultAttempts),
        backoff: metadata.options.backoff ?? this.options.defaultBackoff,
        concurrency: normalizePositiveInteger(metadata.options.concurrency, this.options.defaultConcurrency),
        jobName,
        jobType,
        moduleName: candidate.moduleName,
        rateLimiter: normalizeRateLimiter(metadata.options.rateLimiter ?? this.options.defaultRateLimiter),
        token: candidate.token,
        workerName: candidate.targetType.name,
      });
    }
  }

  private discoveryCandidates(): DiscoveryCandidate[] {
    const candidates: DiscoveryCandidate[] = [];

    for (const compiledModule of this.compiledModules) {
      for (const provider of compiledModule.definition.providers ?? []) {
        if (typeof provider === 'function') {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider,
            token: provider,
          });
          continue;
        }

        if (isClassProvider(provider)) {
          candidates.push({
            moduleName: compiledModule.type.name,
            scope: scopeFromProvider(provider),
            targetType: provider.useClass,
            token: provider.provide,
          });
        }
      }

      for (const controller of compiledModule.definition.controllers ?? []) {
        candidates.push({
          moduleName: compiledModule.type.name,
          scope: scopeFromProvider(controller),
          targetType: controller,
          token: controller,
        });
      }
    }

    return candidates;
  }

  private async initializeWorkers(redis: QueueRedisClient): Promise<void> {
    for (const descriptor of this.descriptorsByJobType.values()) {
      const queueConnection = await this.createOwnedConnection(redis);
      const workerConnection = await this.createOwnedConnection(redis);
      const queue = new BullQueue(descriptor.jobName, {
        connection: queueConnection as unknown as ConnectionOptions,
      });
      const worker = new BullWorker(
        descriptor.jobName,
        async (job: BullJob) => {
          await this.executeWorker(descriptor, job);
        },
        {
          concurrency: descriptor.concurrency,
          connection: workerConnection as unknown as ConnectionOptions,
          ...(descriptor.rateLimiter
            ? {
                limiter: {
                  duration: descriptor.rateLimiter.duration,
                  max: descriptor.rateLimiter.max,
                },
              }
            : {}),
        },
      );

      worker.on('failed', (job: BullJob | undefined, error: Error) => {
        const pendingWrite = this.handleFailedJob(descriptor, job, error);
        this.pendingDeadLetterWrites.add(pendingWrite);
        pendingWrite.finally(() => {
          this.pendingDeadLetterWrites.delete(pendingWrite);
        });
      });

      this.queuesByJobName.set(descriptor.jobName, queue);
      this.workersByJobName.set(descriptor.jobName, worker);
    }
  }

  private async createOwnedConnection(redis: QueueRedisClient): Promise<QueueOwnedConnection> {
    const connection = redis.duplicate();
    this.ownedConnections.push(connection);

    if (connection.status === 'wait' || connection.status === 'reconnecting') {
      await connection.connect();
    }

    return connection;
  }

  private async executeWorker(descriptor: QueueWorkerDescriptor, job: BullJob): Promise<void> {
    let instance: unknown;

    try {
      instance = await this.runtimeContainer.resolve(descriptor.token);
    } catch (error) {
      throw new Error(
        `Failed to resolve queue worker ${descriptor.workerName} from module ${descriptor.moduleName}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    const handler = (instance as { handle?: unknown }).handle;

    if (typeof handler !== 'function') {
      throw new Error(`Queue worker ${descriptor.workerName} must implement handle(job).`);
    }

    if (!isQueuePayload(job.data)) {
      throw new Error(`Queue worker ${descriptor.workerName} received a non-object payload.`);
    }

    const rehydrated = rehydrateJobPayload(descriptor.jobType, job.data);

    await Promise.resolve((handler as (this: unknown, payload: object) => Promise<void>).call(instance, rehydrated));
  }

  private async handleFailedJob(
    descriptor: QueueWorkerDescriptor,
    job: BullJob | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    if (!this.isTerminalFailure(job, descriptor.attempts)) {
      return;
    }

    try {
      const deadLetter = {
        attemptsMade: job.attemptsMade,
        errorMessage: error.message,
        failedAt: new Date(job.finishedOn ?? Date.now()).toISOString(),
        jobId: job.id ?? '',
        jobName: descriptor.jobName,
        payload: job.data,
      };

      await this.getRedisClient().rpush(deadLetterKey(descriptor.jobName), JSON.stringify(deadLetter));
    } catch (deadLetterError) {
      this.logger.error(
        `Failed to append dead-letter record for queue job ${descriptor.jobName}.`,
        deadLetterError,
        'QueueLifecycleService',
      );
    }
  }

  private isTerminalFailure(job: BullJob, attemptsFallback: number): boolean {
    const configuredAttempts =
      typeof job.opts.attempts === 'number' && Number.isFinite(job.opts.attempts)
        ? normalizePositiveInteger(job.opts.attempts, attemptsFallback)
        : attemptsFallback;

    return job.attemptsMade >= configuredAttempts;
  }

  private async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
      return;
    }

    this.shutdownPromise = (async () => {
      const workers = Array.from(this.workersByJobName.values());
      this.workersByJobName.clear();

      for (const worker of workers) {
        try {
          await worker.close();
        } catch (error) {
          this.logger.error('Failed to close queue worker during shutdown.', error, 'QueueLifecycleService');
        }
      }

      const queues = Array.from(this.queuesByJobName.values());
      this.queuesByJobName.clear();

      for (const queue of queues) {
        try {
          await queue.close();
        } catch (error) {
          this.logger.error('Failed to close queue during shutdown.', error, 'QueueLifecycleService');
        }
      }

      const DEAD_LETTER_DRAIN_TIMEOUT_MS = 5_000;

      while (this.pendingDeadLetterWrites.size > 0) {
        const writes = Array.from(this.pendingDeadLetterWrites).map((write) =>
          Promise.race([
            write,
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(new Error('dead-letter write timed out')),
                DEAD_LETTER_DRAIN_TIMEOUT_MS,
              ),
            ),
          ]).catch((error) => {
            this.logger.error(
              'Dead-letter write did not complete within shutdown timeout.',
              error,
              'QueueLifecycleService',
            );
          }),
        );

        await Promise.allSettled(writes);
      }

      const ownedConnections = this.ownedConnections.splice(0);

      for (const connection of ownedConnections) {
        try {
          await closeConnection(connection);
        } catch (error) {
          this.logger.error('Failed to close queue-owned Redis connection during shutdown.', error, 'QueueLifecycleService');
        }
      }
    })();

    await this.shutdownPromise;
  }
}
