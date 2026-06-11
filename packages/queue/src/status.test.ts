import { describe, expect, it } from 'vitest';

import { createQueuePlatformStatusSnapshot, type QueueLifecycleState, type QueueStatusAdapterInput } from './status.js';

function createQueueInput(overrides: Partial<QueueStatusAdapterInput> = {}): QueueStatusAdapterInput {
  return {
    dependencyId: 'redis.default',
    lifecycleState: 'idle',
    pendingDeadLetterWrites: 0,
    queuesReady: 0,
    workerStartFailures: 0,
    workerShutdownTimeoutMs: 30_000,
    workersDiscovered: 0,
    workersReady: 0,
    ...overrides,
  };
}

describe('createQueuePlatformStatusSnapshot', () => {
  it('reports ready/healthy semantics with dependency visibility', () => {
    const snapshot = createQueuePlatformStatusSnapshot({
      dependencyId: 'redis.jobs',
      lifecycleState: 'started',
      pendingDeadLetterWrites: 0,
      queuesReady: 2,
      workerStartFailures: 0,
      workerShutdownTimeoutMs: 30_000,
      workersDiscovered: 2,
      workersReady: 2,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.ownership).toEqual({
      externallyManaged: false,
      ownsResources: true,
    });
    expect(snapshot.details).toMatchObject({
      deadLetterDrainTimeoutMs: 5_000,
      dependencies: ['redis.jobs'],
      queuesReady: 2,
      workerStartFailures: 0,
      workerShutdownTimeoutMs: 30_000,
      workersDiscovered: 2,
      workersReady: 2,
    });
  });

  it('marks shutdown drain as degraded health and not-ready readiness', () => {
    const snapshot = createQueuePlatformStatusSnapshot(createQueueInput({
      lifecycleState: 'stopping',
      pendingDeadLetterWrites: 1,
      queuesReady: 1,
      workersDiscovered: 1,
      workersReady: 1,
    }));

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.readiness.reason).toContain('draining');
  });

  it.each<{
    healthStatus: 'degraded' | 'unhealthy';
    lifecycleState: QueueLifecycleState;
    readinessStatus: 'degraded' | 'not-ready';
  }>([
    { healthStatus: 'unhealthy', lifecycleState: 'idle', readinessStatus: 'not-ready' },
    { healthStatus: 'degraded', lifecycleState: 'starting', readinessStatus: 'degraded' },
    { healthStatus: 'unhealthy', lifecycleState: 'stopped', readinessStatus: 'not-ready' },
  ])('reports $lifecycleState lifecycle readiness and health', ({ healthStatus, lifecycleState, readinessStatus }) => {
    const snapshot = createQueuePlatformStatusSnapshot(createQueueInput({ lifecycleState }));

    expect(snapshot.readiness.status).toBe(readinessStatus);
    expect(snapshot.health.status).toBe(healthStatus);
    expect(snapshot.details.lifecycleState).toBe(lifecycleState);
  });

  it('keeps started queues ready while dead-letter writes are still draining', () => {
    const snapshot = createQueuePlatformStatusSnapshot(createQueueInput({
      lifecycleState: 'started',
      pendingDeadLetterWrites: 2,
      queuesReady: 1,
      workersDiscovered: 1,
      workersReady: 1,
    }));

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({
      reason: 'Queue dead-letter writes are still pending.',
      status: 'degraded',
    });
  });

  it('keeps started queues degraded until discovered BullMQ processors have started', () => {
    const snapshot = createQueuePlatformStatusSnapshot(createQueueInput({
      lifecycleState: 'started',
      queuesReady: 1,
      workersDiscovered: 1,
      workersReady: 0,
    }));

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'Queue workers are waiting for BullMQ processors to start.',
      status: 'degraded',
    });
    expect(snapshot.health).toEqual({
      reason: 'Queue workers are waiting for BullMQ processors to start.',
      status: 'degraded',
    });
    expect(snapshot.details).toMatchObject({
      workerStartFailures: 0,
      workersDiscovered: 1,
      workersReady: 0,
    });
  });

  it('reports worker startup failures as not-ready and unhealthy status details', () => {
    const snapshot = createQueuePlatformStatusSnapshot(createQueueInput({
      lastWorkerStartFailure: 'worker run fail:EmailJob',
      lifecycleState: 'failed',
      queuesReady: 1,
      workerStartFailures: 1,
      workersDiscovered: 1,
      workersReady: 0,
    }));

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'Queue worker startup failed.',
      status: 'not-ready',
    });
    expect(snapshot.health).toEqual({
      reason: 'Queue worker startup failed.',
      status: 'unhealthy',
    });
    expect(snapshot.details).toMatchObject({
      lastWorkerStartFailure: 'worker run fail:EmailJob',
      lifecycleState: 'failed',
      workerStartFailures: 1,
    });
  });
});
