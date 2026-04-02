import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export type CqrsLifecycleState = 'created' | 'discovering' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface CqrsStatusAdapterInput {
  eventHandlersDiscovered: number;
  inFlightSagaExecutions: number;
  lifecycleState: CqrsLifecycleState;
  sagaLifecycleState: CqrsLifecycleState;
  sagasDiscovered: number;
}

export interface CqrsPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function createReadiness(input: CqrsStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready' && input.sagaLifecycleState === 'ready') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'discovering' || input.sagaLifecycleState === 'discovering') {
    return {
      critical: true,
      reason: 'CQRS handlers are still being discovered.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping' || input.sagaLifecycleState === 'stopping') {
    return {
      critical: true,
      reason: 'CQRS event/saga pipeline is draining.',
      status: 'not-ready',
    };
  }

  if (
    input.lifecycleState === 'failed' ||
    input.sagaLifecycleState === 'failed' ||
    input.lifecycleState === 'stopped' ||
    input.sagaLifecycleState === 'stopped'
  ) {
    return {
      critical: true,
      reason: 'CQRS event/saga pipeline is unavailable.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'CQRS event/saga pipeline has not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: CqrsStatusAdapterInput): PlatformHealthReport {
  if (
    input.lifecycleState === 'failed' ||
    input.sagaLifecycleState === 'failed' ||
    input.lifecycleState === 'stopped' ||
    input.sagaLifecycleState === 'stopped'
  ) {
    return {
      reason: 'CQRS event/saga pipeline is unavailable.',
      status: 'unhealthy',
    };
  }

  if (
    input.lifecycleState === 'discovering' ||
    input.sagaLifecycleState === 'discovering' ||
    input.lifecycleState === 'stopping' ||
    input.sagaLifecycleState === 'stopping'
  ) {
    return {
      reason: 'CQRS event/saga pipeline is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createCqrsPlatformStatusSnapshot(input: CqrsStatusAdapterInput): CqrsPlatformStatusSnapshot {
  return {
    details: {
      dependencies: ['event-bus.default'],
      eventHandlersDiscovered: input.eventHandlersDiscovered,
      inFlightSagaExecutions: input.inFlightSagaExecutions,
      lifecycleState: input.lifecycleState,
      sagaLifecycleState: input.sagaLifecycleState,
      sagasDiscovered: input.sagasDiscovered,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: false,
      ownsResources: false,
    },
    readiness: createReadiness(input),
  };
}
