import type { PlatformDiagnosticIssue, PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export interface ThrottlerPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

export type ThrottlerStoreKind = 'memory' | 'redis' | 'custom';
export type ThrottlerStoreOwnershipMode = 'framework' | 'external';
export type ThrottlerOperationMode = 'local-only' | 'distributed' | 'local-fallback' | 'custom';

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
