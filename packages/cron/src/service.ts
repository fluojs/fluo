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

    this.started = true;
    await this.resolveDistributedClient();
    this.scheduleTasks();
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

    this.shutdownPromise = (async () => {
      this.stopAllJobs();
      await this.waitForActiveTasks();
      await this.releaseOwnedLocks();
    })();

    await this.shutdownPromise;
  }

  private async resolveDistributedClient(): Promise<void> {
    if (!this.options.distributed.enabled) {
      return;
    }

    if (!this.runtimeContainer.has(REDIS_CLIENT)) {
      this.logger.warn(
        'Cron distributed mode is enabled but REDIS_CLIENT is not registered. Falling back to in-process scheduling.',
        'CronLifecycleService',
      );
      return;
    }

    const redisClient = await this.runtimeContainer.resolve(REDIS_CLIENT);

    if (!hasRedisLockClient(redisClient)) {
      this.logger.warn(
        'REDIS_CLIENT is registered but does not implement set/eval lock operations. Falling back to in-process scheduling.',
        'CronLifecycleService',
      );
      return;
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
    const seen = new Map<Token, Set<string>>();
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
        const seenMethods = seen.get(candidate.token) ?? new Set<string>();

        if (seenMethods.has(methodName)) {
          continue;
        }

        seenMethods.add(methodName);
        seen.set(candidate.token, seenMethods);
        descriptors.push({
          afterRun: entry.metadata.options.afterRun,
          beforeRun: entry.metadata.options.beforeRun,
          distributed: entry.metadata.options.distributed ?? true,
          expression: entry.metadata.expression,
          lockKey: createLockKey(this.options.distributed.keyPrefix, entry.metadata.options.key ?? taskName),
          lockTtlMs: entry.metadata.options.lockTtlMs ?? this.options.distributed.lockTtlMs,
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
    const distributedEnabled = this.options.distributed.enabled && descriptor.distributed;

    if (!distributedEnabled || !this.redisClient) {
      await this.executeTask(descriptor);
      return;
    }

    const lockAcquired = await this.tryAcquireLock(descriptor);

    if (!lockAcquired) {
      return;
    }

    const renewalIntervalMs = Math.max(1_000, Math.floor(descriptor.lockTtlMs / 2));
    let lockOwnershipError: Error | undefined;
    const renewalTimer = setInterval(() => {
      void this.renewLock(descriptor).then((renewed) => {
        if (!renewed && !lockOwnershipError) {
          lockOwnershipError = new Error(`Distributed cron lock ownership lost for ${descriptor.taskName}.`);
        }
      });
    }, renewalIntervalMs);

    try {
      await this.executeTask(descriptor, () => lockOwnershipError);
    } finally {
      clearInterval(renewalTimer);
      await this.releaseLock(descriptor);
    }
  }

  private async waitForActiveTasks(): Promise<void> {
    while (this.activeTasks.size > 0) {
      await Promise.allSettled(Array.from(this.activeTasks));
    }
  }

  private async executeTask(
    descriptor: CronTaskDescriptor,
    postRunErrorProvider?: () => Error | undefined,
  ): Promise<void> {
    let instance: unknown;

    try {
      instance = await this.runtimeContainer.resolve(descriptor.token);
    } catch (error) {
      this.logger.error(
        `Failed to resolve cron task target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'CronLifecycleService',
      );
      return;
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `Cron method ${descriptor.targetName}.${descriptor.methodName} is not callable and was skipped.`,
        'CronLifecycleService',
      );
      return;
    }

    try {
      if (descriptor.beforeRun) {
        await Promise.resolve(descriptor.beforeRun());
      }

      await Promise.resolve((value as (this: unknown) => Promise<void>).call(instance));

      const postRunError = postRunErrorProvider?.();

      if (postRunError) {
        throw postRunError;
      }

      if (descriptor.onSuccess) {
        await Promise.resolve(descriptor.onSuccess());
      }
    } catch (error) {
      this.logger.error(`Cron task ${descriptor.taskName} failed.`, error, 'CronLifecycleService');
      if (descriptor.onError) {
        await Promise.resolve(descriptor.onError(error));
      }
    } finally {
      if (descriptor.afterRun) {
        await Promise.resolve(descriptor.afterRun());
      }
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

  private async renewLock(descriptor: CronTaskDescriptor): Promise<boolean> {
    const redis = this.redisClient;

    if (!redis) {
      return true;
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
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to renew distributed cron lock for ${descriptor.taskName}.`,
        error,
        'CronLifecycleService',
      );
      return false;
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
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, this.options.distributed.ownerId);
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
