import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

/**
 * Defines the microservice lifecycle state type.
 */
export type MicroserviceLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

/**
 * Describes the microservice handler counts contract.
 */
export interface MicroserviceHandlerCounts {
  'bidi-stream': number;
  'client-stream': number;
  event: number;
  message: number;
  'server-stream': number;
}

/**
 * Describes the microservice transport capabilities contract.
 */
export interface MicroserviceTransportCapabilities {
  bidiStream: boolean;
  clientStream: boolean;
  emit: boolean;
  send: boolean;
  serverStream: boolean;
}

/**
 * Describes the microservice status adapter input contract.
 */
export interface MicroserviceStatusAdapterInput {
  handlerCounts: MicroserviceHandlerCounts;
  lastListenError?: string;
  lifecycleState: MicroserviceLifecycleState;
  transportCapabilities: MicroserviceTransportCapabilities;
}

/**
 * Describes the microservice platform status snapshot contract.
 */
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

/**
 * Create microservice platform status snapshot.
 *
 * @param input The input.
 * @returns The create microservice platform status snapshot result.
 */
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
