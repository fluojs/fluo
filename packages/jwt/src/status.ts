interface PlatformReadinessReport {
  status: 'ready' | 'not-ready' | 'degraded';
  critical: boolean;
  reason?: string;
}

interface PlatformHealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  reason?: string;
}

interface PlatformDiagnosticIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  componentId: string;
  message: string;
  cause?: string;
  fixHint?: string;
  dependsOn?: string[];
}

interface PlatformOwnership {
  ownsResources: boolean;
  externallyManaged: boolean;
}

export interface JwtPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformOwnership;
  details: Record<string, unknown>;
}

export interface JwtStatusAdapterInput {
  componentId?: string;
  readinessCritical?: boolean;
  refreshTokenEnabled?: boolean;
  refreshTokenStoreReady?: boolean;
  refreshTokenStoreReason?: string;
  refreshTokenDependencyId?: string;
  signingKeySource?: 'shared-secret' | 'key-pair' | 'jwks' | 'key-provider';
}

function isRefreshTokenStoreReady(input: JwtStatusAdapterInput): boolean {
  if (!input.refreshTokenEnabled) {
    return true;
  }

  return input.refreshTokenStoreReady ?? true;
}

function createReadiness(input: JwtStatusAdapterInput): PlatformReadinessReport {
  const critical = input.readinessCritical ?? false;

  if (isRefreshTokenStoreReady(input)) {
    return {
      critical,
      status: 'ready',
    };
  }

  return {
    critical,
    reason: input.refreshTokenStoreReason ?? 'JWT refresh token backing store is unavailable.',
    status: critical ? 'not-ready' : 'degraded',
  };
}

function createHealth(input: JwtStatusAdapterInput): PlatformHealthReport {
  if (isRefreshTokenStoreReady(input)) {
    return {
      status: 'healthy',
    };
  }

  return {
    reason: input.refreshTokenStoreReason ?? 'JWT refresh token backing store is unavailable.',
    status: 'degraded',
  };
}

export function createJwtPlatformStatusSnapshot(input: JwtStatusAdapterInput): JwtPlatformStatusSnapshot {
  const componentId = input.componentId ?? 'jwt.default';
  const refreshStoreReady = isRefreshTokenStoreReady(input);

  return {
    details: {
      policyBoundary: {
        applicationOwned: [
          'login credential validation',
          'session lifecycle policy',
          'consent and account linking orchestration',
        ],
        frameworkOwned: [
          'jwt sign/verify primitives',
          'claim normalization',
          'refresh token primitive lifecycle',
        ],
      },
      refreshToken: {
        backingStore: {
          dependencyId: input.refreshTokenDependencyId,
          reason: input.refreshTokenStoreReason,
          ready: refreshStoreReady,
        },
        enabled: input.refreshTokenEnabled ?? false,
      },
      signingKeySource: input.signingKeySource ?? 'shared-secret',
      telemetry: {
        labels: {
          component_id: componentId,
          component_kind: 'jwt',
          operation: 'token-verify',
          result: refreshStoreReady ? 'ready' : 'degraded',
        },
        namespace: 'jwt',
      },
    },
    health: createHealth(input),
    ownership: {
      externallyManaged: true,
      ownsResources: false,
    },
    readiness: createReadiness(input),
  };
}

export function createJwtPlatformDiagnosticIssues(input: JwtStatusAdapterInput): PlatformDiagnosticIssue[] {
  if (isRefreshTokenStoreReady(input)) {
    return [];
  }

  const componentId = input.componentId ?? 'jwt.default';
  const critical = input.readinessCritical ?? false;

  return [
    {
      code: 'AUTH_JWT_REFRESH_TOKEN_BACKING_STORE_NOT_READY',
      componentId,
      cause: input.refreshTokenStoreReason,
      dependsOn: input.refreshTokenDependencyId ? [input.refreshTokenDependencyId] : undefined,
      fixHint: 'Restore refresh-token store connectivity or disable refresh token mode for this environment.',
      message: critical
        ? 'JWT refresh token mode is configured as critical, but its backing store is not ready.'
        : 'JWT refresh token backing store is degraded; access-token verification remains available.',
      severity: critical ? 'error' : 'warning',
    },
  ];
}
