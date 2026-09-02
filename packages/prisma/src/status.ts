type PlatformReadinessReport = {
  checks?: Array<{ message?: string; name: string; status: 'pass' | 'fail' | 'degraded' }>;
  critical: boolean;
  reason?: string;
  status: 'ready' | 'not-ready' | 'degraded';
};

type PlatformHealthReport = {
  checks?: Array<{ message?: string; name: string; status: 'pass' | 'fail' | 'degraded' }>;
  reason?: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
};

type PersistencePlatformStatusSnapshot = {
  details: Record<string, unknown>;
  health: PlatformHealthReport;
  ownership: {
    externallyManaged: boolean;
    ownsResources: boolean;
  };
  readiness: PlatformReadinessReport;
};

type PrismaPlatformLifecycleState = 'created' | 'ready' | 'shutting-down' | 'stopped';

type PrismaPlatformStatusSnapshotInput = {
  activeTransactionBoundaries: number;
  activeRequestTransactions: number;
  lifecycleState: PrismaPlatformLifecycleState;
  strictTransactions: boolean;
  supportsConnect: boolean;
  supportsDisconnect: boolean;
  supportsTransaction: boolean;
  transactionAbortSignalSupport: 'unknown' | 'supported' | 'unsupported';
  transactionContext?: 'als' | 'unavailable';
};

function createReadiness(input: PrismaPlatformStatusSnapshotInput): PlatformReadinessReport {
  if (input.lifecycleState === 'created') {
    return {
      critical: true,
      reason: 'Prisma integration has not connected yet.',
      status: 'not-ready',
    };
  }

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

  if (input.supportsTransaction && input.transactionContext === 'unavailable') {
    return {
      critical: true,
      reason: 'Prisma transaction context requires AsyncLocalStorage support from the host runtime.',
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
 * Creates a Prisma platform status snapshot for diagnostics surfaces.
 *
 * @remarks
 * `details.activeTransactionBoundaries` reports open outer service/manual transaction boundaries that
 * shutdown drains before disconnecting. It is intentionally distinct from
 * `details.activeRequestTransactions`, which reports abort-aware request transaction activity.
 *
 * @param input Lifecycle and transaction activity inputs for the registered Prisma client.
 * @returns A snapshot containing lifecycle, health, readiness, ownership, and transaction diagnostics.
 */
export function createPrismaPlatformStatusSnapshot(
  input: PrismaPlatformStatusSnapshotInput,
): PersistencePlatformStatusSnapshot {
  const transactionContext = input.transactionContext ?? 'als';

  return {
    details: {
      activeTransactionBoundaries: input.activeTransactionBoundaries,
      activeRequestTransactions: input.activeRequestTransactions,
      lifecycleState: input.lifecycleState,
      strictTransactions: input.strictTransactions,
      supportsConnect: input.supportsConnect,
      supportsDisconnect: input.supportsDisconnect,
      supportsTransaction: input.supportsTransaction,
      transactionAbortSignalSupport: input.transactionAbortSignalSupport,
      transactionContext,
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: false,
      ownsResources: true,
    },
    readiness: createReadiness(input),
  };
}
