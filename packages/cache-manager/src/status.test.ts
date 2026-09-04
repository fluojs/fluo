import { describe, expect, it } from 'vitest';

import {
  createCacheManagerPlatformDiagnosticIssues,
  createCacheManagerPlatformStatusSnapshot,
} from './status.js';

describe('createCacheManagerPlatformStatusSnapshot', () => {
  it('reports memory store as framework-owned and ready', () => {
    const snapshot = createCacheManagerPlatformStatusSnapshot({
      storeKind: 'memory',
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: false, ownsResources: true });
    expect(snapshot.readiness).toEqual({ critical: false, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      cacheCriticalPath: false,
      storeKind: 'memory',
      storeOwnershipMode: 'framework',
    });
  });

  it('reports a custom store as framework-owned when CacheService owns teardown dispatch', () => {
    // Given / When
    const snapshot = createCacheManagerPlatformStatusSnapshot({ storeKind: 'custom' });

    // Then
    expect(snapshot.ownership).toEqual({ externallyManaged: false, ownsResources: true });
    expect(snapshot.details).toMatchObject({
      storeKind: 'custom',
      storeOwnershipMode: 'framework',
    });
  });

  it('keeps the redis store externally managed when the application owns its client lifecycle', () => {
    // Given / When
    const snapshot = createCacheManagerPlatformStatusSnapshot({
      dependencyId: 'redis.cache',
      storeKind: 'redis',
    });

    // Then
    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.details).toMatchObject({
      storeKind: 'redis',
      storeOwnershipMode: 'external',
    });
  });

  it('honors an explicit ownership override when it differs from the store default', () => {
    // Given / When
    const snapshot = createCacheManagerPlatformStatusSnapshot({
      storeKind: 'custom',
      storeOwnershipMode: 'external',
    });

    // Then
    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.details).toMatchObject({ storeOwnershipMode: 'external' });
  });

  it('keeps readiness degraded (not not-ready) when cache is non-critical and backing store is down', () => {
    const snapshot = createCacheManagerPlatformStatusSnapshot({
      backingStoreReady: false,
      dependencyId: 'redis.cache',
      storeKind: 'redis',
    });

    expect(snapshot.readiness).toMatchObject({ critical: false, status: 'degraded' });
    expect(snapshot.health.status).toBe('degraded');
  });

  it('marks readiness as not-ready when cache is explicitly part of a critical path', () => {
    const snapshot = createCacheManagerPlatformStatusSnapshot({
      backingStoreReady: false,
      backingStoreReason: 'redis unavailable',
      cacheCriticalPath: true,
      storeKind: 'redis',
    });

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'redis unavailable',
      status: 'not-ready',
    });
    expect(snapshot.health).toEqual({ reason: 'redis unavailable', status: 'degraded' });
  });
});

describe('createCacheManagerPlatformDiagnosticIssues', () => {
  it('emits warning diagnostics with fixHint for non-critical cache degradation', () => {
    const issues = createCacheManagerPlatformDiagnosticIssues({
      backingStoreReady: false,
      dependencyId: 'redis.cache',
      storeKind: 'redis',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'CACHE_MANAGER_BACKING_STORE_NOT_READY',
      componentId: 'cache-manager.default',
      dependsOn: ['redis.cache'],
      severity: 'warning',
    });
    expect(issues[0]?.fixHint).toContain('cacheCriticalPath');
  });

  it('emits error diagnostics for critical-path cache readiness failures', () => {
    const issues = createCacheManagerPlatformDiagnosticIssues({
      backingStoreReady: false,
      cacheCriticalPath: true,
      storeKind: 'redis',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
  });
});
