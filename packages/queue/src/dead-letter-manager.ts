import { cloneWithFallback } from '@fluojs/core/internal';
import type { ApplicationLogger } from '@fluojs/runtime';

import { normalizePositiveInteger, withTimeout } from './helpers.js';
import type { NormalizedQueueModuleOptions, QueueWorkerDescriptor } from './types.js';

const DEAD_LETTER_DRAIN_TIMEOUT_MS = 5_000;

type QueuePayload = Record<string, unknown>;

/**
 * Describes the queue dead letter job contract.
 */
export interface QueueDeadLetterJob {
  attemptsMade: number;
  data: unknown;
  finishedOn?: number;
  id?: string;
  opts: {
    attempts?: number;
  };
}

/**
 * Describes the queue redis dead letter client contract.
 */
export interface QueueRedisDeadLetterClient {
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  rpush(key: string, value: string): Promise<unknown>;
}

/**
 * Represents the queue dead letter manager.
 */
export class QueueDeadLetterManager {
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(
    private readonly options: NormalizedQueueModuleOptions,
    private readonly logger: ApplicationLogger,
    private readonly getRedisClient: () => QueueRedisDeadLetterClient,
  ) {}

  get pendingWriteCount(): number {
    return this.pendingWrites.size;
  }

  trackTerminalFailure(descriptor: QueueWorkerDescriptor, job: QueueDeadLetterJob | undefined, error: Error): void {
    if (!job || !this.isTerminalFailure(job, descriptor.attempts)) {
      return;
    }

    const pendingWrite = this.appendDeadLetterRecord(descriptor, job, error);
    this.pendingWrites.add(pendingWrite);
    pendingWrite.finally(() => {
      this.pendingWrites.delete(pendingWrite);
    });
  }

  async drainPendingWrites(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      await Promise.allSettled(
        Array.from(this.pendingWrites).map(async (write) => {
          try {
            await withTimeout(write, DEAD_LETTER_DRAIN_TIMEOUT_MS, () => new Error('dead-letter write timed out'));
          } catch (error) {
            this.pendingWrites.delete(write);
            this.logger.error(
              'Dead-letter write did not complete within shutdown timeout.',
              error,
              'QueueLifecycleService',
            );
          }
        }),
      );
    }
  }

  private async appendDeadLetterRecord(
    descriptor: QueueWorkerDescriptor,
    job: QueueDeadLetterJob,
    error: Error,
  ): Promise<void> {
    try {
      const key = deadLetterKey(descriptor.jobName);
      const deadLetter = {
        attemptsMade: job.attemptsMade,
        errorMessage: error.message,
        failedAt: new Date(job.finishedOn ?? Date.now()).toISOString(),
        jobId: job.id ?? '',
        jobName: descriptor.jobName,
        payload: isQueuePayload(job.data) ? cloneWithFallback(job.data) : job.data,
      };

      const redis = this.getRedisClient();
      await redis.rpush(key, JSON.stringify(deadLetter));

      if (this.options.defaultDeadLetterMaxEntries !== false) {
        await redis.ltrim(key, -this.options.defaultDeadLetterMaxEntries, -1);
      }
    } catch (deadLetterError) {
      this.logger.error(
        `Failed to append dead-letter record for queue job ${descriptor.jobName}.`,
        deadLetterError,
        'QueueLifecycleService',
      );
    }
  }

  private isTerminalFailure(job: QueueDeadLetterJob, attemptsFallback: number): boolean {
    const configuredAttempts =
      typeof job.opts.attempts === 'number' && Number.isFinite(job.opts.attempts)
        ? normalizePositiveInteger(job.opts.attempts, attemptsFallback)
        : attemptsFallback;

    return job.attemptsMade >= configuredAttempts;
  }
}

function deadLetterKey(jobName: string): string {
  return `fluo:queue:dead-letter:${jobName}`;
}

function isQueuePayload(value: unknown): value is QueuePayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
