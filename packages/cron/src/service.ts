import { Inject } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import { getRedisComponentId } from '@fluojs/redis';
import { Cron as CronValidator } from 'croner';
import {
  type ApplicationLogger,
  type CompiledModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleDestroy,
} from '@fluojs/runtime';
import { APPLICATION_LOGGER, COMPILED_MODULES, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { CronDistributedLockManager } from './distributed-lock-manager.js';
import { createCronPlatformStatusSnapshot } from './status.js';
import { createLockKey, discoverCronTaskDescriptors } from './task-discovery.js';
import { CronTaskRunner } from './task-runner.js';
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
  private readonly distributedLocks: CronDistributedLockManager;
  private readonly taskRunner: CronTaskRunner;
  private lifecycleState: 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private started = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly options: NormalizedCronModuleOptions,
    private readonly runtimeContainer: Container,
    private readonly compiledModules: readonly CompiledModule[],
    private readonly logger: ApplicationLogger,
  ) {
    this.distributedLocks = new CronDistributedLockManager(this.options, this.runtimeContainer, this.logger);
    this.taskRunner = new CronTaskRunner(this.runtimeContainer, this.logger);
  }

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
      dependencyId: this.options.distributed.enabled ? getRedisComponentId(this.options.distributed.clientName) : undefined,
      distributedEnabled: this.options.distributed.enabled,
      enabledTasks,
      lifecycleState: this.lifecycleState,
      lockOwnershipLosses: this.distributedLocks.ownershipLosses,
      lockRenewalFailures: this.distributedLocks.renewalFailures,
      ownedLocks: this.distributedLocks.ownedLocks,
      redisDependencyResolved: this.distributedLocks.resolvedClient !== undefined,
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
    await this.distributedLocks.resolveClient();
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
    this.distributedLocks.reset();
  }

  private async runShutdownLifecycle(): Promise<void> {
    this.lifecycleState = 'stopping';
    this.started = false;
    this.stopAllScheduledTasks();
    const shutdownTimedOut = await this.waitForActiveTasks();

    if (shutdownTimedOut) {
      this.logger.warn(
        `Cron shutdown timed out after ${String(this.options.shutdown.timeoutMs)}ms with ${String(this.activeTasks.size)} active task(s) still pending.`,
        'CronLifecycleService',
      );
    }

    await this.distributedLocks.releaseOwnedLocks(
      shutdownTimedOut ? this.getRunningDistributedLockKeys() : new Set(),
    );
    this.lifecycleState = 'stopped';
  }

  private getRunningDistributedLockKeys(): ReadonlySet<string> {
    const lockKeys = new Set<string>();

    for (const task of this.tasks.values()) {
      if (task.running && this.shouldUseDistributedExecution(task.descriptor)) {
        lockKeys.add(task.descriptor.lockKey);
      }
    }

    return lockKeys;
  }

  private registerDecoratorTasks(): void {
    const descriptors = discoverCronTaskDescriptors(this.compiledModules, this.options, this.logger);

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
    return this.options.distributed.enabled && descriptor.distributed && this.distributedLocks.resolvedClient !== undefined;
  }

  private async runDistributedTaskTick(descriptor: CronTaskDescriptor, taskState: RuntimeTaskState): Promise<void> {
    const lockAcquired = await this.distributedLocks.tryAcquireLock(descriptor);

    if (!lockAcquired) {
      return;
    }

    const lockRenewalMonitor = this.distributedLocks.startLockRenewalMonitor(descriptor);

    try {
      await this.executeTask(descriptor, taskState, async () => {
        lockRenewalMonitor.stop();
        return await lockRenewalMonitor.getPostRunError();
      });
    } finally {
      lockRenewalMonitor.stop();
      await this.distributedLocks.releaseLock(descriptor);
    }
  }

  private async waitForActiveTasks(): Promise<boolean> {
    if (this.activeTasks.size === 0) {
      return false;
    }

    if (this.options.shutdown.timeoutMs === 0) {
      return true;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        this.drainActiveTasks().then(() => false),
        new Promise<boolean>((resolve) => {
          timeoutHandle = setTimeout(() => {
            resolve(true);
          }, this.options.shutdown.timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async drainActiveTasks(): Promise<void> {
    while (this.activeTasks.size > 0) {
      await Promise.allSettled(Array.from(this.activeTasks));
    }
  }

  private async executeTask(
    descriptor: CronTaskDescriptor,
    taskState: RuntimeTaskState,
    postRunErrorProvider?: () => Error | Promise<Error | undefined> | undefined,
  ): Promise<void> {
    await this.taskRunner.executeTask(descriptor, postRunErrorProvider);

    if (descriptor.kind === 'timeout') {
      taskState.enabled = false;
      taskState.scheduledHandle = undefined;
    }
  }
  private stopAllScheduledTasks(): void {
    for (const task of this.tasks.values()) {
      this.unscheduleTask(task);
    }
  }
}
