import type Redis from 'ioredis';
import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export interface PersistencePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

export interface RedisStatusAdapterInput {
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

export function createRedisPlatformStatusSnapshot(input: RedisStatusAdapterInput): PersistencePlatformStatusSnapshot {
  return {
    details: {
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
