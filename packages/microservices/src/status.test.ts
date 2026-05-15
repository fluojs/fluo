import { describe, expect, it } from 'vitest';

import {
  createMicroservicePlatformStatusSnapshot,
  type MicroserviceLifecycleState,
  type MicroserviceStatusAdapterInput,
} from './status.js';

function createStatusInput(
  overrides: Partial<MicroserviceStatusAdapterInput> = {},
): MicroserviceStatusAdapterInput {
  return {
    handlerCounts: {
      'bidi-stream': 0,
      'client-stream': 0,
      event: 0,
      message: 0,
      'server-stream': 0,
    },
    lifecycleState: 'created',
    transportCapabilities: {
      bidiStream: false,
      clientStream: false,
      emit: true,
      send: true,
      serverStream: false,
    },
    ...overrides,
  };
}

describe('createMicroservicePlatformStatusSnapshot', () => {
  it('reports ready state with transport capability visibility', () => {
    const snapshot = createMicroservicePlatformStatusSnapshot({
      handlerCounts: {
        'bidi-stream': 0,
        'client-stream': 0,
        event: 2,
        message: 1,
        'server-stream': 1,
      },
      lifecycleState: 'ready',
      transportCapabilities: {
        bidiStream: true,
        clientStream: true,
        emit: true,
        send: true,
        serverStream: true,
      },
    });

    expect(snapshot.readiness).toEqual({ critical: true, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      dependencies: ['transport.external'],
      lifecycleState: 'ready',
    });
  });

  it('marks failed listener state as not-ready/unhealthy', () => {
    const snapshot = createMicroservicePlatformStatusSnapshot(createStatusInput({
      lastListenError: 'bind EADDRINUSE',
      lifecycleState: 'failed',
    }));

    expect(snapshot.readiness.status).toBe('not-ready');
    expect(snapshot.health.status).toBe('unhealthy');
    expect(snapshot.readiness.reason).toContain('EADDRINUSE');
  });

  it.each<{
    healthReason: string | undefined;
    healthStatus: 'degraded' | 'healthy' | 'unhealthy';
    lifecycleState: MicroserviceLifecycleState;
    readinessReason: string;
    readinessStatus: 'degraded' | 'not-ready';
  }>([
    {
      healthReason: undefined,
      healthStatus: 'healthy',
      lifecycleState: 'created',
      readinessReason: 'Microservice transport listener has not started yet.',
      readinessStatus: 'not-ready',
    },
    {
      healthReason: 'Microservice transport listener is transitioning lifecycle state.',
      healthStatus: 'degraded',
      lifecycleState: 'starting',
      readinessReason: 'Microservice transport listener is still starting.',
      readinessStatus: 'degraded',
    },
    {
      healthReason: 'Microservice transport listener is transitioning lifecycle state.',
      healthStatus: 'degraded',
      lifecycleState: 'stopping',
      readinessReason: 'Microservice transport listener is shutting down.',
      readinessStatus: 'not-ready',
    },
    {
      healthReason: 'Microservice transport listener is unavailable.',
      healthStatus: 'unhealthy',
      lifecycleState: 'stopped',
      readinessReason: 'Microservice transport listener is stopped.',
      readinessStatus: 'not-ready',
    },
  ])('reports $lifecycleState lifecycle readiness and health', ({
    healthReason,
    healthStatus,
    lifecycleState,
    readinessReason,
    readinessStatus,
  }) => {
    const snapshot = createMicroservicePlatformStatusSnapshot(createStatusInput({ lifecycleState }));

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: readinessReason,
      status: readinessStatus,
    });
    expect(snapshot.health).toEqual(
      healthReason ? { reason: healthReason, status: healthStatus } : { status: healthStatus },
    );
    expect(snapshot.details.lifecycleState).toBe(lifecycleState);
    expect(snapshot.ownership).toEqual({
      externallyManaged: true,
      ownsResources: false,
    });
  });
});
