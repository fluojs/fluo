import { getQueueToken, QueueLifecycleService, type Queue } from '@fluojs/queue';
import { FluoFactory } from '@fluojs/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { startRedisFixture } from '../../../../testing/redis-native-fixture.mjs';
import {
  createQueueGuideApp,
  createQueueInspectionApp,
  ExplodeJob,
  ProcessOrderJob,
  UnregisteredOrderJob,
} from './queue-guide-app';
import { boundedWait } from './helpers';

/**
 * Native guide fixture for the Queue guide
 * (apps/docs/content/docs/packages/queue.mdx).
 *
 * Evidence scope, against a real redis:7.4-alpine server (repository fixture
 * harness, isolated container, ephemeral loopback port): constructor-identity
 * enqueue, prototype rehydration on the worker, deduplicationKey id mapping,
 * atomic enqueueMany, bootstrap lifecycle and status snapshot, runtime
 * rejections for unregistered job types, and the dead-letter record surfaced
 * through a second registration's read-only inspectDeadLetters facade.
 * Requires Docker; consistent with the repository's native suites, it fails
 * rather than skips when the fixture is unavailable.
 */

describe('queue guide fixtures: native Redis job processing', () => {
  const containerName = `fluo-docs-guides-async-work-${randomUUID()}`;
  const exec = promisify(execFile);
  let fixture: Awaited<ReturnType<typeof startRedisFixture>> | undefined;

  beforeAll(async () => {
    fixture = await startRedisFixture({
      containerName,
      diagnosticPath: resolve('.artifacts/redis-native-fixture/docs-package-guides-async-work.json'),
      execFile: exec,
      spawn,
    });
  }, 70_000);

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('closes idle workers without requiring a warmup delivery', async () => {
    const { AppModule, QueueProbe: Probe } = createQueueGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const probe = await context.get(Probe);
      expect(probe.handledJobs).toHaveLength(0);
      expect(probe.attempts).toHaveLength(0);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('enqueues by constructor identity and rehydrates the job prototype on the worker', async () => {
    const { AppModule, QueueProbe: Probe } = createQueueGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const queue = await context.get<Queue>(getQueueToken());
      const probe = await context.get(Probe);

      const jobId = await queue.enqueue(new ProcessOrderJob('order-1'));

      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);

      const handled = await boundedWait(probe.waitHandled(), 'worker handle()');
      expect(handled).toBeInstanceOf(ProcessOrderJob);
      expect(handled.orderId).toBe('order-1');

      const snapshot = await context.get(QueueLifecycleService).then((service) => service.createPlatformStatusSnapshot());
      expect(snapshot.details.lifecycleState).toBe('started');
      expect(snapshot.details.workersDiscovered).toBe(2);
      expect(snapshot.details.queuesReady).toBe(2);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('maps a repeated deduplicationKey to one backing job without a second delivery', async () => {
    const { AppModule, QueueProbe: Probe } = createQueueGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);
    const queue = await context.get<Queue>(getQueueToken());
    const probe = await context.get(Probe);

    try {
      probe.hold();
      const firstId = await queue.enqueue(new ProcessOrderJob('deduped'), { deduplicationKey: 'order:deduped' });
      const secondId = await queue.enqueue(new ProcessOrderJob('deduped'), { deduplicationKey: 'order:deduped' });

      expect(firstId.length).toBeGreaterThan(0);
      expect(secondId).toBe(firstId);

      probe.release();
      const handled = await boundedWait(probe.waitHandled(), 'deduplicated delivery');

      expect(handled.orderId).toBe('deduped');
      expect(probe.handledJobs).toHaveLength(1);
    } finally {
      probe.release();
      await context.close();
    }
  }, 30_000);

  it('persists an enqueueMany batch atomically with ids aligned to the input order', async () => {
    const { AppModule, QueueProbe: Probe } = createQueueGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const queue = await context.get<Queue>(getQueueToken());
      const probe = await context.get(Probe);

      const jobIds = await queue.enqueueMany([
        { job: new ProcessOrderJob('batch-a') },
        { job: new ProcessOrderJob('batch-b') },
      ]);

      expect(jobIds).toHaveLength(2);
      expect(jobIds.every((id) => id.length > 0)).toBe(true);

      const first = await boundedWait(probe.waitHandled(), 'batch delivery 1');
      const second = await boundedWait(probe.waitHandled(), 'batch delivery 2');

      expect(new Set([first.orderId, second.orderId])).toEqual(new Set(['batch-a', 'batch-b']));
    } finally {
      await context.close();
    }
  }, 30_000);

  it('rejects plain payloads and unregistered job classes at enqueue time', async () => {
    const { AppModule, QueueProbe: Probe } = createQueueGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);

    try {
      const queue = await context.get<Queue>(getQueueToken());
      const probe = await context.get(Probe);

      // One real delivery first proves the rejections leave a live queue intact.
      await queue.enqueue(new ProcessOrderJob('warmup'));
      const warmup = await boundedWait(probe.waitHandled(), 'warmup delivery');
      expect(warmup.orderId).toBe('warmup');

      // A plain object type-checks (TJob extends object) and is rejected at runtime.
      await expect(queue.enqueue({ orderId: 'plain' })).rejects.toThrow(
        'No @QueueWorker() registered for job type Object.',
      );
      await expect(queue.enqueue(new UnregisteredOrderJob('nope'))).rejects.toThrow(
        'No @QueueWorker() registered for job type UnregisteredOrderJob.',
      );

      // The rejections left the live queue untouched.
      expect(probe.handledJobs).toHaveLength(1);
    } finally {
      await context.close();
    }
  }, 30_000);

  it('appends a dead-letter record on terminal failure and inspects it through the facade', async () => {
    const { AppModule, QueueProbe: Probe } = createQueueGuideApp({ host: '127.0.0.1', port: fixture!.port });
    const context = await FluoFactory.createApplicationContext(AppModule);
    let failedJobId = '';

    try {
      const queue = await context.get<Queue>(getQueueToken());
      const probe = await context.get(Probe);

      failedJobId = await queue.enqueue(new ExplodeJob('attempt-marker'));

      // attempts: 1 makes this attempt terminal; the worker signals from
      // inside handle() before throwing.
      const attempt = await boundedWait(probe.waitAttempt(), 'failing attempt');

      expect(attempt.attemptMarker).toBe('attempt-marker');
      expect(probe.attempts).toHaveLength(1);
    } finally {
      // Shutdown drains pending dead-letter writes (bounded per write), so
      // the record's arrival in Redis is deterministic once close() returns.
      await context.close();
    }

    const { AppModule: InspectionAppModule } = createQueueInspectionApp({ host: '127.0.0.1', port: fixture!.port });
    const inspectionContext = await FluoFactory.createApplicationContext(InspectionAppModule);

    try {
      const inspectionQueue = await inspectionContext.get<Queue>(getQueueToken());
      const inspection = await inspectionQueue.inspectDeadLetters('ExplodeJob');

      expect(inspection.malformedRecordCount).toBe(0);
      expect(inspection.records).toHaveLength(1);

      const record = inspection.records[0];
      expect(record.jobName).toBe('ExplodeJob');
      expect(record.jobId).toBe(failedJobId);
      expect(record.attemptsMade).toBe(1);
      expect(record.errorMessage).toBe('boom');
      expect(record.payload).toEqual({ attemptMarker: 'attempt-marker' });
      expect(Number.isNaN(Date.parse(record.failedAt))).toBe(false);
    } finally {
      await inspectionContext.close();
    }
  }, 30_000);
});
