import { describe, expect, it } from 'vitest';

import {
  createJwtPlatformDiagnosticIssues,
  createJwtPlatformStatusSnapshot,
} from './status.js';

describe('createJwtPlatformStatusSnapshot', () => {
  it('reports ready status with explicit policy-boundary details by default', () => {
    const snapshot = createJwtPlatformStatusSnapshot({
      signingKeySource: 'jwks',
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.readiness).toEqual({ critical: false, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      policyBoundary: {
        applicationOwned: expect.arrayContaining(['session lifecycle policy']),
        frameworkOwned: expect.arrayContaining(['jwt sign/verify primitives']),
      },
      refreshToken: {
        enabled: false,
      },
      signingKeySource: 'jwks',
    });
  });

  it('keeps non-critical readiness degraded when refresh backing store is unavailable', () => {
    const snapshot = createJwtPlatformStatusSnapshot({
      refreshTokenDependencyId: 'redis.auth-refresh',
      refreshTokenEnabled: true,
      refreshTokenStoreReady: false,
    });

    expect(snapshot.readiness).toMatchObject({ critical: false, status: 'degraded' });
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.details).toMatchObject({
      refreshToken: {
        backingStore: {
          dependencyId: 'redis.auth-refresh',
          ready: false,
        },
      },
    });
  });

  it('marks readiness as not-ready for critical refresh-token dependency failures', () => {
    const snapshot = createJwtPlatformStatusSnapshot({
      readinessCritical: true,
      refreshTokenEnabled: true,
      refreshTokenStoreReady: false,
      refreshTokenStoreReason: 'refresh token store reconnect loop',
    });

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'refresh token store reconnect loop',
      status: 'not-ready',
    });
    expect(snapshot.health).toEqual({
      reason: 'refresh token store reconnect loop',
      status: 'degraded',
    });
  });
});

describe('createJwtPlatformDiagnosticIssues', () => {
  it('emits warning diagnostics with dependency edges for non-critical refresh-token degradation', () => {
    const issues = createJwtPlatformDiagnosticIssues({
      refreshTokenDependencyId: 'redis.auth-refresh',
      refreshTokenEnabled: true,
      refreshTokenStoreReady: false,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'AUTH_JWT_REFRESH_TOKEN_BACKING_STORE_NOT_READY',
      componentId: 'jwt.default',
      dependsOn: ['redis.auth-refresh'],
      severity: 'warning',
    });
    expect(issues[0]?.fixHint).toContain('disable refresh token mode');
  });

  it('emits error diagnostics for critical refresh-token readiness failures', () => {
    const issues = createJwtPlatformDiagnosticIssues({
      readinessCritical: true,
      refreshTokenEnabled: true,
      refreshTokenStoreReady: false,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('error');
  });
});
