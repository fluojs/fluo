import type {
  PersistencePlatformStatusSnapshot,
  PlatformHealthReport,
  PlatformReadinessReport,
} from '@konekti/runtime';

type DrizzlePlatformLifecycleState = 'ready' | 'shutting-down' | 'stopped';

type DrizzlePlatformStatusSnapshotInput = {
  activeRequestTransactions: number;
  lifecycleState: DrizzlePlatformLifecycleState;
  strictTransactions: boolean;
  supportsTransaction: boolean;
};

function createReadiness(input: DrizzlePlatformStatusSnapshotInput): PlatformReadinessReport {
  if (input.lifecycleState === 'shutting-down') {
    return {
      critical: true,
      reason: 'Drizzle integration is shutting down.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Drizzle integration is stopped.',
      status: 'not-ready',
    };
  }

  if (input.strictTransactions && !input.supportsTransaction) {
    return {
      critical: true,
      reason: 'Drizzle strictTransactions is enabled but database.transaction is unavailable.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    status: 'ready',
  };
}

function createHealth(input: DrizzlePlatformStatusSnapshotInput): PlatformHealthReport {
  if (input.lifecycleState === 'stopped') {
    return {
      reason: 'Drizzle integration has been disposed.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'shutting-down') {
    return {
      reason: 'Drizzle integration is draining request transactions during shutdown.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Maps Drizzle lifecycle and transaction capability diagnostics into the shared persistence snapshot shape.
 *
 * @param input Current Drizzle ownership, readiness, and health inputs.
 * @returns Platform-facing persistence status data for diagnostics surfaces.
 */
export function createDrizzlePlatformStatusSnapshot(
  input: DrizzlePlatformStatusSnapshotInput,
): PersistencePlatformStatusSnapshot {
  return {
    details: {
      activeRequestTransactions: input.activeRequestTransactions,
      lifecycleState: input.lifecycleState,
      strictTransactions: input.strictTransactions,
      supportsTransaction: input.supportsTransaction,
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
