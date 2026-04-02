import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export interface PersistencePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

export type MongooseLifecycleState = 'ready' | 'shutting-down' | 'stopped';

export interface MongooseStatusAdapterInput {
  activeRequestTransactions: number;
  hasActiveSession: boolean;
  lifecycleState: MongooseLifecycleState;
  strictTransactions: boolean;
  supportsStartSession: boolean;
}

function createReadiness(input: MongooseStatusAdapterInput): PlatformReadinessReport {
  if (input.lifecycleState === 'shutting-down') {
    return {
      critical: true,
      reason: 'Mongoose integration is shutting down.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Mongoose integration is stopped.',
      status: 'not-ready',
    };
  }

  if (input.strictTransactions && !input.supportsStartSession) {
    return {
      critical: true,
      reason: 'Mongoose strictTransactions is enabled but connection.startSession is unavailable.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    status: 'ready',
  };
}

function createHealth(input: MongooseStatusAdapterInput): PlatformHealthReport {
  if (input.lifecycleState === 'stopped') {
    return {
      reason: 'Mongoose integration has been disposed.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'shutting-down') {
    return {
      reason: 'Mongoose integration is draining request transactions during shutdown.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createMongoosePlatformStatusSnapshot(input: MongooseStatusAdapterInput): PersistencePlatformStatusSnapshot {
  return {
    details: {
      activeRequestTransactions: input.activeRequestTransactions,
      hasActiveSession: input.hasActiveSession,
      lifecycleState: input.lifecycleState,
      sessionStrategy: input.supportsStartSession ? 'explicit-session' : 'none',
      strictTransactions: input.strictTransactions,
      supportsStartSession: input.supportsStartSession,
      transactionContext: 'als',
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: true,
      ownsResources: false,
    },
    readiness: createReadiness(input),
  };
}
