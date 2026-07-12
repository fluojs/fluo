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
  /** Unique registration scope for non-global queue modules that need isolated providers. */
  scope?: string;
  /** Whether queue providers should be visible globally. Defaults to `true`. */
  global?: boolean;
  defaultAttempts?: number;
  defaultBackoff?: QueueBackoffOptions;
  defaultConcurrency?: number;
  defaultDeadLetterMaxEntries?: number | false;
  defaultRateLimiter?: QueueRateLimiterOptions;
  /** Maximum time shutdown waits for active worker processors before forcing worker close. Defaults to `30_000`. */
  workerShutdownTimeoutMs?: number;
}

/** Normalized queue options resolved once during module registration. */
export interface NormalizedQueueModuleOptions {
  clientName?: string;
  scope?: string;
  defaultAttempts: number;
  defaultBackoff?: QueueBackoffOptions;
  defaultConcurrency: number;
  defaultDeadLetterMaxEntries: number | false;
  defaultRateLimiter?: QueueRateLimiterOptions;
  global: boolean;
  workerShutdownTimeoutMs: number;
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

/** Options for one read-only dead-letter inspection. */
export interface QueueDeadLetterInspectionOptions {
  /** Maximum number of stored entries to inspect. Defaults to `100` and is capped at `1_000`. */
  readonly limit?: number;
}

/** Parsed operator-facing view of one dead-letter record. */
export interface QueueDeadLetterRecord {
  readonly attemptsMade: number;
  readonly errorMessage: string;
  readonly failedAt: string;
  readonly jobId: string;
  readonly jobName: string;
  readonly payload: unknown;
}

/** Result of a bounded dead-letter inspection. */
export interface QueueDeadLetterInspectionResult {
  /** Number of malformed stored values omitted from the inspected window. */
  readonly malformedRecordCount: number;
  /** Valid records in newest-first order. */
  readonly records: readonly QueueDeadLetterRecord[];
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

  /**
   * Reads a bounded snapshot of dead-letter records for one queue job name.
   *
   * @param jobName Queue worker job name whose dead letters should be inspected.
   * @param options Optional bounded inspection settings.
   * @returns Valid records in newest-first order plus the malformed count for the inspected window.
   */
  inspectDeadLetters(
    jobName: string,
    options?: QueueDeadLetterInspectionOptions,
  ): Promise<QueueDeadLetterInspectionResult>;
}
