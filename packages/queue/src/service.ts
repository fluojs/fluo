import { cloneWithFallback } from '@fluojs/core/internal';
import type { Container } from '@fluojs/di';
import { getRedisComponentId } from '@fluojs/redis';
import type {
  ApplicationLogger,
  CompiledModule,
  ModuleType,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@fluojs/runtime';
import { type BootstrapReadySignal } from '@fluojs/runtime/internal';
import { Queue as BullQueue, Worker as BullWorker, type ConnectionOptions, type JobsOptions, type Job as BullJob } from 'bullmq';

import { QueueDeadLetterManager, type QueueRedisDeadLetterClient } from './dead-letter-manager.js';
import { normalizePositiveInteger, withTimeout } from './helpers.js';
import {
  createQueuePlatformStatusSnapshot,
  type QueueLifecycleState,
  type QueuePlatformStatusSnapshot,
} from './status.js';
import { QUEUE } from './tokens.js';
import type { QueueModuleContext } from './tokens.js';
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

interface QueueBullMqWorkerOptions {
  autorun: false;
  concurrency: number;
  connection: ConnectionOptions;
  limiter?: {
    duration: number;
    max: number;
  };
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

interface ReadyWorker {
  descriptor: QueueWorkerDescriptor;
  worker: WorkerInstance;
}

interface RunnableWorkerControls {
  run?: () => Promise<void> | void;
  waitUntilReady?: () => Promise<unknown>;
}

interface WorkerStartFailure {
  jobName: string;
  message: string;
  workerName: string;
}

interface ResolvedWorkerHandler {
  handler: (this: unknown, payload: object) => Promise<void>;
  instance: unknown;
}

const IMMEDIATE_BOOTSTRAP_READY_SIGNAL: BootstrapReadySignal = {
  wait: () => Promise.resolve(),
};

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
export class QueueLifecycleService implements Queue, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
  private readonly descriptorsByJobType = new Map<QueueJobType, QueueWorkerDescriptor>();
  private readonly queuesByJobName = new Map<string, QueueInstance>();
  private readonly workersByJobName = new Map<string, WorkerInstance>();
  private readonly ownedConnections: QueueOwnedConnection[] = [];
  private readonly deadLetterManager: QueueDeadLetterManager;
  private readonly readyWorkers: ReadyWorker[] = [];
  private readonly runningWorkerJobNames = new Set<string>();
  private readonly failedWorkerJobNames = new Set<string>();
  private readonly workerStartFailures: WorkerStartFailure[] = [];
  private readonly compiledModulesByType: ReadonlyMap<ModuleType, CompiledModule>;
  private lifecycleState: QueueLifecycleState = 'idle';
  private startPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private startupFailureRollbackPromise: Promise<void> | undefined;

  constructor(
    private readonly options: NormalizedQueueModuleOptions,
    private readonly redisClient: QueueRedisClient,
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
    private readonly bootstrapReadySignal: BootstrapReadySignal = IMMEDIATE_BOOTSTRAP_READY_SIGNAL,
    private readonly moduleContext: QueueModuleContext = { moduleType: QueueLifecycleService },
  ) {
    this.compiledModulesByType = new Map(this.compiledModules.map((compiledModule) => [compiledModule.type, compiledModule]));
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

    if (this.lifecycleState !== 'started') {
      throw new Error(`Queue lifecycle state is ${this.lifecycleState}.`);
    }

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
  createPlatformStatusSnapshot(): QueuePlatformStatusSnapshot {
    const lastWorkerStartFailure = this.workerStartFailures[this.workerStartFailures.length - 1];

    return createQueuePlatformStatusSnapshot({
      dependencyId: getRedisComponentId(this.options.clientName),
      lifecycleState: this.lifecycleState,
      ...(lastWorkerStartFailure ? { lastWorkerStartFailure: lastWorkerStartFailure.message } : {}),
      pendingDeadLetterWrites: this.deadLetterManager.pendingWriteCount,
      queuesReady: this.queuesByJobName.size,
      workerStartFailures: this.workerStartFailures.length,
      workerShutdownTimeoutMs: this.options.workerShutdownTimeoutMs,
      workersDiscovered: this.descriptorsByJobType.size,
      workersReady: this.runningWorkerJobNames.size,
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.lifecycleState === 'started') {
      return;
    }

    if (this.lifecycleState === 'failed' || this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
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
    const redis = this.resolveRedisClient();
    this.descriptorsByJobType.clear();

    for (const [jobType, descriptor] of discoverQueueWorkerDescriptors(
      this.compiledModules,
      this.options,
      this.logger,
      (compiledModule) => this.shouldDiscoverWorkersInModule(compiledModule),
    )) {
      this.descriptorsByJobType.set(jobType, descriptor);
    }

    await this.initializeWorkers(redis);
    if (this.lifecycleState === 'starting') {
      this.lifecycleState = 'started';
      this.scheduleReadyWorkers();
    }
  }

  private shouldDiscoverWorkersInModule(compiledModule: CompiledModule): boolean {
    if (this.options.global) {
      return true;
    }

    return this.canReachQueueRegistration(compiledModule);
  }

  private canReachQueueRegistration(compiledModule: CompiledModule, visited = new Set<ModuleType>()): boolean {
    if (visited.has(compiledModule.type)) {
      return false;
    }

    visited.add(compiledModule.type);

    for (const importedModuleType of compiledModule.definition.imports ?? []) {
      if (importedModuleType === this.moduleContext.moduleType) {
        return true;
      }

      const importedModule = this.compiledModulesByType.get(importedModuleType);
      if (!importedModule || !this.exportsQueueRegistration(importedModule)) {
        continue;
      }

      if (this.canReachQueueRegistration(importedModule, visited)) {
        return true;
      }
    }

    return false;
  }

  private exportsQueueRegistration(compiledModule: CompiledModule): boolean {
    return compiledModule.exportedTokens.has(QueueLifecycleService) || compiledModule.exportedTokens.has(QUEUE);
  }

  private async handleStartupFailure(): Promise<void> {
    await this.closeInitializedResources();
    await this.deadLetterManager.drainPendingWrites();
    if (this.lifecycleState === 'starting') {
      this.lifecycleState = 'idle';
    }
    this.startPromise = undefined;
  }

  private resolveRedisClient(): QueueRedisClient {
    if (!hasQueueRedisClient(this.redisClient)) {
      throw new Error('@fluojs/queue requires a Redis client with duplicate(), rpush(), and ltrim() methods.');
    }

    return this.redisClient;
  }

  private getRedisClient(): QueueRedisClient {
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
  ): QueueBullMqWorkerOptions {
    return {
      autorun: false,
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
    this.readyWorkers.push({ descriptor, worker: resources.worker });
  }

  private scheduleReadyWorkers(): void {
    const workers = this.readyWorkers.splice(0);

    void this.bootstrapReadySignal.wait().then(() => {
      if (this.lifecycleState !== 'started') {
        return;
      }

      for (const { descriptor, worker } of workers) {
        if (this.lifecycleState !== 'started') {
          break;
        }

        this.runWorker(descriptor, worker);

        if (this.lifecycleState !== 'started') {
          break;
        }
      }
    }).catch((error: unknown) => {
      if (this.lifecycleState !== 'started') {
        return;
      }

      this.lifecycleState = 'failed';
      this.workerStartFailures.push({
        jobName: '*',
        message: this.toErrorMessage(error),
        workerName: 'bootstrap-ready-signal',
      });
      this.logger.error(
        'Failed to start queue workers after application bootstrap readiness.',
        error,
        'QueueLifecycleService',
      );
      this.rollbackAfterWorkerStartupFailure();
    });
  }

  private runWorker(descriptor: QueueWorkerDescriptor, worker: WorkerInstance): void {
    const runnableWorker = worker as WorkerInstance & RunnableWorkerControls;

    if (typeof runnableWorker.run !== 'function') {
      this.recordWorkerStartFailure(
        descriptor,
        new Error(`Queue worker ${descriptor.workerName} cannot start because BullMQ Worker.run() is unavailable.`),
      );
      return;
    }

    let runResult: Promise<void> | void;

    try {
      runResult = runnableWorker.run();
    } catch (error) {
      this.recordWorkerStartFailure(descriptor, error);
      return;
    }

    const runPromise = Promise.resolve(runResult);

    void runPromise.catch((error: unknown) => {
      this.recordWorkerStartFailure(descriptor, error);
    });

    void this.markWorkerReadyWhenStarted(descriptor, runnableWorker, runPromise).catch((error: unknown) => {
      this.recordWorkerStartFailure(descriptor, error);
    });
  }

  private async markWorkerReadyWhenStarted(
    descriptor: QueueWorkerDescriptor,
    worker: WorkerInstance & RunnableWorkerControls,
    runPromise: Promise<void>,
  ): Promise<void> {
    if (typeof worker.waitUntilReady === 'function') {
      await Promise.race([worker.waitUntilReady(), runPromise]);
    } else {
      await Promise.race([Promise.resolve(), runPromise]);
    }

    if (this.lifecycleState !== 'started' || this.failedWorkerJobNames.has(descriptor.jobName)) {
      return;
    }

    this.runningWorkerJobNames.add(descriptor.jobName);
  }

  private recordWorkerStartFailure(descriptor: QueueWorkerDescriptor, error: unknown): void {
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
      return;
    }

    if (this.failedWorkerJobNames.has(descriptor.jobName)) {
      return;
    }

    this.failedWorkerJobNames.add(descriptor.jobName);
    this.runningWorkerJobNames.delete(descriptor.jobName);
    this.workerStartFailures.push({
      jobName: descriptor.jobName,
      message: this.toErrorMessage(error),
      workerName: descriptor.workerName,
    });

    if (this.lifecycleState === 'started' || this.lifecycleState === 'starting') {
      this.lifecycleState = 'failed';
    }

    this.logger.error(
      `Failed to start queue worker ${descriptor.workerName} after application bootstrap.`,
      error,
      'QueueLifecycleService',
    );
    this.rollbackAfterWorkerStartupFailure();
  }

  private rollbackAfterWorkerStartupFailure(): void {
    if (!this.startupFailureRollbackPromise) {
      this.startupFailureRollbackPromise = (async () => {
        await this.closeInitializedResources();
        await this.deadLetterManager.drainPendingWrites();
      })()
        .catch((rollbackError: unknown) => {
          this.logger.error(
            'Failed to roll back queue resources after worker startup failure.',
            rollbackError,
            'QueueLifecycleService',
          );
        });
    }
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
      await this.waitForInFlightStartup();
      await this.waitForStartupFailureRollback();

      await this.closeInitializedResources();
      await this.deadLetterManager.drainPendingWrites();
      this.lifecycleState = 'stopped';
      this.startPromise = undefined;
    })();

    await this.shutdownPromise;
  }

  private async waitForStartupFailureRollback(): Promise<void> {
    if (!this.startupFailureRollbackPromise) {
      return;
    }

    await this.startupFailureRollbackPromise;
    this.startupFailureRollbackPromise = undefined;
  }

  private async waitForInFlightStartup(): Promise<void> {
    const startup = this.startPromise;

    if (!startup) {
      return;
    }

    try {
      await startup;
    } catch {
      // ensureStarted() owns startup rollback and preserves the original
      // bootstrap error. Shutdown still continues so partially registered
      // resources cannot outlive the application lifecycle.
    }
  }

  private async closeInitializedResources(): Promise<void> {
    const workers = Array.from(this.workersByJobName.values());
    const queues = Array.from(this.queuesByJobName.values());
    const ownedConnections = this.ownedConnections.splice(0);

    this.workersByJobName.clear();
    this.queuesByJobName.clear();
    this.readyWorkers.splice(0);
    this.runningWorkerJobNames.clear();

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
      await withTimeout(
        worker.close(),
        this.options.workerShutdownTimeoutMs,
        () => new Error('queue worker shutdown timed out'),
      );
    } catch (error) {
      this.logger.error('Failed to close queue worker within shutdown timeout.', error, 'QueueLifecycleService');

      try {
        await worker.close(true);
      } catch (forceCloseError) {
        this.logger.error('Failed to force close queue worker during shutdown.', forceCloseError, 'QueueLifecycleService');
      }
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
