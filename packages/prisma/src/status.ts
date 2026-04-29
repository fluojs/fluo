import type {
  PersistencePlatformStatusSnapshot,
  PlatformHealthReport,
  PlatformReadinessReport,
} from '@fluojs/runtime';

type PrismaPlatformLifecycleState = 'created' | 'ready' | 'shutting-down' | 'stopped';

type PrismaPlatformStatusSnapshotInput = {
  activeRequestTransactions: number;
  lifecycleState: PrismaPlatformLifecycleState;
  strictTransactions: boolean;
  supportsConnect: boolean;
  supportsDisconnect: boolean;
  supportsTransaction: boolean;
  transactionAbortSignalSupport: 'unknown' | 'supported' | 'unsupported';
};

function createReadiness(input: PrismaPlatformStatusSnapshotInput): PlatformReadinessReport {
  if (input.lifecycleState === 'shutting-down') {
    return {
      critical: true,
      reason: 'Prisma integration is shutting down.',
      status: 'not-ready',
    };
  }

  if (input.lifecycleState === 'stopped') {
    return {
      critical: true,
      reason: 'Prisma integration is stopped.',
      status: 'not-ready',
    };
  }

  if (input.strictTransactions && !input.supportsTransaction) {
    return {
      critical: true,
      reason: 'Prisma strictTransactions is enabled but client.$transaction is unavailable.',
      status: 'not-ready',
    };
  }

  return {
    critical: true,
    status: 'ready',
  };
}

function createHealth(input: PrismaPlatformStatusSnapshotInput): PlatformHealthReport {
  if (input.lifecycleState === 'stopped') {
    return {
      reason: 'Prisma integration has been disconnected.',
      status: 'unhealthy',
    };
  }

  if (input.lifecycleState === 'shutting-down') {
    return {
      reason: 'Prisma integration is draining request transactions during shutdown.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Create prisma platform status snapshot.
 *
 * @param input The input.
 * @returns The create prisma platform status snapshot result.
 */
export function createPrismaPlatformStatusSnapshot(
  input: PrismaPlatformStatusSnapshotInput,
): PersistencePlatformStatusSnapshot {
  return {
    details: {
      activeRequestTransactions: input.activeRequestTransactions,
      lifecycleState: input.lifecycleState,
      strictTransactions: input.strictTransactions,
      supportsConnect: input.supportsConnect,
      supportsDisconnect: input.supportsDisconnect,
      supportsTransaction: input.supportsTransaction,
      transactionAbortSignalSupport: input.transactionAbortSignalSupport,
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
