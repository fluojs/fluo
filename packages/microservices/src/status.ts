import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export type MicroserviceLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface MicroserviceHandlerCounts {
  'bidi-stream': number;
  'client-stream': number;
  event: number;
  message: number;
  'server-stream': number;
}

export interface MicroserviceTransportCapabilities {
  bidiStream: boolean;
  clientStream: boolean;
  emit: boolean;
  send: boolean;
  serverStream: boolean;
}

export interface MicroserviceStatusAdapterInput {
  handlerCounts: MicroserviceHandlerCounts;
  lastListenError?: string;
  lifecycleState: MicroserviceLifecycleState;
  transportCapabilities: MicroserviceTransportCapabilities;
}

export interface MicroservicePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function createReadiness(input: MicroserviceStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'starting') {
    return {
      critical: true,
      reason: 'Microservice transport listener is still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'failed') {
    return {
      critical: true,
      reason: input.lastListenError ?? 'Microservice transport listener failed to start.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopping') {
    return {
      critical: true,
      reason: 'Microservice transport listener is shutting down.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Microservice transport listener is stopped.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Microservice transport listener has not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: MicroserviceStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'failed' || input.lifecycleState === 'stopped') {
    return {
      reason: input.lastListenError ?? 'Microservice transport listener is unavailable.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'starting' || input.lifecycleState === 'stopping') {
    return {
      reason: 'Microservice transport listener is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createMicroservicePlatformStatusSnapshot(
  input: MicroserviceStatusAdapterInput,
): MicroservicePlatformStatusSnapshot {
  return {
    details: {
      dependencies: ['transport.external'],
      handlerCounts: {
        ...input.handlerCounts,
      },
      lastListenError: input.lastListenError,
      lifecycleState: input.lifecycleState,
      transportCapabilities: {
        ...input.transportCapabilities,
      },
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: true,
      ownsResources: false,
    },
    readiness: createReadiness(input),
  };
}
