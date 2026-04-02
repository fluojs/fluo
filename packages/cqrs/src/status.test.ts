import { describe, expect, it } from 'vitest';

import { createCqrsPlatformStatusSnapshot } from './status.js';

describe('createCqrsPlatformStatusSnapshot', () => {
  it('reports ready pipeline with explicit event-bus dependency edge', () => {
    const snapshot = createCqrsPlatformStatusSnapshot({
      eventHandlersDiscovered: 2,
      inFlightSagaExecutions: 0,
      lifecycleState: 'ready',
      sagaLifecycleState: 'ready',
      sagasDiscovered: 1,
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      dependencies: ['event-bus.default'],
      eventHandlersDiscovered: 2,
      sagasDiscovered: 1,
    });
  });

  it('marks saga drain as not-ready/degraded', () => {
    const snapshot = createCqrsPlatformStatusSnapshot({
      eventHandlersDiscovered: 1,
      inFlightSagaExecutions: 2,
      lifecycleState: 'ready',
      sagaLifecycleState: 'stopping',
      sagasDiscovered: 1,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
  });
});
