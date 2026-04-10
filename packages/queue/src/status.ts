import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

export type QueueLifecycleState = 'idle' | 'starting' | 'started' | 'stopping' | 'stopped';

export interface QueueStatusAdapterInput {
  lifecycleState: QueueLifecycleState;
  pendingDeadLetterWrites: number;
  queuesReady: number;
  workersDiscovered: number;
  workersReady: number;
}

export interface QueuePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function createReadiness(input: QueueStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'started') {
    return {
      critical: true,
      status: 'ready',
    };
  }

  if (input.lifecycleState === 'starting') {
    return {
      critical: true,
      reason: 'Queue workers are still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping') {
    return {
      critical: true,
      reason: 'Queue workers are draining during shutdown.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Queue workers are stopped.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Queue workers are not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: QueueStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'stopped') {
    return {
      reason: 'Queue workers are stopped.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'starting') {
    return {
      reason: 'Queue workers are still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping') {
    return {
      reason: 'Queue workers are draining during shutdown.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'started' && input.pendingDeadLetterWrites > 0) {
    return {
      reason: 'Queue dead-letter writes are still pending.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'idle') {
    return {
      reason: 'Queue workers are idle before startup.',
      status: 'unhealthy',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createQueuePlatformStatusSnapshot(input: QueueStatusAdapterInput): QueuePlatformStatusSnapshot {
  return {
    details: {
      deadLetterDrainTimeoutMs: 5_000,
      dependencies: ['redis.default'],
      lifecycleState: input.lifecycleState,
      pendingDeadLetterWrites: input.pendingDeadLetterWrites,
      queuesReady: input.queuesReady,
      workersDiscovered: input.workersDiscovered,
      workersReady: input.workersReady,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: false,
      ownsResources: true,
    },
    readiness: createReadiness(input),
  };
}
