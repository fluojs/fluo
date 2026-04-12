import { describe, expect, it } from 'vitest';

import { createQueuePlatformStatusSnapshot } from './status.js';

describe('createQueuePlatformStatusSnapshot', () => {
  it('reports ready/healthy semantics with dependency visibility', () => {
    const snapshot = createQueuePlatformStatusSnapshot({
      dependencyId: 'redis.jobs',
      lifecycleState: 'started',
      pendingDeadLetterWrites: 0,
      queuesReady: 2,
      workersDiscovered: 2,
      workersReady: 2,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      dependencies: ['redis.jobs'],
      workersDiscovered: 2,
      workersReady: 2,
    });
  });

  it('marks shutdown drain as degraded health and not-ready readiness', () => {
    const snapshot = createQueuePlatformStatusSnapshot({
      dependencyId: 'redis.default',
      lifecycleState: 'stopping',
      pendingDeadLetterWrites: 1,
      queuesReady: 1,
      workersDiscovered: 1,
      workersReady: 1,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.readiness.reason).toContain('draining');
  });
});
