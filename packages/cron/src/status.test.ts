import { describe, expect, it } from 'vitest';

import { createCronPlatformStatusSnapshot } from './status.js';

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
});
