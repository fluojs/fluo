import type {
  PersistencePlatformStatusSnapshot,
  PlatformHealthReport,
  PlatformReadinessReport,
} from '@fluojs/runtime';

type MongoosePlatformLifecycleState = 'ready' | 'shutting-down' | 'stopped';

/**
 * Input values used to create a Mongoose persistence platform status snapshot.
 */
export type MongoosePlatformStatusSnapshotInput = {
  activeRequestTransactions: number;
  activeSessions: number;
  hasActiveSession: boolean;
  lifecycleState: MongoosePlatformLifecycleState;
  strictTransactions: boolean;
  supportsConnectionTransaction: boolean;
  supportsStartSession: boolean;
};

function createReadiness(input: MongoosePlatformStatusSnapshotInput): PlatformReadinessReport {
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

  if (input.strictTransactions && !input.supportsStartSession && !input.supportsConnectionTransaction) {
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

function createHealth(input: MongoosePlatformStatusSnapshotInput): PlatformHealthReport {
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

/**
 * Maps Mongoose lifecycle and session capability diagnostics into the shared persistence snapshot shape.
 *
 * @param input Current Mongoose ownership, readiness, and health inputs.
 * @returns Platform-facing persistence status data for diagnostics surfaces.
 */
export function createMongoosePlatformStatusSnapshot(
  input: MongoosePlatformStatusSnapshotInput,
): PersistencePlatformStatusSnapshot {
  return {
    details: {
      activeRequestTransactions: input.activeRequestTransactions,
      activeSessions: input.activeSessions,
      hasActiveSession: input.hasActiveSession,
      lifecycleState: input.lifecycleState,
      sessionStrategy: input.supportsStartSession || input.supportsConnectionTransaction ? 'explicit-session' : 'none',
      strictTransactions: input.strictTransactions,
      supportsConnectionTransaction: input.supportsConnectionTransaction,
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
