import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

export type CronLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface CronStatusAdapterInput {
  activeTicks: number;
  distributedEnabled: boolean;
  enabledTasks: number;
  lifecycleState: CronLifecycleState;
  lockOwnershipLosses: number;
  lockRenewalFailures: number;
  ownedLocks: number;
  redisDependencyResolved: boolean;
  runningTasks: number;
  totalTasks: number;
}

export interface CronPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

function createReadiness(input: CronStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'ready') {
    if (input.distributedEnabled && !input.redisDependencyResolved) {
      return {
        critical: true,
        reason: 'Distributed cron mode requires a ready Redis lock client.',
        status: 'not-ready',
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
      reason: 'Cron scheduler is still starting.',
      status: 'degraded',
    };
  }

  if (input.lifecycleState === 'stopping') {
    return {
      critical: true,
      reason: 'Cron scheduler is draining active ticks.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Cron scheduler is stopped.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'failed') {
    return {
      critical: true,
      reason: 'Cron scheduler failed to initialize.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    reason: 'Cron scheduler has not started yet.',
    status: 'not-ready',
  };
}

function createHealth(input: CronStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'failed' || input.lifecycleState === 'stopped') {
    return {
      reason: 'Cron scheduler is unavailable.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'starting' || input.lifecycleState === 'stopping') {
    return {
      reason: 'Cron scheduler is transitioning lifecycle state.',
      status: 'degraded',
    };
  }

  if (input.lockRenewalFailures > 0 || input.lockOwnershipLosses > 0) {
    return {
      reason: 'Distributed cron lock renewal reported recoverable failures.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createCronPlatformStatusSnapshot(input: CronStatusAdapterInput): CronPlatformStatusSnapshot {
  return {
    details: {
      activeTicks: input.activeTicks,
      dependencies: input.distributedEnabled ? ['redis.default'] : [],
      distributedEnabled: input.distributedEnabled,
      enabledTasks: input.enabledTasks,
      lifecycleState: input.lifecycleState,
      lockOwnershipLosses: input.lockOwnershipLosses,
      lockRenewalFailures: input.lockRenewalFailures,
      ownedLocks: input.ownedLocks,
      redisDependencyResolved: input.redisDependencyResolved,
      runningTasks: input.runningTasks,
      totalTasks: input.totalTasks,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: false,
      ownsResources: true,
    },
    readiness: createReadiness(input),
  };
}
