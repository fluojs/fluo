import { describe, expect, it } from 'vitest';

import {
  createPassportPlatformDiagnosticIssues,
  createPassportPlatformStatusSnapshot,
} from './status.js';

describe('createPassportPlatformStatusSnapshot', () => {
  it('reports ready status with explicit policy boundary when registry and presets are ready', () => {
    const snapshot = createPassportPlatformStatusSnapshot({
      defaultStrategy: 'jwt',
      registeredStrategies: ['jwt', 'cookie'],
    });

    expect(snapshot.ownership).toEqual({ externallyManaged: true, ownsResources: false });
    expect(snapshot.readiness).toEqual({ critical: false, status: 'ready' });
    expect(snapshot.health).toEqual({ status: 'healthy' });
    expect(snapshot.details).toMatchObject({
      policyBoundary: {
        applicationOwned: expect.arrayContaining(['login credential validation']),
        frameworkOwned: expect.arrayContaining(['strategy execution and guard contract']),
      },
      strategyRegistry: {
        defaultStrategy: 'jwt',
        hasStrategies: true,
      },
    });
  });

  it('keeps non-critical readiness degraded for missing strategy registration and preset readiness', () => {
    const snapshot = createPassportPlatformStatusSnapshot({
      cookiePresetEnabled: true,
      cookiePresetReady: false,
      defaultStrategy: 'jwt',
      registeredStrategies: [],
    });

    expect(snapshot.readiness.status).toBe('degraded');
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.readiness.reason).toContain('No auth strategies are registered.');
    expect(snapshot.readiness.reason).toContain('Cookie auth preset is enabled but not ready.');
  });

  it('marks readiness as not-ready for critical refresh-token dependency failures', () => {
    const snapshot = createPassportPlatformStatusSnapshot({
      defaultStrategy: 'refresh-token',
      readinessCritical: true,
      refreshTokenDependencyId: 'redis.auth-refresh',
      refreshTokenEnabled: true,
      refreshTokenStoreReady: false,
      refreshTokenStoreReason: 'refresh token store reconnect loop',
      registeredStrategies: ['refresh-token'],
    });

    expect(snapshot.readiness).toEqual({
      critical: true,
      reason: 'refresh token store reconnect loop',
      status: 'not-ready',
    });
    expect(snapshot.details).toMatchObject({
      presets: {
        refreshToken: {
          backingStore: {
            dependencyId: 'redis.auth-refresh',
            ready: false,
          },
        },
      },
    });
  });
});

describe('createPassportPlatformDiagnosticIssues', () => {
  it('emits warning diagnostics for non-critical registry/preset/dependency problems', () => {
    const issues = createPassportPlatformDiagnosticIssues({
      cookiePresetEnabled: true,
      cookiePresetReady: false,
      defaultStrategy: 'jwt',
      refreshTokenDependencyId: 'redis.auth-refresh',
      refreshTokenEnabled: true,
      refreshTokenStoreReady: false,
      registeredStrategies: [],
    });

    expect(issues).toHaveLength(4);
    expect(issues.map((issue) => issue.code)).toEqual([
      'AUTH_PASSPORT_STRATEGY_REGISTRY_EMPTY',
      'AUTH_PASSPORT_DEFAULT_STRATEGY_NOT_REGISTERED',
      'AUTH_PASSPORT_COOKIE_PRESET_NOT_READY',
      'AUTH_PASSPORT_REFRESH_TOKEN_BACKING_STORE_NOT_READY',
    ]);
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(issues[3]?.dependsOn).toEqual(['redis.auth-refresh']);
  });

  it('emits error diagnostics for critical readiness failures', () => {
    const issues = createPassportPlatformDiagnosticIssues({
      defaultStrategy: 'jwt',
      readinessCritical: true,
      registeredStrategies: [],
    });

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
  });
});
