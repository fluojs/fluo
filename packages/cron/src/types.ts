import type { MetadataPropertyKey, Token } from '@konekti/core';

export type SchedulingTaskKind = 'cron' | 'interval' | 'timeout';

export type SchedulingTaskCallback = () => void | Promise<void>;

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

export interface CronTaskOptions extends SchedulingTaskOptions {
  timezone?: string;
}

export type IntervalTaskOptions = SchedulingTaskOptions;

export type TimeoutTaskOptions = SchedulingTaskOptions;

export interface CronTaskMetadata {
  kind: 'cron';
  expression: string;
  options: CronTaskOptions;
}

export interface IntervalTaskMetadata {
  kind: 'interval';
  ms: number;
  options: IntervalTaskOptions;
}

export interface TimeoutTaskMetadata {
  kind: 'timeout';
  ms: number;
  options: TimeoutTaskOptions;
}

export type SchedulingTaskMetadata = CronTaskMetadata | IntervalTaskMetadata | TimeoutTaskMetadata;

export interface CronDistributedOptions {
  enabled?: boolean;
  keyPrefix?: string;
  lockTtlMs?: number;
  ownerId?: string;
}

export interface CronScheduledJob {
  stop(): void;
}

export interface CronScheduleOptions {
  name?: string;
  protect?: boolean;
  timezone?: string;
}

export type CronScheduler = (
  expression: string,
  options: CronScheduleOptions,
  callback: () => Promise<void>,
) => CronScheduledJob;

export interface CronModuleOptions {
  distributed?: boolean | CronDistributedOptions;
  scheduler?: CronScheduler;
}

export interface NormalizedCronModuleOptions {
  distributed: Required<CronDistributedOptions> & { enabled: boolean };
  scheduler: CronScheduler;
}

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

export interface SchedulingRegistry {
  addCron(name: string, expression: string, callback: SchedulingTaskCallback, options?: CronTaskOptions): void;
  addInterval(name: string, ms: number, callback: SchedulingTaskCallback, options?: IntervalTaskOptions): void;
  addTimeout(name: string, ms: number, callback: SchedulingTaskCallback, options?: TimeoutTaskOptions): void;
  remove(name: string): boolean;
  enable(name: string): boolean;
  disable(name: string): boolean;
  get(name: string): SchedulingTaskDescriptor | undefined;
  getAll(): SchedulingTaskDescriptor[];
  updateCronExpression(name: string, expression: string): void;
}
