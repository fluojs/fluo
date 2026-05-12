import { describe, expect, it } from 'vitest';

import { createCqrsPlatformStatusSnapshot } from './status.js';

describe('createCqrsPlatformStatusSnapshot', () => {
  it('reports ready pipeline with explicit event-bus dependency edge', () => {
    const snapshot = createCqrsPlatformStatusSnapshot({
      eventHandlersDiscovered: 2,
      inFlightSagaExecutions: 0,
      lifecycleState: 'ready',
      sagaLifecycleState: 'ready',
      sagaShutdownDrainTimeouts: 0,
      sagasDiscovered: 1,
      shutdownDrainTimeoutMs: 5000,
      shutdownDrainTimeouts: 0,
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
      sagaShutdownDrainTimeouts: 0,
      sagasDiscovered: 1,
      shutdownDrainTimeoutMs: 5000,
      shutdownDrainTimeouts: 0,
    });

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('degraded');
  });

  it('reports bounded shutdown drain timeouts as degraded health diagnostics', () => {
    const snapshot = createCqrsPlatformStatusSnapshot({
      eventHandlersDiscovered: 1,
      inFlightSagaExecutions: 0,
      lifecycleState: 'ready',
      sagaLifecycleState: 'ready',
      sagaShutdownDrainTimeouts: 1,
      sagasDiscovered: 1,
      shutdownDrainTimeoutMs: 20,
      shutdownDrainTimeouts: 1,
    });

    expect(snapshot.health).toEqual({
      reason: 'CQRS event/saga pipeline reported bounded shutdown drain timeouts.',
      status: 'degraded',
    });
    expect(snapshot.details).toMatchObject({
      sagaShutdownDrainTimeouts: 1,
      shutdownDrainTimeoutMs: 20,
      shutdownDrainTimeouts: 1,
    });
  });
});
