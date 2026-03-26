import { Inject, fallbackClone } from '@konekti/core';
import type { Container } from '@konekti/di';
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
import {
  collectDiscoveryCandidates,
  normalizePositiveInteger,
  normalizeRateLimiter,
  withTimeout,
  type DiscoveryCandidate,
} from './helpers.js';
import { QUEUE_OPTIONS } from './tokens.js';
import type {
  NormalizedQueueModuleOptions,
  Queue,
  QueueBackoffOptions,
  QueueJobType,
  QueueWorkerDescriptor,
} from './types.js';

type QueuePayload = Record<string, unknown>;
type QueueInstance = BullQueue;
type WorkerInstance = BullWorker;
const DEAD_LETTER_DRAIN_TIMEOUT_MS = 5_000;

type QueueLifecycleState = 'idle' | 'starting' | 'started' | 'stopping' | 'stopped';

type QueueOwnedConnection = ConnectionOptions & {
  connect(): Promise<unknown>;
  disconnect(): void;
  quit(): Promise<unknown>;
  status?: string;
};

interface QueueRedisClient {
  duplicate(): QueueOwnedConnection;
  rpush(key: string, value: string): Promise<unknown>;
}

interface WorkerInitializationResources {
  queue?: QueueInstance;
  queueConnection?: QueueOwnedConnection;
  worker?: WorkerInstance;
  workerConnection?: QueueOwnedConnection;
}

interface InitializedWorkerResources {
  queue: QueueInstance;
  queueConnection: QueueOwnedConnection;
  worker: WorkerInstance;
  workerConnection: QueueOwnedConnection;
}

type QueueWorkerMetadata = NonNullable<ReturnType<typeof getQueueWorkerMetadata>>;

interface ResolvedWorkerHandler {
  handler: (this: unknown, payload: object) => Promise<void>;
  instance: unknown;
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

function cloneQueuePayload(payload: QueuePayload): QueuePayload {
  try {
    return structuredClone(payload);
  } catch {
    return fallbackClone(payload) as QueuePayload;
  }
}

function rehydrateJobPayload<TJob extends object>(jobType: QueueJobType<TJob>, payload: QueuePayload): TJob {
  return Object.assign(Object.create(jobType.prototype), cloneQueuePayload(payload)) as TJob;
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
  private lifecycleState: QueueLifecycleState = 'idle';
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
    if (this.lifecycleState === 'started') {
      return;
    }

    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
      throw new Error(`Queue lifecycle state is ${this.lifecycleState}.`);
    }

    if (!this.startPromise) {
      this.lifecycleState = 'starting';
      this.startPromise = this.startLifecycle();
    }

    try {
      await this.startPromise;
    } catch (error) {
      await this.handleStartupFailure();
      throw error;
    }

