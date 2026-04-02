import { describe, expect, it } from 'vitest';

import {
  createThrottlerPlatformDiagnosticIssues,
  createThrottlerPlatformStatusSnapshot,
} from './status.js';

describe('createThrottlerPlatformStatusSnapshot', () => {
  it('reports distributed redis operation with external ownership when backing store is ready', () => {
    const snapshot = createThrottlerPlatformStatusSnapshot({
      componentId: 'throttler.auth',
      dependencyId: 'redis.default',
      storeKind: 'redis',
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.readiness).toEqual({ critical: false, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      operationMode: 'distributed',
      storeKind: 'redis',
      storeOwnershipMode: 'external',
      telemetry: {
        labels: {
          component_id: 'throttler.auth',
          component_kind: 'throttler',
          operation: 'request-throttle',
          result: 'ready',
        },
      },
    });
  });

  it('marks non-critical throttler readiness as degraded when backing store is unavailable', () => {
    const snapshot = createThrottlerPlatformStatusSnapshot({
      backingStoreReady: false,
      dependencyId: 'redis.default',
      storeKind: 'redis',
    });

    expect(snapshot.readiness).toMatchObject({ critical: false, status: 'degraded' });
    expect(snapshot.health.status).toBe('degraded');
  });

  it('marks critical throttler readiness as not-ready when backing store is unavailable', () => {
    const snapshot = createThrottlerPlatformStatusSnapshot({
      backingStoreReady: false,
      backingStoreReason: 'redis reconnect loop',
      readinessCritical: true,
      storeKind: 'redis',
    });

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'redis reconnect loop',
      status: 'not-ready',
    });
    expect(snapshot.health).toEqual({ reason: 'redis reconnect loop', status: 'degraded' });
  });
});

describe('createThrottlerPlatformDiagnosticIssues', () => {
  it('emits warning diagnostics with fixHint for non-critical backing-store failures', () => {
    const issues = createThrottlerPlatformDiagnosticIssues({
      backingStoreReady: false,
      dependencyId: 'redis.default',
      storeKind: 'redis',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'THROTTLER_BACKING_STORE_NOT_READY',
      componentId: 'throttler.default',
      dependsOn: ['redis.default'],
      severity: 'warning',
    });
    expect(issues[0]?.fixHint).toContain('Redis connectivity');
  });

  it('emits error diagnostics for critical throttler readiness failures', () => {
    const issues = createThrottlerPlatformDiagnosticIssues({
      backingStoreReady: false,
      readinessCritical: true,
      storeKind: 'redis',
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
  });
});
