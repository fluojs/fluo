import type { Token } from '@fluojs/core';

/** Class constructor used to identify and rehydrate one queue job payload shape. */
export interface QueueJobType<TJob extends object = object> {
  new (...args: never[]): TJob;
}

/** Supported retry backoff strategies forwarded to BullMQ workers. */
export type QueueBackoffType = 'fixed' | 'exponential';

/** Retry timing settings applied to one queued job type. */
export interface QueueBackoffOptions {
  delayMs?: number;
  type?: QueueBackoffType;
}

/** Distributed rate-limiter settings applied at the worker level. */
export interface QueueRateLimiterOptions {
  max: number;
  duration: number;
}

/**
 * Per-worker execution settings declared through {@link QueueWorker}.
 *
 * These options affect how BullMQ workers retry jobs, limit concurrency, and
 * derive the queue name used for one job class.
 */
export interface QueueWorkerOptions {
  attempts?: number;
  backoff?: QueueBackoffOptions;
  concurrency?: number;
  jobName?: string;
  rateLimiter?: QueueRateLimiterOptions;
}

/** Module-wide defaults used when individual workers omit execution settings. */
export interface QueueModuleOptions {
  clientName?: string;
  defaultAttempts?: number;
  defaultBackoff?: QueueBackoffOptions;
  defaultConcurrency?: number;
  defaultRateLimiter?: QueueRateLimiterOptions;
}

/** Normalized queue options resolved once during module registration. */
export interface NormalizedQueueModuleOptions {
  clientName?: string;
  defaultAttempts: number;
  defaultBackoff?: QueueBackoffOptions;
  defaultConcurrency: number;
  defaultRateLimiter?: QueueRateLimiterOptions;
}

/** Metadata captured by {@link QueueWorker} during decorator evaluation. */
export interface QueueWorkerMetadata {
  jobType: QueueJobType;
  options: QueueWorkerOptions;
}

/** Discovered runtime descriptor for one registered queue worker. */
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

/** Queue facade exposed to application code and compatibility tokens. */
export interface Queue {
  /**
   * Enqueues one job instance for the worker registered against its class.
   *
   * @param job Job instance whose constructor identifies the target worker.
   * @returns The BullMQ job id generated for the enqueued payload.
   */
  enqueue<TJob extends object>(job: TJob): Promise<string>;
}
