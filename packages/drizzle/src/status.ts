import type { PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export interface PersistencePlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

export type DrizzleLifecycleState = 'ready' | 'shutting-down' | 'stopped';

export interface DrizzleStatusAdapterInput {
  activeRequestTransactions: number;
  lifecycleState: DrizzleLifecycleState;
  strictTransactions: boolean;
  supportsTransaction: boolean;
}

function createReadiness(input: DrizzleStatusAdapterInput): PlatformReadinessReport {
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

function createHealth(input: DrizzleStatusAdapterInput): PlatformHealthReport {
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

export function createDrizzlePlatformStatusSnapshot(input: DrizzleStatusAdapterInput): PersistencePlatformStatusSnapshot {
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