    this.startPromise = undefined;
  }

  private async startLifecycle(): Promise<void> {
    const redis = this.getRedisClient();
    this.discoverWorkers();
    await this.initializeWorkers(redis);
    this.lifecycleState = 'started';
  }

  private async handleStartupFailure(): Promise<void> {
    await this.closeInitializedResources();
    this.lifecycleState = 'idle';
    this.startPromise = undefined;
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

      if (this.shouldSkipNonSingletonWorker(candidate)) {
        continue;
      }

      const jobType = metadata.jobType;

      if (this.isDuplicateWorkerRegistration(jobType, candidate.moduleName)) {
        continue;
      }

      const jobName = metadata.options.jobName ?? jobType.name;

      if (this.isDuplicateJobName(jobName, candidate.moduleName, seenJobNames)) {
        continue;
      }

      seenJobNames.add(jobName);
      this.descriptorsByJobType.set(jobType, this.createWorkerDescriptor(candidate, metadata, jobName));
    }
  }

  private shouldSkipNonSingletonWorker(candidate: DiscoveryCandidate): boolean {
    if (candidate.scope === 'singleton') {
      return false;
    }

    this.logger.warn(
      `${candidate.targetType.name} in module ${candidate.moduleName} declares @QueueWorker() but is registered with ${candidate.scope} scope. Queue workers are registered only for singleton providers.`,
      'QueueLifecycleService',
    );
    return true;
  }

  private isDuplicateWorkerRegistration(jobType: QueueJobType, moduleName: string): boolean {
    if (!this.descriptorsByJobType.has(jobType)) {
      return false;
    }

    this.logger.warn(
      `Duplicate @QueueWorker() registration for job type ${jobType.name} was ignored in ${moduleName}.`,
      'QueueLifecycleService',
    );
    return true;
  }

  private isDuplicateJobName(jobName: string, moduleName: string, seenJobNames: Set<string>): boolean {
    if (!seenJobNames.has(jobName)) {
      return false;
    }

    this.logger.warn(
      `Duplicate queue job name ${jobName} was ignored in ${moduleName}.`,
      'QueueLifecycleService',
    );
    return true;
  }

  private createWorkerDescriptor(
    candidate: DiscoveryCandidate,
    metadata: QueueWorkerMetadata,
    jobName: string,
  ): QueueWorkerDescriptor {
    return {
      attempts: normalizePositiveInteger(metadata.options.attempts, this.options.defaultAttempts),
      backoff: metadata.options.backoff ?? this.options.defaultBackoff,
      concurrency: normalizePositiveInteger(metadata.options.concurrency, this.options.defaultConcurrency),
      jobName,
      jobType: metadata.jobType,
      moduleName: candidate.moduleName,
      rateLimiter: normalizeRateLimiter(metadata.options.rateLimiter ?? this.options.defaultRateLimiter),
      token: candidate.token,
      workerName: candidate.targetType.name,
    };
  }

  private discoveryCandidates(): DiscoveryCandidate[] {
    return collectDiscoveryCandidates(this.compiledModules);
  }

  private async initializeWorkers(redis: QueueRedisClient): Promise<void> {
    for (const descriptor of this.descriptorsByJobType.values()) {
      const resources = await this.initializeWorkerResources(redis, descriptor);
      this.registerInitializedWorker(descriptor, resources);
    }
  }

  private async initializeWorkerResources(
    redis: QueueRedisClient,
    descriptor: QueueWorkerDescriptor,
  ): Promise<InitializedWorkerResources> {
    const resources: WorkerInitializationResources = {};

    try {
      resources.queueConnection = await this.createOwnedConnection(redis);
      resources.workerConnection = await this.createOwnedConnection(redis);
      resources.queue = this.createQueueInstance(descriptor, resources.queueConnection);
      resources.worker = this.createWorkerInstance(descriptor, resources.workerConnection);
      this.attachWorkerFailureHandler(descriptor, resources.worker);

      return {
        queue: resources.queue,
        queueConnection: resources.queueConnection,
        worker: resources.worker,
        workerConnection: resources.workerConnection,
      };
    } catch (error) {
      await this.cleanupWorkerInitializationFailure(resources);
      throw error;
    }
  }

  private createQueueInstance(
    descriptor: QueueWorkerDescriptor,
    queueConnection: QueueOwnedConnection,
  ): QueueInstance {
    return new BullQueue(descriptor.jobName, {
      connection: queueConnection,
    });
  }

  private createWorkerInstance(
    descriptor: QueueWorkerDescriptor,
    workerConnection: QueueOwnedConnection,
  ): WorkerInstance {
    return new BullWorker(
      descriptor.jobName,
      async (job: BullJob) => {
        await this.executeWorker(descriptor, job);
      },
      this.createWorkerOptions(descriptor, workerConnection),
    );
  }

  private createWorkerOptions(
    descriptor: QueueWorkerDescriptor,
    workerConnection: QueueOwnedConnection,
  ): {
    concurrency: number;
    connection: ConnectionOptions;
    limiter?: {
      duration: number;
      max: number;
    };
  } {
    return {
      concurrency: descriptor.concurrency,
      connection: workerConnection,
      ...this.createWorkerLimiterOptions(descriptor),
    };
  }

  private createWorkerLimiterOptions(descriptor: QueueWorkerDescriptor): {
    limiter?: {
      duration: number;
      max: number;
    };
  } {
    if (!descriptor.rateLimiter) {
      return {};
    }

    return {
      limiter: {
        duration: descriptor.rateLimiter.duration,
        max: descriptor.rateLimiter.max,
      },
    };
  }

  private attachWorkerFailureHandler(
    descriptor: QueueWorkerDescriptor,
    worker: WorkerInstance,
  ): void {
    worker.on('failed', (job: BullJob | undefined, error: Error) => {
      if (!job || !this.isTerminalFailure(job, descriptor.attempts)) {
        return;
      }

      const pendingWrite = this.handleFailedJob(descriptor, job, error);
      this.pendingDeadLetterWrites.add(pendingWrite);
      pendingWrite.finally(() => {
        this.pendingDeadLetterWrites.delete(pendingWrite);
      });
    });
  }

  private registerInitializedWorker(
    descriptor: QueueWorkerDescriptor,
    resources: InitializedWorkerResources,
  ): void {
    this.queuesByJobName.set(descriptor.jobName, resources.queue);
    this.workersByJobName.set(descriptor.jobName, resources.worker);
    this.ownedConnections.push(resources.queueConnection, resources.workerConnection);
  }

  private async cleanupWorkerInitializationFailure(resources: WorkerInitializationResources): Promise<void> {
    if (resources.worker) {
      await this.tryCloseWorker(resources.worker);
    }

    if (resources.queue) {
      await this.tryCloseQueue(resources.queue);
    }

    if (resources.workerConnection) {
      await this.tryCloseOwnedConnection(resources.workerConnection);
    }

    if (resources.queueConnection) {
      await this.tryCloseOwnedConnection(resources.queueConnection);
    }
  }

  private async createOwnedConnection(redis: QueueRedisClient): Promise<QueueOwnedConnection> {
    const connection = redis.duplicate();

    try {
      if (connection.status === 'wait' || connection.status === 'reconnecting') {
        await connection.connect();
      }
    } catch (error) {
      await this.tryCloseOwnedConnection(connection);
      throw error;
    }

    return connection;
  }

  private async executeWorker(descriptor: QueueWorkerDescriptor, job: BullJob): Promise<void> {
    const resolvedWorker = await this.resolveWorkerHandler(descriptor);
    const rehydratedPayload = this.rehydrateWorkerPayload(descriptor, job);

    await Promise.resolve(resolvedWorker.handler.call(resolvedWorker.instance, rehydratedPayload));
  }

  private async resolveWorkerHandler(descriptor: QueueWorkerDescriptor): Promise<ResolvedWorkerHandler> {
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

    return {
      handler: handler as (this: unknown, payload: object) => Promise<void>,
      instance,
    };
  }

  private rehydrateWorkerPayload(descriptor: QueueWorkerDescriptor, job: BullJob): object {
    if (!isQueuePayload(job.data)) {
      throw new Error(`Queue worker ${descriptor.workerName} received a non-object payload.`);
    }

    return rehydrateJobPayload(descriptor.jobType, job.data);
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
        payload: isQueuePayload(job.data) ? cloneQueuePayload(job.data) : job.data,
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

    if (this.lifecycleState === 'stopped') {
      return;
    }

    this.lifecycleState = 'stopping';

    this.shutdownPromise = (async () => {
      await this.closeInitializedResources();
      await this.drainDeadLetterWrites();
      this.lifecycleState = 'stopped';
      this.startPromise = undefined;
    })();

    await this.shutdownPromise;
  }

  private async closeInitializedResources(): Promise<void> {
    const workers = Array.from(this.workersByJobName.values());
    const queues = Array.from(this.queuesByJobName.values());
    const ownedConnections = this.ownedConnections.splice(0);

    this.workersByJobName.clear();
    this.queuesByJobName.clear();

    for (const worker of workers) {
      await this.tryCloseWorker(worker);
    }

    for (const queue of queues) {
      await this.tryCloseQueue(queue);
    }

    for (const connection of ownedConnections) {
      await this.tryCloseOwnedConnection(connection);
    }
  }

  private async drainDeadLetterWrites(): Promise<void> {
    while (this.pendingDeadLetterWrites.size > 0) {
      await this.drainDeadLetterWriteBatch(Array.from(this.pendingDeadLetterWrites));
    }
  }

  private async drainDeadLetterWriteBatch(writes: readonly Promise<void>[]): Promise<void> {
    await Promise.allSettled(writes.map(async (write) => this.awaitDeadLetterWriteWithTimeout(write)));
  }

  private async awaitDeadLetterWriteWithTimeout(write: Promise<void>): Promise<void> {
    try {
      await withTimeout(write, DEAD_LETTER_DRAIN_TIMEOUT_MS, () => new Error('dead-letter write timed out'));
    } catch (error) {
      this.pendingDeadLetterWrites.delete(write);
      this.logger.error(
        'Dead-letter write did not complete within shutdown timeout.',
        error,
        'QueueLifecycleService',
      );
    }
  }

  private async tryCloseWorker(worker: WorkerInstance): Promise<void> {
    try {
      await worker.close();
    } catch (error) {
      this.logger.error('Failed to close queue worker during shutdown.', error, 'QueueLifecycleService');
    }
  }

  private async tryCloseQueue(queue: QueueInstance): Promise<void> {
    try {
      await queue.close();
    } catch (error) {
      this.logger.error('Failed to close queue during shutdown.', error, 'QueueLifecycleService');
    }
  }

  private async tryCloseOwnedConnection(connection: QueueOwnedConnection): Promise<void> {
    try {
      await closeConnection(connection);
    } catch (error) {
      this.logger.error('Failed to close queue-owned Redis connection during shutdown.', error, 'QueueLifecycleService');
    }
  }
}
