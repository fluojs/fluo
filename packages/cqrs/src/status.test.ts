import { describe, expect, it } from 'vitest';

import { createCqrsPlatformStatusSnapshot, type CqrsLifecycleState, type CqrsStatusAdapterInput } from './status.js';

function createCqrsInput(overrides: Partial<CqrsStatusAdapterInput> = {}): CqrsStatusAdapterInput {
  return {
    eventHandlersDiscovered: 0,
    inFlightSagaExecutions: 0,
    lifecycleState: 'created',
    sagaLifecycleState: 'created',
    sagaShutdownDrainTimeouts: 0,
    sagasDiscovered: 0,
    shutdownDrainTimeoutMs: 5000,
    shutdownDrainTimeouts: 0,
    ...overrides,
  };
}

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

  it.each<{
    healthStatus: 'degraded' | 'healthy' | 'unhealthy';
    lifecycleState: CqrsLifecycleState;
    readinessStatus: 'degraded' | 'not-ready';
  }>([
    { healthStatus: 'healthy', lifecycleState: 'created', readinessStatus: 'not-ready' },
    { healthStatus: 'degraded', lifecycleState: 'discovering', readinessStatus: 'degraded' },
    { healthStatus: 'degraded', lifecycleState: 'stopping', readinessStatus: 'not-ready' },
    { healthStatus: 'unhealthy', lifecycleState: 'stopped', readinessStatus: 'not-ready' },
    { healthStatus: 'unhealthy', lifecycleState: 'failed', readinessStatus: 'not-ready' },
  ])('reports $lifecycleState event-bus lifecycle readiness and health', ({
    healthStatus,
    lifecycleState,
    readinessStatus,
  }) => {
    const snapshot = createCqrsPlatformStatusSnapshot(createCqrsInput({
      lifecycleState,
      sagaLifecycleState: 'ready',
    }));

    expect(snapshot.readiness.status).toBe(readinessStatus);
    expect(snapshot.health.status).toBe(healthStatus);
    expect(snapshot.details.lifecycleState).toBe(lifecycleState);
  });

  it.each<{
    healthStatus: 'degraded' | 'unhealthy';
    readinessStatus: 'degraded' | 'not-ready';
    sagaLifecycleState: CqrsLifecycleState;
  }>([
    { healthStatus: 'degraded', readinessStatus: 'degraded', sagaLifecycleState: 'discovering' },
    { healthStatus: 'degraded', readinessStatus: 'not-ready', sagaLifecycleState: 'stopping' },
    { healthStatus: 'unhealthy', readinessStatus: 'not-ready', sagaLifecycleState: 'stopped' },
    { healthStatus: 'unhealthy', readinessStatus: 'not-ready', sagaLifecycleState: 'failed' },
  ])('reports $sagaLifecycleState saga lifecycle readiness and health', ({
    healthStatus,
    readinessStatus,
    sagaLifecycleState,
  }) => {
    const snapshot = createCqrsPlatformStatusSnapshot(createCqrsInput({
      lifecycleState: 'ready',
      sagaLifecycleState,
    }));

    expect(snapshot.readiness.status).toBe(readinessStatus);
    expect(snapshot.health.status).toBe(healthStatus);
    expect(snapshot.details.sagaLifecycleState).toBe(sagaLifecycleState);
  });
});
