import type { MetadataPropertyKey, Token } from '@fluojs/core';

/** Supported task kinds handled by the scheduler runtime. */
export type SchedulingTaskKind = 'cron' | 'interval' | 'timeout';

/** Callback shape executed for one scheduled task invocation. */
export type SchedulingTaskCallback = () => void | Promise<void>;

/** Shared lifecycle hooks and lock settings supported by all scheduling APIs. */
export interface SchedulingTaskOptions {
  afterRun?: () => void | Promise<void>;
  beforeRun?: () => void | Promise<void>;
  distributed?: boolean;
  key?: string;
  lockTtlMs?: number;
  name?: string;
  onError?: (error: unknown) => void | Promise<void>;
  onSuccess?: () => void | Promise<void>;
}

/** Additional options available only for cron-expression tasks. */
export interface CronTaskOptions extends SchedulingTaskOptions {
  timezone?: string;
}

/** Options for fixed-interval tasks registered with {@link Interval} or {@link SchedulingRegistry.addInterval}. */
export type IntervalTaskOptions = SchedulingTaskOptions;

/** Options for one-shot delayed tasks registered with {@link Timeout} or {@link SchedulingRegistry.addTimeout}. */
export type TimeoutTaskOptions = SchedulingTaskOptions;

/** Metadata captured for one method decorated with {@link Cron}. */
export interface CronTaskMetadata {
  kind: 'cron';
  expression: string;
  options: CronTaskOptions;
}

/** Metadata captured for one method decorated with {@link Interval}. */
export interface IntervalTaskMetadata {
  kind: 'interval';
  ms: number;
  options: IntervalTaskOptions;
}

/** Metadata captured for one method decorated with {@link Timeout}. */
export interface TimeoutTaskMetadata {
  kind: 'timeout';
  ms: number;
  options: TimeoutTaskOptions;
}

/** Union of all decorator metadata shapes consumed by the scheduler runtime. */
export type SchedulingTaskMetadata = CronTaskMetadata | IntervalTaskMetadata | TimeoutTaskMetadata;

/** Distributed lock configuration for multi-instance scheduling. */
export interface CronDistributedOptions {
  clientName?: string;
  enabled?: boolean;
  keyPrefix?: string;
  lockTtlMs?: number;
  ownerId?: string;
}

/** Shutdown drain configuration for active cron tasks. */
export interface CronShutdownOptions {
  timeoutMs?: number;
}

/** Scheduler handle returned by the underlying cron engine. */
export interface CronScheduledJob {
  stop(): void;
}

/** Options forwarded to the low-level cron scheduler implementation. */
export interface CronScheduleOptions {
  name?: string;
  protect?: boolean;
  timezone?: string;
}

/** Adapter contract used to schedule cron expressions in the runtime. */
export type CronScheduler = (
  expression: string,
  options: CronScheduleOptions,
  callback: () => Promise<void>,
) => CronScheduledJob;

/** Module configuration accepted by {@link CronModule.forRoot}. */
export interface CronModuleOptions {
  distributed?: boolean | CronDistributedOptions;
  scheduler?: CronScheduler;
  shutdown?: CronShutdownOptions;
}

/** Normalized scheduler configuration used internally by {@link CronLifecycleService}. */
export interface NormalizedCronModuleOptions {
  distributed: {
    clientName?: string;
    enabled: boolean;
    keyPrefix: string;
    lockTtlMs: number;
    ownerId: string;
  };
  scheduler: CronScheduler;
  shutdown: {
    timeoutMs: number;
  };
}

/** Runtime descriptor for one discovered or dynamically registered task. */
export interface CronTaskDescriptor {
  callback?: SchedulingTaskCallback;
  kind: SchedulingTaskKind;
  afterRun?: () => void | Promise<void>;
  beforeRun?: () => void | Promise<void>;
  distributed: boolean;
  expression?: string;
  ms?: number;
  lockKey: string;
  lockTtlMs: number;
  methodKey?: MetadataPropertyKey;
  methodName?: string;
  moduleName?: string;
  onError?: (error: unknown) => void | Promise<void>;
  onSuccess?: () => void | Promise<void>;
  taskName: string;
  timezone?: string;
  targetName?: string;
  token?: Token;
}

/** Read-only task descriptor exposed by the scheduling registry. */
export interface SchedulingTaskDescriptor {
  enabled: boolean;
  kind: SchedulingTaskKind;
  name: string;
  source: 'decorator' | 'dynamic';
  distributed: boolean;
  lockKey: string;
  lockTtlMs: number;
  expression?: string;
  ms?: number;
  timezone?: string;
  moduleName?: string;
  targetName?: string;
  methodName?: string;
}

/**
 * Programmatic registry for adding, inspecting, and mutating scheduled tasks at runtime.
 *
 * @example
 * ```ts
 * registry.addCron('cleanup', '0 * * * *', async () => {
 *   await cleanupExpiredSessions();
 * });
 * ```
 */
export interface SchedulingRegistry {
  /**
   * Adds a cron-expression task to the runtime registry.
   *
   * @param name Stable task name used for lookup and distributed lock keys.
   * @param expression Cron expression validated before registration.
   * @param callback Task body executed on each schedule tick.
   * @param options Optional task hooks, naming overrides, and distributed lock controls.
   */
  addCron(name: string, expression: string, callback: SchedulingTaskCallback, options?: CronTaskOptions): void;
  /**
   * Adds a fixed-interval task to the runtime registry.
   *
   * @param name Stable task name used for lookup and distributed lock keys.
   * @param ms Positive interval in milliseconds.
   * @param callback Task body executed on each interval tick.
   * @param options Optional task hooks, naming overrides, and distributed lock controls.
   */
  addInterval(name: string, ms: number, callback: SchedulingTaskCallback, options?: IntervalTaskOptions): void;
  /**
   * Adds a one-shot delayed task to the runtime registry.
   *
   * @param name Stable task name used for lookup and distributed lock keys.
   * @param ms Positive delay in milliseconds before the callback runs once.
   * @param callback Task body executed after the delay elapses.
   * @param options Optional task hooks, naming overrides, and distributed lock controls.
   */
  addTimeout(name: string, ms: number, callback: SchedulingTaskCallback, options?: TimeoutTaskOptions): void;
  /**
   * Removes one registered task from the runtime registry.
   *
   * @param name Task name to remove.
   * @returns `true` when a task existed and was removed.
   */
  remove(name: string): boolean;
  /**
   * Re-enables a previously disabled task.
   *
   * @param name Task name to enable.
   * @returns `true` when the task exists after the operation.
   */
  enable(name: string): boolean;
  /**
   * Disables a task without deleting its descriptor.
   *
   * @param name Task name to disable.
   * @returns `true` when the task exists after the operation.
   */
  disable(name: string): boolean;
  /**
   * Reads one task descriptor by name.
   *
   * @param name Task name to inspect.
   * @returns The current descriptor, or `undefined` when no task is registered.
   */
  get(name: string): SchedulingTaskDescriptor | undefined;
  /**
   * Lists all registered tasks.
   *
   * @returns All known task descriptors, including decorator-discovered and dynamic tasks.
   */
  getAll(): SchedulingTaskDescriptor[];
  /**
   * Replaces the cron expression for an existing cron task.
   *
   * @param name Task name to update.
   * @param expression New cron expression validated before rescheduling.
   */
  updateCronExpression(name: string, expression: string): void;
}
