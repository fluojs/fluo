import type { MetadataPropertyKey, Token } from '@konekti/core';

export interface CronTaskOptions {
  distributed?: boolean;
  key?: string;
  lockTtlMs?: number;
  name?: string;
  timezone?: string;
}

export interface CronTaskMetadata {
  expression: string;
  options: CronTaskOptions;
}

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
  distributed: boolean;
  expression: string;
  lockKey: string;
  lockTtlMs: number;
  methodKey: MetadataPropertyKey;
  methodName: string;
  moduleName: string;
  taskName: string;
  timezone?: string;
  targetName: string;
  token: Token;
}
