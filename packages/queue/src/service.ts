import { Inject } from '@fluojs/core';
import { cloneWithFallback } from '@fluojs/core/internal';
import type { Container } from '@fluojs/di';
import { getRedisClientToken, getRedisComponentId } from '@fluojs/redis';
import {
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';
import { Queue as BullQueue, Worker as BullWorker, type ConnectionOptions, type JobsOptions, type Job as BullJob } from 'bullmq';

import { QueueDeadLetterManager, type QueueRedisDeadLetterClient } from './dead-letter-manager.js';
import { normalizePositiveInteger } from './helpers.js';
import { createQueuePlatformStatusSnapshot } from './status.js';
import { QUEUE_OPTIONS } from './tokens.js';
import { discoverQueueWorkerDescriptors } from './worker-discovery.js';
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

type QueueLifecycleState = 'idle' | 'starting' | 'started' | 'stopping' | 'stopped';

type QueueOwnedConnection = ConnectionOptions & {
  connect(): Promise<unknown>;
  disconnect(): void;
  quit(): Promise<unknown>;
  maxRetriesPerRequest?: number | null;
  status?: string;
};

interface QueueBullMqConnectionOptions {
  maxRetriesPerRequest: null;
}

interface QueueRedisClient extends QueueRedisDeadLetterClient {
  duplicate(options?: QueueBullMqConnectionOptions): QueueOwnedConnection;
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

interface ResolvedWorkerHandler {
  handler: (this: unknown, payload: object) => Promise<void>;
  instance: unknown;
}

function hasQueueRedisClient(value: unknown): value is QueueRedisClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const client = value as { duplicate?: unknown; ltrim?: unknown; rpush?: unknown };

  return typeof client.duplicate === 'function' && typeof client.rpush === 'function' && typeof client.ltrim === 'function';
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
  return Object.assign(Object.create(jobType.prototype), cloneWithFallback(payload)) as TJob;
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

/**
 * Lifecycle-managed queue runtime for worker discovery and job dispatch.
 *
 * The service discovers `@QueueWorker()` providers during bootstrap, creates the
 * BullMQ queues/workers they require, and shuts them down with the application.
 */
@Inject(QUEUE_OPTIONS, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER)
export class QueueLifecycleService implements Queue, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
  private readonly descriptorsByJobType = new Map<QueueJobType, QueueWorkerDescriptor>();
  private readonly queuesByJobName = new Map<string, QueueInstance>();
  private readonly workersByJobName = new Map<string, WorkerInstance>();
  private readonly ownedConnections: QueueOwnedConnection[] = [];
  private readonly deadLetterManager: QueueDeadLetterManager;
  private lifecycleState: QueueLifecycleState = 'idle';
  private redisClient: QueueRedisClient | undefined;
  private startPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly options: NormalizedQueueModuleOptions,
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
  ) {
    this.deadLetterManager = new QueueDeadLetterManager(this.options, this.logger, () => this.getRedisClient());
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureStarted();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Enqueues one job instance using the worker metadata registered for its class.
   *
   * @param job Job instance whose constructor matches a discovered `@QueueWorker()` provider.
   * @returns The queue-assigned job id, or an empty string when BullMQ does not provide one.
   *
   * @throws {Error} When no worker is registered for the job type or the queue is not initialized.
   */
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

  /**
   * Creates a platform status snapshot for health checks and diagnostics.
   *
   * @returns A structured snapshot describing lifecycle state, discovered workers, and pending dead-letter writes.
   */
  createPlatformStatusSnapshot() {
    return createQueuePlatformStatusSnapshot({
      dependencyId: getRedisComponentId(this.options.clientName),
      lifecycleState: this.lifecycleState,
      pendingDeadLetterWrites: this.deadLetterManager.pendingWriteCount,
      queuesReady: this.queuesByJobName.size,
      workersDiscovered: this.descriptorsByJobType.size,
      workersReady: this.workersByJobName.size,
    });
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
    const redis = await this.resolveRedisClient();
    this.redisClient = redis;
    this.descriptorsByJobType.clear();

    for (const [jobType, descriptor] of discoverQueueWorkerDescriptors(this.compiledModules, this.options, this.logger)) {
      this.descriptorsByJobType.set(jobType, descriptor);
    }

    await this.initializeWorkers(redis);
    this.lifecycleState = 'started';
  }

  private async handleStartupFailure(): Promise<void> {
    await this.closeInitializedResources();
    this.lifecycleState = 'idle';
    this.redisClient = undefined;
    this.startPromise = undefined;
  }

  private async resolveRedisClient(): Promise<QueueRedisClient> {
    const redisToken = getRedisClientToken(this.options.clientName);

    if (!this.runtimeContainer.has(redisToken)) {
      throw new Error('@fluojs/queue requires a registered Redis client with duplicate(), rpush(), and ltrim() methods.');
    }

    const redisClient = await this.runtimeContainer.resolve(redisToken);

    if (!hasQueueRedisClient(redisClient)) {
      throw new Error('@fluojs/queue requires a Redis client with duplicate(), rpush(), and ltrim() methods.');
    }

    return redisClient;
  }

  private getRedisClient(): QueueRedisClient {
    if (!this.redisClient) {
      throw new Error('@fluojs/queue Redis client is not initialized.');
    }

    return this.redisClient;
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
      this.deadLetterManager.trackTerminalFailure(descriptor, job, error);
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
    const connection = redis.duplicate({
      maxRetriesPerRequest: null,
    });

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
      await this.deadLetterManager.drainPendingWrites();
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
