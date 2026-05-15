import { describe, expect, it } from 'vitest';

import { createCronPlatformStatusSnapshot, type CronLifecycleState, type CronStatusAdapterInput } from './status.js';

function createCronInput(overrides: Partial<CronStatusAdapterInput> = {}): CronStatusAdapterInput {
  return {
    activeTicks: 0,
    distributedEnabled: false,
    enabledTasks: 0,
    lifecycleState: 'created',
    lockOwnershipLosses: 0,
    lockRenewalFailures: 0,
    ownedLocks: 0,
    redisDependencyResolved: false,
    runningTasks: 0,
    totalTasks: 0,
    ...overrides,
  };
}

describe('createCronPlatformStatusSnapshot', () => {
  it('reports distributed dependency edge and ready/healthy state', () => {
    const snapshot = createCronPlatformStatusSnapshot({
      activeTicks: 0,
      dependencyId: 'redis.locks',
      distributedEnabled: true,
      enabledTasks: 2,
      lifecycleState: 'ready',
      lockOwnershipLosses: 0,
      lockRenewalFailures: 0,
      ownedLocks: 1,
      redisDependencyResolved: true,
      runningTasks: 1,
      totalTasks: 3,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      dependencies: ['redis.locks'],
      distributedEnabled: true,
      totalTasks: 3,
    });
  });

  it('marks lock renewal failures as degraded health', () => {
    const snapshot = createCronPlatformStatusSnapshot({
      activeTicks: 0,
      dependencyId: 'redis.default',
      distributedEnabled: true,
      enabledTasks: 1,
      lifecycleState: 'ready',
      lockOwnershipLosses: 1,
      lockRenewalFailures: 1,
      ownedLocks: 0,
      redisDependencyResolved: true,
      runningTasks: 0,
      totalTasks: 1,
    });

    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.readiness.status).toBe('ready');
  });

  it.each<{
    healthStatus: 'degraded' | 'healthy' | 'unhealthy';
    lifecycleState: CronLifecycleState;
    readinessStatus: 'degraded' | 'not-ready';
  }>([
    { healthStatus: 'healthy', lifecycleState: 'created', readinessStatus: 'not-ready' },
    { healthStatus: 'degraded', lifecycleState: 'starting', readinessStatus: 'degraded' },
    { healthStatus: 'degraded', lifecycleState: 'stopping', readinessStatus: 'not-ready' },
    { healthStatus: 'unhealthy', lifecycleState: 'stopped', readinessStatus: 'not-ready' },
    { healthStatus: 'unhealthy', lifecycleState: 'failed', readinessStatus: 'not-ready' },
  ])('reports $lifecycleState lifecycle readiness and health', ({ healthStatus, lifecycleState, readinessStatus }) => {
    const snapshot = createCronPlatformStatusSnapshot(createCronInput({ lifecycleState }));

    expect(snapshot.readiness.status).toBe(readinessStatus);
    expect(snapshot.health.status).toBe(healthStatus);
    expect(snapshot.details.lifecycleState).toBe(lifecycleState);
  });

  it('marks distributed cron not-ready when the Redis dependency is unresolved', () => {
    const snapshot = createCronPlatformStatusSnapshot(createCronInput({
      distributedEnabled: true,
      lifecycleState: 'ready',
      redisDependencyResolved: false,
    }));

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'Distributed cron mode requires a ready Redis lock client.',
      status: 'not-ready',
    });
    expect(snapshot.health).toEqual({ status: 'healthy' });
  });
});
