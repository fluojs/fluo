import type { PlatformDiagnosticIssue, PlatformHealthReport, PlatformReadinessReport, PlatformSnapshot } from '@konekti/runtime';

export interface CacheManagerPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

export type CacheManagerStoreKind = 'memory' | 'redis' | 'custom';
export type CacheManagerStoreOwnershipMode = 'framework' | 'external';

export interface CacheManagerStatusAdapterInput {
  componentId?: string;
  storeKind: CacheManagerStoreKind;
  storeOwnershipMode?: CacheManagerStoreOwnershipMode;
  backingStoreReady?: boolean;
  backingStoreReason?: string;
  dependencyId?: string;
  cacheCriticalPath?: boolean;
}

function resolveStoreOwnershipMode(input: CacheManagerStatusAdapterInput): CacheManagerStoreOwnershipMode {
  if (input.storeOwnershipMode) {
    return input.storeOwnershipMode;
  }

  return input.storeKind === 'memory' ? 'framework' : 'external';
}

function isBackingStoreReady(input: CacheManagerStatusAdapterInput): boolean {
  if (input.backingStoreReady !== undefined) {
    return input.backingStoreReady;
  }

  return true;
}

function createReadiness(input: CacheManagerStatusAdapterInput): PlatformReadinessReport {
  const critical = input.cacheCriticalPath ?? false;

  if (isBackingStoreReady(input)) {
    return {
      critical,
      status: 'ready',
    };
  }

  return {
    critical,
    reason: input.backingStoreReason ?? 'Cache backing store is unavailable.',
    status: critical ? 'not-ready' : 'degraded',
  };
}

function createHealth(input: CacheManagerStatusAdapterInput): PlatformHealthReport {
  if (!isBackingStoreReady(input)) {
    return {
      reason: input.backingStoreReason ?? 'Cache backing store is unavailable.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createCacheManagerPlatformStatusSnapshot(input: CacheManagerStatusAdapterInput): CacheManagerPlatformStatusSnapshot {
  const storeOwnershipMode = resolveStoreOwnershipMode(input);
  const backingReady = isBackingStoreReady(input);
  const componentId = input.componentId ?? 'cache-manager.default';

  return {
    details: {
      backingStore: {
        dependencyId: input.dependencyId,
        reason: input.backingStoreReason,
        ready: backingReady,
      },
      cacheCriticalPath: input.cacheCriticalPath ?? false,
      storeKind: input.storeKind,
      storeOwnershipMode,
      telemetry: {
        labels: {
          component_id: componentId,
          component_kind: 'cache-manager',
          operation: 'cache-availability',
          result: backingReady ? 'ready' : 'degraded',
        },
        namespace: 'cache-manager',
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

export function createCacheManagerPlatformDiagnosticIssues(input: CacheManagerStatusAdapterInput): PlatformDiagnosticIssue[] {
  if (isBackingStoreReady(input)) {
    return [];
  }

  const componentId = input.componentId ?? 'cache-manager.default';
  const critical = input.cacheCriticalPath ?? false;

  return [
    {
      code: 'CACHE_MANAGER_BACKING_STORE_NOT_READY',
      componentId,
      cause: input.backingStoreReason,
      dependsOn: input.dependencyId ? [input.dependencyId] : undefined,
      fixHint: input.storeKind === 'redis'
        ? 'Verify Redis connectivity, or treat cache as non-critical by keeping cacheCriticalPath disabled.'
        : 'Restore cache backing store availability or disable cache-critical readiness requirements.',
      message: critical
        ? 'Cache manager is part of a declared critical path, but the backing store is not ready.'
        : 'Cache backing store is degraded; request handling can continue with cache misses in non-critical mode.',
      severity: critical ? 'error' : 'warning',
    },
  ];
}
