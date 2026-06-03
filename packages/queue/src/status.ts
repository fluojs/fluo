import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

/** Lifecycle phases reported by the queue platform status adapter. */
export type QueueLifecycleState = 'idle' | 'starting' | 'started' | 'stopping' | 'stopped' | 'failed';

/** Input payload used to derive queue readiness, health, and dependency details. */
export interface QueueStatusAdapterInput {
  dependencyId?: string;
  lastWorkerStartFailure?: string;
  lifecycleState: QueueLifecycleState;
  pendingDeadLetterWrites: number;
  queuesReady: number;
  workerStartFailures?: number;
  workerShutdownTimeoutMs: number;
  workersDiscovered: number;
  workersReady: number;
}

/** Queue-specific platform snapshot returned to health and readiness integrations. */
export interface QueuePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function createReadiness(input: QueueStatusAdapterInput): PlatformReadinessReport {
  const workerStartFailures = input.workerStartFailures ?? 0;

  if (input.lifecycleState === 'failed' || workerStartFailures > 0) {
    return {
      critical: true,
      reason: 'Queue worker startup failed.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'started') {
    if (input.workersReady < input.workersDiscovered) {
      return {
        critical: true,
        reason: 'Queue workers are waiting for BullMQ processors to start.',
        status: 'degraded',
      };
    }

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
  const workerStartFailures = input.workerStartFailures ?? 0;

  if (input.lifecycleState === 'failed' || workerStartFailures > 0) {
    return {
      reason: 'Queue worker startup failed.',
      status: 'unhealthy',
    };
  }

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

  if (input.lifecycleState === 'started' && input.workersReady < input.workersDiscovered) {
    return {
      reason: 'Queue workers are waiting for BullMQ processors to start.',
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

/**
 * Creates the queue platform snapshot consumed by status reporters.
 *
 * @param input Normalized queue runtime metrics and dependency information.
 * @returns Readiness, health, ownership, and queue detail fields.
 */
export function createQueuePlatformStatusSnapshot(input: QueueStatusAdapterInput): QueuePlatformStatusSnapshot {
  const workerStartFailures = input.workerStartFailures ?? 0;

  return {
    details: {
      deadLetterDrainTimeoutMs: 5_000,
      dependencies: [input.dependencyId ?? 'redis.default'],
      lifecycleState: input.lifecycleState,
      ...(input.lastWorkerStartFailure ? { lastWorkerStartFailure: input.lastWorkerStartFailure } : {}),
      pendingDeadLetterWrites: input.pendingDeadLetterWrites,
      queuesReady: input.queuesReady,
      workerStartFailures,
      workerShutdownTimeoutMs: input.workerShutdownTimeoutMs,
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
