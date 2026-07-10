import type { Constructor, Token } from '@fluojs/core';
import { Container } from '@fluojs/di';
import type { ApplicationLogger, CompiledModule, ModuleType } from '@fluojs/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueueWorker } from './decorators.js';
import { QueueLifecycleService } from './service.js';
import type { NormalizedQueueModuleOptions } from './types.js';

const bullmqState = vi.hoisted(() => ({
  failWorkerRun: false,
  queueConstructions: 0,
  workerConstructions: 0,
  workerRuns: 0,
}));

vi.mock('bullmq', () => ({
  Queue: class MockBullQueue {
    constructor() {
      bullmqState.queueConstructions += 1;
    }

    async add(): Promise<{ id: string }> {
      return { id: 'job-1' };
    }

    async close(): Promise<void> {}
  },
  Worker: class MockBullWorker {
    constructor() {
      bullmqState.workerConstructions += 1;
    }

    on(): this {
      return this;
    }

    run(): Promise<void> {
      bullmqState.workerRuns += 1;
      if (bullmqState.failWorkerRun) {
        throw new Error('worker run failed');
      }

      return Promise.resolve();
    }

    async waitUntilReady(): Promise<void> {}

    async close(): Promise<void> {}
  },
}));

class InspectionRedisFake {
  readonly records = new Map<string, string[]>();
  duplicateCalls = 0;

  duplicate() {
    this.duplicateCalls += 1;
    const connection = {
      async connect(): Promise<void> {},
      disconnect() {
        connection.status = 'end';
      },
      maxRetriesPerRequest: null,
      async quit(): Promise<'OK'> {
        connection.status = 'end';
        return 'OK';
      },
      status: 'ready',
    };

    return connection;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const entries = this.records.get(key) ?? [];
    const startIndex = start < 0 ? Math.max(entries.length + start, 0) : start;
    const stopIndex = stop < 0 ? entries.length + stop : stop;
    return entries.slice(startIndex, stopIndex + 1);
  }

  async ltrim(): Promise<'OK'> {
    return 'OK';
  }

  async rpush(): Promise<number> {
    return 1;
  }

  setRecord(jobName: string): void {
    this.records.set(`fluo:queue:dead-letter:${jobName}`, [
      JSON.stringify({
        attemptsMade: 1,
        errorMessage: 'processing failed',
        failedAt: '2026-07-10T00:00:00.000Z',
        jobId: 'job-1',
        jobName,
        payload: { target: 'invoice-1' },
      }),
    ]);
  }
}

const OPTIONS: NormalizedQueueModuleOptions = {
  defaultAttempts: 1,
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

function createCompiledModule(moduleType: ModuleType, provider: Constructor): CompiledModule {
  return {
    accessibleTokens: new Set<Token>(),
    definition: { providers: [provider] },
    exportedTokens: new Set<Token>(),
    importedExportedTokens: new Set<Token>(),
    providerTokens: new Set<Token>(),
    type: moduleType,
  };
}

function createService(redis: InspectionRedisFake, compiledModules: readonly CompiledModule[]): QueueLifecycleService {
  return new QueueLifecycleService(OPTIONS, redis, new Container(), compiledModules, LOGGER);
}

describe('QueueLifecycleService dead-letter inspection lifecycle', () => {
  beforeEach(() => {
    bullmqState.failWorkerRun = false;
    bullmqState.queueConstructions = 0;
    bullmqState.workerConstructions = 0;
    bullmqState.workerRuns = 0;
  });

  it('does not start or schedule workers when inspecting from idle', async () => {
    // Given
    class IdleInspectionJob {}

    @QueueWorker(IdleInspectionJob, { jobName: 'idle-inspection' })
    class IdleInspectionWorker {
      async handle(_job: IdleInspectionJob): Promise<void> {}
    }

    class AppModule {}

    const redis = new InspectionRedisFake();
    redis.setRecord('idle-inspection');
    const service = createService(redis, [createCompiledModule(AppModule, IdleInspectionWorker)]);

    try {
      // When
      const result = await service.inspectDeadLetters('idle-inspection');

      // Then
      expect(result.records.map((record) => record.jobId)).toEqual(['job-1']);
      expect(service.createPlatformStatusSnapshot().details.lifecycleState).toBe('idle');
      expect(redis.duplicateCalls).toBe(0);
      expect(bullmqState.queueConstructions).toBe(0);
      expect(bullmqState.workerConstructions).toBe(0);
      expect(bullmqState.workerRuns).toBe(0);
    } finally {
      await service.onApplicationShutdown();
    }
  });

  it('keeps inspection available after worker startup failure without restarting workers', async () => {
    // Given
    class FailedInspectionJob {}

    @QueueWorker(FailedInspectionJob, { jobName: 'failed-inspection' })
    class FailedInspectionWorker {
      async handle(_job: FailedInspectionJob): Promise<void> {}
    }

    class AppModule {}

    bullmqState.failWorkerRun = true;
    const redis = new InspectionRedisFake();
    redis.setRecord('failed-inspection');
    const service = createService(redis, [createCompiledModule(AppModule, FailedInspectionWorker)]);

    try {
      await service.onApplicationBootstrap();
      await vi.waitFor(() => {
        expect(service.createPlatformStatusSnapshot().details.lifecycleState).toBe('failed');
      });
      const lifecycleActivity = {
        duplicateCalls: redis.duplicateCalls,
        queueConstructions: bullmqState.queueConstructions,
        workerConstructions: bullmqState.workerConstructions,
        workerRuns: bullmqState.workerRuns,
      };

      // When
      const result = await service.inspectDeadLetters('failed-inspection');

      // Then
      expect(result.records.map((record) => record.jobId)).toEqual(['job-1']);
      expect(service.createPlatformStatusSnapshot().details.lifecycleState).toBe('failed');
      expect({
        duplicateCalls: redis.duplicateCalls,
        queueConstructions: bullmqState.queueConstructions,
        workerConstructions: bullmqState.workerConstructions,
        workerRuns: bullmqState.workerRuns,
      }).toEqual(lifecycleActivity);
    } finally {
      await service.onApplicationShutdown();
    }
  });

  it('keeps inspection available after shutdown without restarting workers', async () => {
    // Given
    const redis = new InspectionRedisFake();
    redis.setRecord('stopped-inspection');
    const service = createService(redis, []);
    await service.onApplicationShutdown();

    // When
    const result = await service.inspectDeadLetters('stopped-inspection');

    // Then
    expect(result.records.map((record) => record.jobId)).toEqual(['job-1']);
    expect(service.createPlatformStatusSnapshot().details.lifecycleState).toBe('stopped');
    expect(redis.duplicateCalls).toBe(0);
    expect(bullmqState.queueConstructions).toBe(0);
    expect(bullmqState.workerConstructions).toBe(0);
    expect(bullmqState.workerRuns).toBe(0);
  });
});
