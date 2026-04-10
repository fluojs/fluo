import { Inject, type MetadataPropertyKey, type Token } from '@fluojs/core';
import { getClassDiMetadata } from '@fluojs/core/internal';
import type { Container, Provider } from '@fluojs/di';
import { REDIS_CLIENT } from '@fluojs/redis';
import { Cron as CronValidator } from 'croner';
import {
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { getSchedulingTaskMetadataEntries } from './metadata.js';
import { createCronPlatformStatusSnapshot } from './status.js';
import { CRON_OPTIONS } from './tokens.js';
import type {
  CronTaskDescriptor,
  CronTaskOptions,
  IntervalTaskOptions,
  NormalizedCronModuleOptions,
  SchedulingRegistry,
  SchedulingTaskCallback,
  SchedulingTaskDescriptor,
  TimeoutTaskOptions,
} from './types.js';

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

interface RuntimeScheduledTask {
  stop(): void;
}

interface RuntimeTaskState {
  descriptor: CronTaskDescriptor;
  enabled: boolean;
  running: boolean;
  scheduledHandle: RuntimeScheduledTask | undefined;
  source: 'decorator' | 'dynamic';
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

function assertValidLockTtlMs(lockTtlMs: number): void {
  if (!Number.isFinite(lockTtlMs) || !Number.isInteger(lockTtlMs) || lockTtlMs < 1_000) {
    throw new Error('Cron distributed lockTtlMs must be a positive integer greater than or equal to 1000ms.');
  }
}

function assertValidTaskName(name: string): void {
  if (name.trim().length === 0) {
    throw new Error('Scheduling task name must be a non-empty string.');
  }
}

function assertValidMs(ms: number, context: string): void {
  if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms <= 0) {
    throw new Error(`${context}: ms must be a positive integer.`);
  }
}

function assertValidCronExpression(expression: string): void {
  try {
    new CronValidator(expression, { maxRuns: 0 });
  } catch {
    throw new Error(`@Cron(): invalid cron expression "${expression}".`);
  }
}

/**
 * Lifecycle-managed scheduler runtime for decorator-discovered and dynamic tasks.
 *
 * The service discovers scheduling decorators during bootstrap, coordinates
 * optional distributed locks through Redis, and exposes runtime task management
 * through {@link SchedulingRegistry}.
 */
@Inject(CRON_OPTIONS, RUNTIME_CONTAINER, COMPILED_MODULES, APPLICATION_LOGGER)
export class CronLifecycleService
  implements SchedulingRegistry, OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy
{
  private readonly tasks = new Map<string, RuntimeTaskState>();
  private readonly activeTasks = new Set<Promise<void>>();
  private readonly ownedLockKeys = new Set<string>();
  private lifecycleState: 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private lockOwnershipLosses = 0;
  private lockRenewalFailures = 0;
  private started = false;
  private shutdownPromise: Promise<void> | undefined;
  private redisClient: RedisLockClient | undefined;

  constructor(
    private readonly options: NormalizedCronModuleOptions,
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
  ) {}

  /**
   * Registers a cron task at runtime.
   *
   * @param name Stable task name used for lookup and distributed lock derivation.
   * @param expression Cron expression validated before registration.
   * @param callback Task body executed on matching cron ticks.
   * @param options Optional hooks, distributed lock overrides, and timezone.
   */
  addCron(name: string, expression: string, callback: SchedulingTaskCallback, options: CronTaskOptions = {}): void {
    assertValidTaskName(name);
    assertValidCronExpression(expression);

    this.registerTask(
      {
        afterRun: options.afterRun,
        beforeRun: options.beforeRun,
        callback,
        distributed: options.distributed ?? true,
        expression,
        kind: 'cron',
        lockKey: createLockKey(this.options.distributed.keyPrefix, options.key ?? name),
        lockTtlMs: options.lockTtlMs ?? this.options.distributed.lockTtlMs,
        onError: options.onError,
        onSuccess: options.onSuccess,
        taskName: name,
        timezone: options.timezone,
      },
      'dynamic',
    );
  }

  /**
   * Registers a fixed-interval task at runtime.
   *
   * @param name Stable task name used for lookup and distributed lock derivation.
   * @param ms Positive interval in milliseconds.
   * @param callback Task body executed on each interval.
   * @param options Optional hooks and distributed lock overrides.
   */
  addInterval(name: string, ms: number, callback: SchedulingTaskCallback, options: IntervalTaskOptions = {}): void {
    assertValidTaskName(name);
    assertValidMs(ms, 'scheduling registry');

    this.registerTask(
      {
        afterRun: options.afterRun,
        beforeRun: options.beforeRun,
        callback,
        distributed: options.distributed ?? true,
        kind: 'interval',
        lockKey: createLockKey(this.options.distributed.keyPrefix, options.key ?? name),
        lockTtlMs: options.lockTtlMs ?? this.options.distributed.lockTtlMs,
        ms,
        onError: options.onError,
        onSuccess: options.onSuccess,
        taskName: name,
      },
      'dynamic',
    );
  }

  /**
   * Registers a one-shot delayed task at runtime.
   *
   * @param name Stable task name used for lookup and distributed lock derivation.
   * @param ms Positive delay in milliseconds before execution.
   * @param callback Task body executed once after the delay.
   * @param options Optional hooks and distributed lock overrides.
   */
  addTimeout(name: string, ms: number, callback: SchedulingTaskCallback, options: TimeoutTaskOptions = {}): void {
    assertValidTaskName(name);
    assertValidMs(ms, 'scheduling registry');

    this.registerTask(
      {
        afterRun: options.afterRun,
        beforeRun: options.beforeRun,
        callback,
        distributed: options.distributed ?? true,
        kind: 'timeout',
        lockKey: createLockKey(this.options.distributed.keyPrefix, options.key ?? name),
        lockTtlMs: options.lockTtlMs ?? this.options.distributed.lockTtlMs,
        ms,
        onError: options.onError,
        onSuccess: options.onSuccess,
        taskName: name,
      },
      'dynamic',
    );
  }

  /**
   * Removes a registered task by name.
   *
   * @param name Task name to remove.
   * @returns `true` when a task existed and was removed.
   */
  remove(name: string): boolean {
    const task = this.tasks.get(name);

    if (!task) {
      return false;
    }

    this.unscheduleTask(task);
    this.tasks.delete(name);
    return true;
  }

  /**
   * Enables a task that was previously disabled.
   *
   * @param name Task name to enable.
   * @returns `true` when the task exists after the operation.
   */
  enable(name: string): boolean {
    const task = this.tasks.get(name);

    if (!task) {
      return false;
    }

    if (task.enabled) {
      return true;
    }

    task.enabled = true;

    if (this.started) {
      this.scheduleTask(task);
    }

    return true;
  }

  /**
   * Disables a task without removing its descriptor.
   *
   * @param name Task name to disable.
   * @returns `true` when the task exists after the operation.
   */
  disable(name: string): boolean {
    const task = this.tasks.get(name);

    if (!task) {
      return false;
    }

    if (!task.enabled && !task.scheduledHandle) {
      return true;
    }

    task.enabled = false;
    this.unscheduleTask(task);
    return true;
  }

  /**
   * Looks up one task descriptor.
   *
   * @param name Task name to inspect.
   * @returns The task descriptor, or `undefined` when not found.
   */
  get(name: string): SchedulingTaskDescriptor | undefined {
    const task = this.tasks.get(name);

    return task ? this.toSchedulingTaskDescriptor(task) : undefined;
  }

  /**
   * Lists every known task descriptor.
   *
   * @returns All decorator-discovered and dynamically registered task descriptors.
   */
  getAll(): SchedulingTaskDescriptor[] {
    return Array.from(this.tasks.values()).map((task) => this.toSchedulingTaskDescriptor(task));
  }

  /**
   * Replaces the cron expression of one existing cron task.
   *
   * @param name Name of the cron task to update.
   * @param expression New cron expression to validate and schedule.
   */
  updateCronExpression(name: string, expression: string): void {
    assertValidCronExpression(expression);

    const task = this.tasks.get(name);

    if (!task) {
      throw new Error(`Scheduling task "${name}" does not exist.`);
    }

    if (task.descriptor.kind !== 'cron') {
      throw new Error(`updateCronExpression() supports only cron tasks. Received ${task.descriptor.kind} task "${name}".`);
    }

    task.descriptor.expression = expression;

    if (!task.enabled || !this.started) {
      return;
    }

    this.unscheduleTask(task);
    this.scheduleTask(task);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.started) {
      return;
    }

    this.lifecycleState = 'starting';

    try {
      await this.startLifecycle();
      this.lifecycleState = 'ready';
    } catch (error) {
      this.lifecycleState = 'failed';
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

  createPlatformStatusSnapshot() {
    let enabledTasks = 0;
    let runningTasks = 0;

    for (const task of this.tasks.values()) {
      if (task.enabled) {
        enabledTasks += 1;
      }

      if (task.running) {
        runningTasks += 1;
      }
    }

    return createCronPlatformStatusSnapshot({
      activeTicks: this.activeTasks.size,
      distributedEnabled: this.options.distributed.enabled,
      enabledTasks,
      lifecycleState: this.lifecycleState,
      lockOwnershipLosses: this.lockOwnershipLosses,
      lockRenewalFailures: this.lockRenewalFailures,
      ownedLocks: this.ownedLockKeys.size,
      redisDependencyResolved: this.redisClient !== undefined,
      runningTasks,
      totalTasks: this.tasks.size,
    });
  }

  private toSchedulingTaskDescriptor(task: RuntimeTaskState): SchedulingTaskDescriptor {
    return {
      distributed: task.descriptor.distributed,
      enabled: task.enabled,
      expression: task.descriptor.expression,
      kind: task.descriptor.kind,
      lockKey: task.descriptor.lockKey,
      lockTtlMs: task.descriptor.lockTtlMs,
      methodName: task.descriptor.methodName,
      moduleName: task.descriptor.moduleName,
      ms: task.descriptor.ms,
      name: task.descriptor.taskName,
      source: task.source,
      targetName: task.descriptor.targetName,
      timezone: task.descriptor.timezone,
    };
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
    this.registerDecoratorTasks();
    this.started = true;
    this.scheduleEnabledTasks();
  }

  private validateDistributedLockConfiguration(): void {
    if (!this.options.distributed.enabled) {
      return;
    }

    assertValidLockTtlMs(this.options.distributed.lockTtlMs);
  }

  private handleStartupFailure(): void {
    this.started = false;
    this.stopAllScheduledTasks();
    this.tasks.clear();
    this.redisClient = undefined;
  }

  private async runShutdownLifecycle(): Promise<void> {
    this.lifecycleState = 'stopping';
    this.started = false;
    this.stopAllScheduledTasks();
    await this.waitForActiveTasks();
    await this.releaseOwnedLocks();
    this.lifecycleState = 'stopped';
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

  private registerDecoratorTasks(): void {
    const descriptors = this.discoverTaskDescriptors();

    for (const descriptor of descriptors) {
      this.registerTask(descriptor, 'decorator');
    }
  }

  private registerTask(descriptor: CronTaskDescriptor, source: 'decorator' | 'dynamic'): void {
    this.assertTaskNameAvailable(descriptor.taskName);

    if (descriptor.distributed) {
      assertValidLockTtlMs(descriptor.lockTtlMs);
    }

    const task: RuntimeTaskState = {
      descriptor,
      enabled: true,
      running: false,
      scheduledHandle: undefined,
      source,
    };

    this.tasks.set(descriptor.taskName, task);

    if (this.started) {
      this.scheduleTask(task);
    }
  }

  private assertTaskNameAvailable(taskName: string): void {
    if (this.tasks.has(taskName)) {
      throw new Error(`Duplicate scheduling task name detected: "${taskName}". Task names must be unique globally.`);
    }
  }

  private scheduleEnabledTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }
  }

  private scheduleTask(task: RuntimeTaskState): void {
    if (!task.enabled || task.scheduledHandle) {
      return;
    }

    if (task.descriptor.kind === 'cron') {
      const expression = task.descriptor.expression;

      if (!expression) {
        throw new Error(`Cron task "${task.descriptor.taskName}" is missing a cron expression.`);
      }

      const scheduled = this.options.scheduler(
        expression,
        {
          name: task.descriptor.taskName,
          protect: true,
          timezone: task.descriptor.timezone,
        },
        async () => {
          await this.handleTaskTick(task.descriptor.taskName);
        },
      );

      task.scheduledHandle = scheduled;
      return;
    }

    const ms = task.descriptor.ms;

    if (!ms) {
      throw new Error(`${task.descriptor.kind} task "${task.descriptor.taskName}" is missing interval duration.`);
    }

    if (task.descriptor.kind === 'interval') {
      const timer = setInterval(() => {
        void this.handleTaskTick(task.descriptor.taskName);
      }, ms);

      task.scheduledHandle = {
        stop: () => {
          clearInterval(timer);
        },
      };
      return;
    }

    const timer = setTimeout(() => {
      void this.handleTaskTick(task.descriptor.taskName).finally(() => {
        this.completeTimeoutTask(task.descriptor.taskName);
      });
    }, ms);

    task.scheduledHandle = {
      stop: () => {
        clearTimeout(timer);
      },
    };
  }

  private completeTimeoutTask(taskName: string): void {
    const task = this.tasks.get(taskName);

    if (!task || task.descriptor.kind !== 'timeout') {
      return;
    }

    task.scheduledHandle = undefined;
    task.enabled = false;
  }

  private unscheduleTask(task: RuntimeTaskState): void {
    if (!task.scheduledHandle) {
      return;
    }

    try {
      task.scheduledHandle.stop();
    } catch (error) {
      this.logger.error('Failed to stop scheduled task during shutdown.', error, 'CronLifecycleService');
    } finally {
      task.scheduledHandle = undefined;
    }
  }

  private discoverTaskDescriptors(): CronTaskDescriptor[] {
    const seen = new Map<Function, Set<string>>();
    const descriptors: CronTaskDescriptor[] = [];

    for (const candidate of this.discoveryCandidates()) {
      const entries = getSchedulingTaskMetadataEntries(candidate.targetType.prototype);

      if (candidate.scope !== 'singleton') {
        if (entries.length > 0) {
          this.logger.warn(
            `${candidate.targetType.name} in module ${candidate.moduleName} declares scheduling methods (@Cron/@Interval/@Timeout) but is registered with ${candidate.scope} scope. Scheduling tasks are run only for singleton providers.`,
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

        const descriptor: CronTaskDescriptor = {
          afterRun: entry.metadata.options.afterRun,
          beforeRun: entry.metadata.options.beforeRun,
          distributed: entry.metadata.options.distributed ?? true,
          kind: entry.metadata.kind,
          lockKey: createLockKey(this.options.distributed.keyPrefix, entry.metadata.options.key ?? taskName),
          lockTtlMs,
          methodKey: entry.propertyKey,
          methodName,
          moduleName: candidate.moduleName,
          onError: entry.metadata.options.onError,
          onSuccess: entry.metadata.options.onSuccess,
          targetName: candidate.targetType.name,
          taskName,
          token: candidate.token,
        };

        if (entry.metadata.kind === 'cron') {
          descriptor.expression = entry.metadata.expression;
          descriptor.timezone = entry.metadata.options.timezone;
        } else {
          descriptor.ms = entry.metadata.ms;
        }

        descriptors.push(descriptor);
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

  private async handleTaskTick(taskName: string): Promise<void> {
    const taskState = this.tasks.get(taskName);

    if (!taskState || !taskState.enabled || taskState.running) {
      return;
    }

    const task = this.runTaskTick(taskState.descriptor, taskState);
    taskState.running = true;
    this.activeTasks.add(task);

    try {
      await task;
    } finally {
      taskState.running = false;
      this.activeTasks.delete(task);
    }
  }

  private async runTaskTick(descriptor: CronTaskDescriptor, taskState: RuntimeTaskState): Promise<void> {
    if (!this.shouldUseDistributedExecution(descriptor)) {
      await this.executeTask(descriptor, taskState);
      return;
    }

    await this.runDistributedTaskTick(descriptor, taskState);
  }

  private shouldUseDistributedExecution(descriptor: CronTaskDescriptor): boolean {
    return this.options.distributed.enabled && descriptor.distributed && this.redisClient !== undefined;
  }

  private async runDistributedTaskTick(descriptor: CronTaskDescriptor, taskState: RuntimeTaskState): Promise<void> {
    const lockAcquired = await this.tryAcquireLock(descriptor);

    if (!lockAcquired) {
      return;
    }

    const lockRenewalMonitor = this.startLockRenewalMonitor(descriptor);

    try {
      await this.executeTask(descriptor, taskState, async () => {
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

    if (outcome === 'ownership-lost') {
      this.lockOwnershipLosses += 1;
    }

    if (outcome === 'renewal-failed') {
      this.lockRenewalFailures += 1;
    }

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
    taskState: RuntimeTaskState,
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

    if (descriptor.kind === 'timeout') {
      taskState.enabled = false;
      taskState.scheduledHandle = undefined;
    }
  }

  private async resolveTaskInvocation(descriptor: CronTaskDescriptor): Promise<ResolvedTaskInvocation | undefined> {
    if (descriptor.callback) {
      return {
        callable: descriptor.callback as (this: unknown) => Promise<void>,
        instance: undefined,
      };
    }

    if (!descriptor.token || descriptor.methodKey === undefined || !descriptor.targetName || !descriptor.moduleName || !descriptor.methodName) {
      this.logger.error(
        `Scheduling task ${descriptor.taskName} is missing invocation metadata and was skipped.`,
        undefined,
        'CronLifecycleService',
      );
      return undefined;
    }

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

  private stopAllScheduledTasks(): void {
    for (const task of this.tasks.values()) {
      this.unscheduleTask(task);
    }
  }
}
