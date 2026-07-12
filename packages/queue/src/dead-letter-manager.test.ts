import type { ApplicationLogger } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { QueueDeadLetterManager, type QueueRedisDeadLetterClient } from './dead-letter-manager.js';
import type { NormalizedQueueModuleOptions } from './types.js';

class DeadLetterRedisFake implements QueueRedisDeadLetterClient {
  readonly reads: Array<{ key: string; start: number; stop: number }> = [];

  constructor(private readonly entries: readonly string[]) {}

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    this.reads.push({ key, start, stop });
    const startIndex = start < 0 ? Math.max(this.entries.length + start, 0) : start;
    const stopIndex = stop < 0 ? this.entries.length + stop : stop;
    return this.entries.slice(startIndex, stopIndex + 1);
  }

  async ltrim(): Promise<'OK'> {
    return 'OK';
  }

  async rpush(): Promise<number> {
    return this.entries.length;
  }
}

const OPTIONS: NormalizedQueueModuleOptions = {
  defaultAttempts: 3,
  defaultConcurrency: 1,
  defaultDeadLetterMaxEntries: 1_000,
  global: true,
  workerShutdownTimeoutMs: 30_000,
};

const LOGGER: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

describe('QueueDeadLetterManager inspection', () => {
  it('returns the requested number of records in newest-first order', async () => {
    // Given
    const redis = new DeadLetterRedisFake([
      JSON.stringify({
        attemptsMade: 1,
        errorMessage: 'oldest',
        failedAt: '2026-07-10T00:00:00.000Z',
        jobId: 'job-1',
        jobName: 'invoice',
        payload: { invoiceId: 'invoice-1' },
      }),
      JSON.stringify({
        attemptsMade: 2,
        errorMessage: 'middle',
        failedAt: '2026-07-10T00:01:00.000Z',
        jobId: 'job-2',
        jobName: 'invoice',
        payload: { invoiceId: 'invoice-2' },
      }),
      JSON.stringify({
        attemptsMade: 3,
        errorMessage: 'newest',
        failedAt: '2026-07-10T00:02:00.000Z',
        jobId: 'job-3',
        jobName: 'invoice',
        payload: { invoiceId: 'invoice-3' },
      }),
    ]);
    const manager = new QueueDeadLetterManager(OPTIONS, LOGGER, () => redis);

    // When
    const result = await manager.inspect('invoice', { limit: 2 });

    // Then
    expect(result.records.map((record) => record.jobId)).toEqual(['job-3', 'job-2']);
    expect(result.malformedRecordCount).toBe(0);
    expect(redis.reads).toEqual([{ key: 'fluo:queue:dead-letter:invoice', start: -2, stop: -1 }]);
  });

  it('caps Redis reads at the public inspection maximum', async () => {
    // Given
    const redis = new DeadLetterRedisFake([]);
    const manager = new QueueDeadLetterManager(OPTIONS, LOGGER, () => redis);

    // When
    await manager.inspect('invoice', { limit: 10_000 });

    // Then
    expect(redis.reads).toEqual([{ key: 'fluo:queue:dead-letter:invoice', start: -1_000, stop: -1 }]);
  });

  it('counts and omits malformed stored records without exposing their raw values', async () => {
    // Given
    const redis = new DeadLetterRedisFake([
      '{invalid-json',
      JSON.stringify({
        attemptsMade: 1,
        errorMessage: 'wrong queue',
        failedAt: '2026-07-10T00:01:00.000Z',
        jobId: 'job-2',
        jobName: 'email',
        payload: { invoiceId: 'invoice-2' },
      }),
      JSON.stringify({
        attemptsMade: 2,
        errorMessage: 'valid',
        failedAt: '2026-07-10T00:02:00.000Z',
        jobId: 'job-3',
        jobName: 'invoice',
        payload: { invoiceId: 'invoice-3' },
      }),
    ]);
    const manager = new QueueDeadLetterManager(OPTIONS, LOGGER, () => redis);

    // When
    const result = await manager.inspect('invoice', { limit: 3 });

    // Then
    expect(result).toEqual({
      malformedRecordCount: 2,
      records: [
        {
          attemptsMade: 2,
          errorMessage: 'valid',
          failedAt: '2026-07-10T00:02:00.000Z',
          jobId: 'job-3',
          jobName: 'invoice',
          payload: { invoiceId: 'invoice-3' },
        },
      ],
    });
  });
});
