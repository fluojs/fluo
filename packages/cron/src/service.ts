import { Inject, getClassDiMetadata, type MetadataPropertyKey, type Token } from '@konekti/core';
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

import { getCronTaskMetadataEntries } from './metadata.js';
import { CRON_OPTIONS } from './tokens.js';
import type { CronScheduleOptions, CronScheduledJob, CronTaskDescriptor, NormalizedCronModuleOptions } from './types.js';

interface RedisLockClient {
  eval(script: string, keysLength: number, ...keysAndArgs: string[]): Promise<unknown>;
  set(key: string, value: string, mode: 'PX', ttl: number, existence: 'NX'): Promise<'OK' | null | undefined>;
}

const RELEASE_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';
const RENEW_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) else return 0 end';

interface DiscoveryCandidate {
  moduleName: string;
  scope: 'request' | 'singleton' | 'transient';
  targetType: Function;
  token: Token;
}

interface LockRenewalMonitor {
  getPostRunError(): Promise<Error | undefined>;
  stop(): void;
}

interface LockRenewalState {
  lockPostRunError: Error | undefined;
  nextRenewalDueAt: number;
  renewalChain: Promise<void>;
  renewalIntervalMs: number;
  stopped: boolean;
}

interface ResolvedTaskInvocation {
  callable: (this: unknown) => Promise<void>;
  instance: unknown;
}

type LockRenewalOutcome = 'renewed' | 'ownership-lost' | 'renewal-failed';

function scopeFromProvider(provider: Provider): 'request' | 'singleton' | 'transient' {
  if (typeof provider === 'function') {
    return getClassDiMetadata(provider)?.scope ?? 'singleton';
  }

  if ('useClass' in provider) {
    return provider.scope ?? getClassDiMetadata(provider.useClass)?.scope ?? 'singleton';
  }

  return 'scope' in provider ? provider.scope ?? 'singleton' : 'singleton';
}

function methodKeyToName(methodKey: MetadataPropertyKey): string {
  return typeof methodKey === 'symbol' ? methodKey.toString() : methodKey;
}

function buildDefaultTaskName(targetName: string, methodName: string): string {
  return `${targetName}.${methodName}`;
}

function isClassProvider(provider: Provider): provider is Extract<Provider, { provide: Token; useClass: Function }> {
  return typeof provider === 'object' && provider !== null && 'useClass' in provider;
}

function createLockKey(prefix: string, taskName: string): string {
  return `${prefix}:${taskName}`;
}

function hasRedisLockClient(value: unknown): value is RedisLockClient {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const client = value as { eval?: unknown; set?: unknown };

  return typeof client.set === 'function' && typeof client.eval === 'function';
}

function assertValidLockTtlMs(lockTtlMs: number): void {
  if (!Number.isFinite(lockTtlMs) || !Number.isInteger(lockTtlMs) || lockTtlMs < 1_000) {
    throw new Error('Cron distributed lockTtlMs must be a positive integer greater than or equal to 1000ms.');
  }
}

@Inject([CRON_OPTIONS, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER])
export class CronLifecycleService implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy {
  private readonly jobs: CronScheduledJob[] = [];
  private readonly activeTasks = new Set<Promise<void>>();
  private readonly ownedLockKeys = new Set<string>();
  private started = false;
  private shutdownPromise: Promise<void> | undefined;
  private redisClient: RedisLockClient | undefined;

  constructor(
    private readonly options: NormalizedCronModuleOptions,
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.started) {
      return;
    }

    try {
      await this.startLifecycle();
    } catch (error) {
      this.handleStartupFailure();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  private async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
      return;
    }

    this.shutdownPromise = this.runShutdownLifecycle();

