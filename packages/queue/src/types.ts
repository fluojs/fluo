import type { Token } from '@konekti/core';

export interface QueueJobType<TJob extends object = object> {
  new (...args: never[]): TJob;
}

export type QueueBackoffType = 'fixed' | 'exponential';

export interface QueueBackoffOptions {
  delayMs?: number;
  type?: QueueBackoffType;
}

export interface QueueRateLimiterOptions {
  max: number;
  duration: number;
}

export interface QueueWorkerOptions {
  attempts?: number;
  backoff?: QueueBackoffOptions;
  concurrency?: number;
  jobName?: string;
  rateLimiter?: QueueRateLimiterOptions;
}

export interface QueueModuleOptions {
  defaultAttempts?: number;
  defaultBackoff?: QueueBackoffOptions;
  defaultConcurrency?: number;
  defaultRateLimiter?: QueueRateLimiterOptions;
}

export interface NormalizedQueueModuleOptions {
  defaultAttempts: number;
  defaultBackoff?: QueueBackoffOptions;
  defaultConcurrency: number;
  defaultRateLimiter?: QueueRateLimiterOptions;
}

export interface QueueWorkerMetadata {
  jobType: QueueJobType;
  options: QueueWorkerOptions;
}

export interface QueueWorkerDescriptor {
  attempts: number;
  backoff?: QueueBackoffOptions;
  concurrency: number;
  jobName: string;
  jobType: QueueJobType;
  moduleName: string;
  rateLimiter?: QueueRateLimiterOptions;
  token: Token;
  workerName: string;
}

export interface Queue {
  enqueue<TJob extends object>(job: TJob): Promise<string>;
}
