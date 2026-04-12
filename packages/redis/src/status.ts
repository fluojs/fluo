import type Redis from 'ioredis';
import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

/** Normalized Redis platform snapshot shape used by health/readiness integrations. */
export interface PersistencePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

/** Input consumed by the Redis status adapter when translating runtime state. */
export interface RedisStatusAdapterInput {
  componentId?: string;
  status: Redis['status'];
}

const DEGRADATION_STATUSES = new Set<Redis['status']>(['wait', 'connecting', 'connect', 'reconnecting']);
const UNHEALTHY_STATUSES = new Set<Redis['status']>(['close', 'end']);

function createReadiness(input: RedisStatusAdapterInput): PlatformReadinessReport {
  if (input.status === 'ready') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.status === 'wait') {
    return {
      critical: true,
      reason: 'Redis client is still in lazyConnect wait state.',
      status: 'not-ready',
    };
  }

  if (input.status === 'connect' || input.status === 'connecting' || input.status === 'reconnecting') {
    return {
      critical: true,
      reason: `Redis client is ${input.status}.`,
      status: 'degraded',
    };
  }

  return {
    critical: true,
    reason: `Redis client is ${input.status}.`,
    status: 'not-ready',
  };
}

function createHealth(input: RedisStatusAdapterInput): PlatformHealthReport {
  if (UNHEALTHY_STATUSES.has(input.status)) {
    return {
      reason: `Redis client is ${input.status}.`,
      status: 'unhealthy',
    };
  }

  if (DEGRADATION_STATUSES.has(input.status)) {
    return {
      reason: `Redis client is ${input.status}.`,
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Adapts one Redis client status into Fluo's platform snapshot contract.
 *
 * @param input Redis client status and optional component identity.
 * @returns A normalized snapshot describing readiness, health, ownership, and details.
 */
export function createRedisPlatformStatusSnapshot(input: RedisStatusAdapterInput): PersistencePlatformStatusSnapshot {
  return {
    details: {
      componentId: input.componentId,
      connectionState: input.status,
      lazyConnect: true,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: false,
      ownsResources: true,
    },
    readiness: createReadiness(input),
  };
}