    await this.shutdownPromise;
  }

  private async startLifecycle(): Promise<void> {
    await this.resolveDistributedClient();
    this.validateDistributedLockConfiguration();
    this.scheduleTasks();
    this.started = true;
  }

  private validateDistributedLockConfiguration(): void {
    if (!this.options.distributed.enabled) {
      return;
    }

    assertValidLockTtlMs(this.options.distributed.lockTtlMs);
  }

  private handleStartupFailure(): void {
    this.stopAllJobs();
    this.redisClient = undefined;
  }

  private async runShutdownLifecycle(): Promise<void> {
    this.stopAllJobs();
    await this.waitForActiveTasks();
    await this.releaseOwnedLocks();
  }

  private async resolveDistributedClient(): Promise<void> {
    if (!this.options.distributed.enabled) {
      return;
    }

    if (!this.runtimeContainer.has(REDIS_CLIENT)) {
      throw new Error('Cron distributed mode requires REDIS_CLIENT to be registered.');
    }

    const redisClient = await this.runtimeContainer.resolve(REDIS_CLIENT);

    if (!hasRedisLockClient(redisClient)) {
      throw new Error('Cron distributed mode requires REDIS_CLIENT to implement set/eval lock operations.');
    }

    this.redisClient = redisClient;
  }

  private scheduleTasks(): void {
    const descriptors = this.discoverTaskDescriptors();

    for (const descriptor of descriptors) {
      const scheduleOptions: CronScheduleOptions = {
        name: descriptor.taskName,
        protect: true,
        timezone: descriptor.timezone,
      };

      const job = this.options.scheduler(descriptor.expression, scheduleOptions, async () => {
        await this.handleTaskTick(descriptor);
      });

      this.jobs.push(job);
    }
  }

  private discoverTaskDescriptors(): CronTaskDescriptor[] {
    const seen = new Map<Function, Set<string>>();
    const descriptors: CronTaskDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const entries = getCronTaskMetadataEntries(candidate.targetType.prototype);

      if (candidate.scope !== 'singleton') {
        if (entries.length > 0) {
          this.logger.warn(
            `${candidate.targetType.name} in module ${candidate.moduleName} declares @Cron() methods but is registered with ${candidate.scope} scope. Cron tasks are scheduled only for singleton providers.`,
            'CronLifecycleService',
          );
        }

        continue;
      }

      for (const entry of entries) {
        const methodName = methodKeyToName(entry.propertyKey);
        const taskName = entry.metadata.options.name ?? buildDefaultTaskName(candidate.targetType.name, methodName);
        const seenMethods = seen.get(candidate.targetType) ?? new Set<string>();
        const lockTtlMs = entry.metadata.options.lockTtlMs ?? this.options.distributed.lockTtlMs;

        if (seenMethods.has(methodName)) {
          continue;
        }

        seenMethods.add(methodName);
        seen.set(candidate.targetType, seenMethods);
        descriptors.push({
          afterRun: entry.metadata.options.afterRun,
          beforeRun: entry.metadata.options.beforeRun,
          distributed: entry.metadata.options.distributed ?? true,
          expression: entry.metadata.expression,
          lockKey: createLockKey(this.options.distributed.keyPrefix, entry.metadata.options.key ?? taskName),
          lockTtlMs,
          methodKey: entry.propertyKey,
          methodName,
          moduleName: candidate.moduleName,
          onError: entry.metadata.options.onError,
          onSuccess: entry.metadata.options.onSuccess,
          targetName: candidate.targetType.name,
          taskName,
          timezone: entry.metadata.options.timezone,
          token: candidate.token,
        });

        if (entry.metadata.options.distributed ?? true) {
          assertValidLockTtlMs(lockTtlMs);
        }
      }
    }

    return descriptors;
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

  private async handleTaskTick(descriptor: CronTaskDescriptor): Promise<void> {
    const task = this.runTaskTick(descriptor);
    this.activeTasks.add(task);

    try {
      await task;
    } finally {
      this.activeTasks.delete(task);
    }
  }

  private async runTaskTick(descriptor: CronTaskDescriptor): Promise<void> {
    if (!this.shouldUseDistributedExecution(descriptor)) {
      await this.executeTask(descriptor);
      return;
    }

    await this.runDistributedTaskTick(descriptor);
  }

  private shouldUseDistributedExecution(descriptor: CronTaskDescriptor): boolean {
    return this.options.distributed.enabled && descriptor.distributed && this.redisClient !== undefined;
  }

  private async runDistributedTaskTick(descriptor: CronTaskDescriptor): Promise<void> {
    const lockAcquired = await this.tryAcquireLock(descriptor);

    if (!lockAcquired) {
      return;
    }

    const lockRenewalMonitor = this.startLockRenewalMonitor(descriptor);

    try {
      await this.executeTask(descriptor, async () => {
        lockRenewalMonitor.stop();
        return await lockRenewalMonitor.getPostRunError();
      });
    } finally {
      lockRenewalMonitor.stop();
      await this.releaseLock(descriptor);
    }
  }

  private startLockRenewalMonitor(descriptor: CronTaskDescriptor): LockRenewalMonitor {
    const renewalState = this.createLockRenewalState(descriptor.lockTtlMs);
    const renewalTimer = this.startLockRenewalTimer(descriptor, renewalState);

    return {
      getPostRunError: async (): Promise<Error | undefined> =>
        await this.resolveLockRenewalPostRunError(descriptor, renewalState),
      stop: (): void => {
        this.stopLockRenewalMonitor(renewalState, renewalTimer);
      },
    };
  }

  private createLockRenewalState(lockTtlMs: number): LockRenewalState {
    const renewalIntervalMs = Math.max(1_000, Math.floor(lockTtlMs / 2));

    return {
      lockPostRunError: undefined,
      nextRenewalDueAt: Date.now() + renewalIntervalMs,
      renewalChain: Promise.resolve(),
      renewalIntervalMs,
      stopped: false,
    };
  }

  private startLockRenewalTimer(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      if (renewalState.stopped) {
        return;
      }

      renewalState.nextRenewalDueAt += renewalState.renewalIntervalMs;
      this.queueLockRenewalAttempt(descriptor, renewalState);
    }, renewalState.renewalIntervalMs);
  }

  private queueLockRenewalAttempt(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): void {
    renewalState.renewalChain = renewalState.renewalChain.then(async () => {
      await this.runLockRenewalAttempt(descriptor, renewalState);
    });
  }

  private queueDueLockRenewalAttempts(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): void {
    const now = Date.now();

    while (now >= renewalState.nextRenewalDueAt) {
      renewalState.nextRenewalDueAt += renewalState.renewalIntervalMs;
      this.queueLockRenewalAttempt(descriptor, renewalState);
    }
  }

  private async runLockRenewalAttempt(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): Promise<void> {
    const outcome = await this.renewLock(descriptor);

    if (renewalState.lockPostRunError) {
      return;
    }

    renewalState.lockPostRunError = this.toLockPostRunError(outcome, descriptor.taskName);
  }

  private toLockPostRunError(
    outcome: LockRenewalOutcome,
    taskName: string,
  ): Error | undefined {
    if (outcome === 'ownership-lost') {
      return new Error(`Distributed cron lock ownership lost for ${taskName}.`);
    }

    if (outcome === 'renewal-failed') {
      return new Error(`Distributed cron lock renewal failed for ${taskName}.`);
    }

    return undefined;
  }

  private async resolveLockRenewalPostRunError(
    descriptor: CronTaskDescriptor,
    renewalState: LockRenewalState,
  ): Promise<Error | undefined> {
    this.queueDueLockRenewalAttempts(descriptor, renewalState);
    await renewalState.renewalChain;
    return renewalState.lockPostRunError;
  }

  private stopLockRenewalMonitor(
    renewalState: LockRenewalState,
    renewalTimer: ReturnType<typeof setInterval>,
  ): void {
    if (renewalState.stopped) {
      return;
    }

    renewalState.stopped = true;
    clearInterval(renewalTimer);
  }

  private async waitForActiveTasks(): Promise<void> {
    while (this.activeTasks.size > 0) {
      await Promise.allSettled(Array.from(this.activeTasks));
    }
  }

  private async executeTask(
    descriptor: CronTaskDescriptor,
    postRunErrorProvider?: () => Error | Promise<Error | undefined> | undefined,
  ): Promise<void> {
    const taskInvocation = await this.resolveTaskInvocation(descriptor);

    if (!taskInvocation) {
      return;
    }

    const taskError = await this.executeTaskBody(
      descriptor,
      taskInvocation,
      postRunErrorProvider,
    );
    await this.runTaskErrorHook(descriptor, taskError);
    await this.runTaskAfterHook(descriptor);
  }

  private async resolveTaskInvocation(descriptor: CronTaskDescriptor): Promise<ResolvedTaskInvocation | undefined> {
    let instance: unknown;

    try {
      instance = await this.runtimeContainer.resolve(descriptor.token);
    } catch (error) {
      this.logger.error(
        `Failed to resolve cron task target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'CronLifecycleService',
      );
      return undefined;
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `Cron method ${descriptor.targetName}.${descriptor.methodName} is not callable and was skipped.`,
        'CronLifecycleService',
      );
      return undefined;
    }

    return {
      callable: value as (this: unknown) => Promise<void>,
      instance,
    };
  }

  private async executeTaskBody(
    descriptor: CronTaskDescriptor,
    taskInvocation: ResolvedTaskInvocation,
    postRunErrorProvider?: () => Error | Promise<Error | undefined> | undefined,
  ): Promise<unknown> {
    let taskError: unknown;

    try {
      await this.runTaskBeforeHook(descriptor);
      await Promise.resolve(taskInvocation.callable.call(taskInvocation.instance));

      const postRunError = await postRunErrorProvider?.();

      if (postRunError) {
        throw postRunError;
      }

      await this.runTaskSuccessHook(descriptor);
    } catch (error) {
      taskError = error;
      this.logger.error(`Cron task ${descriptor.taskName} failed.`, error, 'CronLifecycleService');
    }

    return taskError;
  }

  private async runTaskBeforeHook(descriptor: CronTaskDescriptor): Promise<void> {
    if (!descriptor.beforeRun) {
      return;
    }

    await Promise.resolve(descriptor.beforeRun());
  }

  private async runTaskSuccessHook(descriptor: CronTaskDescriptor): Promise<void> {
    if (!descriptor.onSuccess) {
      return;
    }

    await Promise.resolve(descriptor.onSuccess());
  }

  private async runTaskErrorHook(descriptor: CronTaskDescriptor, taskError: unknown): Promise<void> {
    if (taskError && descriptor.onError) {
      try {
        await Promise.resolve(descriptor.onError(taskError));
      } catch (hookError) {
        this.logger.error(`Cron onError hook ${descriptor.taskName} failed.`, hookError, 'CronLifecycleService');
      }
    }
  }

  private async runTaskAfterHook(descriptor: CronTaskDescriptor): Promise<void> {
    if (!descriptor.afterRun) {
      return;
    }

    try {
      await Promise.resolve(descriptor.afterRun());
    } catch (hookError) {
      this.logger.error(`Cron afterRun hook ${descriptor.taskName} failed.`, hookError, 'CronLifecycleService');
    }
  }

  private async tryAcquireLock(descriptor: CronTaskDescriptor): Promise<boolean> {
    const redis = this.redisClient;

    if (!redis) {
      return true;
    }

    try {
      const result = await redis.set(
        descriptor.lockKey,
        this.options.distributed.ownerId,
        'PX',
        descriptor.lockTtlMs,
        'NX',
      );

      if (result === 'OK') {
        this.ownedLockKeys.add(descriptor.lockKey);
      }

      return result === 'OK';
    } catch (error) {
      this.logger.error(
        `Failed to acquire distributed cron lock for ${descriptor.taskName}.`,
        error,
        'CronLifecycleService',
      );
      return false;
    }
  }

  private async releaseLock(descriptor: CronTaskDescriptor): Promise<void> {
    await this.releaseLockKey(descriptor.lockKey, descriptor.taskName);
  }

  private async renewLock(descriptor: CronTaskDescriptor): Promise<LockRenewalOutcome> {
    const redis = this.redisClient;

    if (!redis) {
      return 'renewed';
    }

    try {
      const result = await redis.eval(
        RENEW_LOCK_SCRIPT,
        1,
        descriptor.lockKey,
        this.options.distributed.ownerId,
        String(descriptor.lockTtlMs),
      );

      if (typeof result === 'number' && result <= 0) {
        this.logger.warn(
          `Distributed cron lock ownership was lost for ${descriptor.taskName}.`,
          'CronLifecycleService',
        );
        return 'ownership-lost';
      }

      this.logger.log(
        `Renewed distributed cron lock for ${descriptor.taskName}.`,
        'CronLifecycleService',
      );

      return 'renewed';
    } catch (error) {
      this.logger.error(
        `Failed to renew distributed cron lock for ${descriptor.taskName}.`,
        error,
        'CronLifecycleService',
      );
      return 'renewal-failed';
    }
  }

  private async releaseOwnedLocks(): Promise<void> {
    if (!this.redisClient || this.ownedLockKeys.size === 0) {
      return;
    }

    const lockKeys = Array.from(this.ownedLockKeys);

    await Promise.all(
      lockKeys.map(async (lockKey) => {
        await this.releaseLockKey(lockKey, lockKey);
      }),
    );
  }

  private async releaseLockKey(lockKey: string, taskName: string): Promise<void> {
    const redis = this.redisClient;

    if (!redis) {
      return;
    }

    try {
      const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, this.options.distributed.ownerId);

      if (typeof result === 'number' && result <= 0) {
        this.logger.warn(
          `Distributed cron lock for ${taskName} was already released or owned by another node.`,
          'CronLifecycleService',
        );
        return;
      }

      this.logger.log(
        `Released distributed cron lock for ${taskName}.`,
        'CronLifecycleService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to release distributed cron lock for ${taskName}.`,
        error,
        'CronLifecycleService',
      );
    } finally {
      this.ownedLockKeys.delete(lockKey);
    }
  }

  private stopAllJobs(): void {
    for (const job of this.jobs.splice(0)) {
      try {
        job.stop();
      } catch (error) {
        this.logger.error('Failed to stop cron job during shutdown.', error, 'CronLifecycleService');
      }
    }
  }
}
