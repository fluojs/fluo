import type { PlatformDiagnosticIssue, PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@fluojs/runtime';

/**
 * Snapshot shape produced by the throttler platform status helpers.
 */
export interface ThrottlerPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

/**
 * Backing store categories recognized by the throttler status adapter.
 */
export type ThrottlerStoreKind = 'memory' | 'redis' | 'custom';

/**
 * Ownership modes used to describe who is responsible for the throttler store lifecycle.
 */
export type ThrottlerStoreOwnershipMode = 'framework' | 'external';

/**
 * Deployment modes used to describe whether throttling is local or distributed.
 */
export type ThrottlerOperationMode = 'local-only' | 'distributed' | 'local-fallback' | 'custom';

/**
 * Input consumed by throttler status and diagnostic helpers.
 */
export interface ThrottlerStatusAdapterInput {
  componentId?: string;
  storeKind: ThrottlerStoreKind;
  storeOwnershipMode?: ThrottlerStoreOwnershipMode;
  operationMode?: ThrottlerOperationMode;
  backingStoreReady?: boolean;
  backingStoreReason?: string;
  dependencyId?: string;
  readinessCritical?: boolean;
}

function resolveStoreOwnershipMode(input: ThrottlerStatusAdapterInput): ThrottlerStoreOwnershipMode {
  if (input.storeOwnershipMode) {
    return input.storeOwnershipMode;
  }

  return input.storeKind === 'memory' ? 'framework' : 'external';
}

function resolveOperationMode(input: ThrottlerStatusAdapterInput): ThrottlerOperationMode {
  if (input.operationMode) {
    return input.operationMode;
  }

  if (input.storeKind === 'redis') {
    return 'distributed';
  }

  if (input.storeKind === 'memory') {
    return 'local-only';
  }

  return 'custom';
}

function isBackingStoreReady(input: ThrottlerStatusAdapterInput): boolean {
  if (input.backingStoreReady !== undefined) {
    return input.backingStoreReady;
  }

  return true;
}

function createReadiness(input: ThrottlerStatusAdapterInput): PlatformReadinessReport {
  const critical = input.readinessCritical ?? false;

  if (isBackingStoreReady(input)) {
    return {
      critical,
      status: 'ready',
    };
  }

  return {
    critical,
    reason: input.backingStoreReason ?? 'Throttler backing store is unavailable.',
    status: critical ? 'not-ready' : 'degraded',
  };
}

function createHealth(input: ThrottlerStatusAdapterInput): PlatformHealthReport {
  if (!isBackingStoreReady(input)) {
    return {
      reason: input.backingStoreReason ?? 'Throttler backing store is unavailable.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

/**
 * Create a platform status snapshot for throttler readiness, health, and telemetry.
 *
 * @param input Store metadata and readiness hints collected during bootstrap.
 * @returns A throttler status snapshot suitable for platform diagnostics.
 */
export function createThrottlerPlatformStatusSnapshot(input: ThrottlerStatusAdapterInput): ThrottlerPlatformStatusSnapshot {
  const storeOwnershipMode = resolveStoreOwnershipMode(input);
  const operationMode = resolveOperationMode(input);
  const backingReady = isBackingStoreReady(input);
  const componentId = input.componentId ?? 'throttler.default';

  return {
    details: {
      backingStore: {
        dependencyId: input.dependencyId,
        reason: input.backingStoreReason,
        ready: backingReady,
      },
      operationMode,
      storeKind: input.storeKind,
      storeOwnershipMode,
      telemetry: {
        labels: {
          component_id: componentId,
          component_kind: 'throttler',
          operation: 'request-throttle',
          result: backingReady ? 'ready' : 'degraded',
        },
        namespace: 'throttler',
      },
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: storeOwnershipMode === 'external',
      ownsResources: storeOwnershipMode === 'framework',
    },
    readiness: createReadiness(input),
  };
}

/**
 * Translate throttler readiness input into platform diagnostic issues.
 *
 * @param input Store metadata and readiness hints collected during bootstrap.
 * @returns Zero or more diagnostic issues describing degraded or unavailable throttler backing stores.
 */
export function createThrottlerPlatformDiagnosticIssues(input: ThrottlerStatusAdapterInput): PlatformDiagnosticIssue[] {
  if (isBackingStoreReady(input)) {
    return [];
  }

  const componentId = input.componentId ?? 'throttler.default';
  const critical = input.readinessCritical ?? false;

  return [
    {
      code: 'THROTTLER_BACKING_STORE_NOT_READY',
      componentId,
      cause: input.backingStoreReason,
      dependsOn: input.dependencyId ? [input.dependencyId] : undefined,
      fixHint: input.storeKind === 'redis'
        ? 'Verify Redis connectivity or switch to local throttler store for non-critical environments.'
        : 'Restore the throttler backing store or disable throttling for this environment.',
      message: critical
        ? 'Throttler is configured as critical, but its backing store is not ready.'
        : 'Throttler backing store is degraded; request traffic can continue in non-critical mode.',
      severity: critical ? 'error' : 'warning',
    },
  ];
}
