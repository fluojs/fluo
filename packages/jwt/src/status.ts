/**
 * Describes the readiness state exposed by JWT.
 */
export interface JwtPlatformReadinessReport {
  critical: boolean;
  reason?: string;
  status: 'ready' | 'not-ready' | 'degraded';
  checks?: JwtPlatformCheckResult[];
}

/**
 * Describes the health state exposed by JWT.
 */
export interface JwtPlatformHealthReport {
  reason?: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks?: JwtPlatformCheckResult[];
}

/**
 * Describes one named readiness or health probe result exposed by JWT.
 */
export interface JwtPlatformCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'degraded';
  message?: string;
}

/**
 * Describes ownership of JWT-managed resources.
 */
export interface JwtPlatformOwnership {
  externallyManaged: boolean;
  ownsResources: boolean;
}

/**
 * Describes a JWT diagnostic issue.
 */
export interface JwtPlatformDiagnosticIssue {
  cause?: string;
  code: string;
  componentId: string;
  dependsOn?: string[];
  docsUrl?: string;
  fixHint?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Describes the jwt platform status snapshot contract.
 */
export interface JwtPlatformStatusSnapshot {
  details: Record<string, unknown>;
  health: JwtPlatformHealthReport;
  ownership: JwtPlatformOwnership;
  readiness: JwtPlatformReadinessReport;
}

/**
 * Describes the jwt status adapter input contract.
 */
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

function createReadiness(input: JwtStatusAdapterInput): JwtPlatformReadinessReport {
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

function createHealth(input: JwtStatusAdapterInput): JwtPlatformHealthReport {
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

/**
 * Create jwt platform status snapshot.
 *
 * @param input The input.
 * @returns The create jwt platform status snapshot result.
 */
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

/**
 * Create jwt platform diagnostic issues.
 *
 * @param input The input.
 * @returns The create jwt platform diagnostic issues result.
 */
export function createJwtPlatformDiagnosticIssues(input: JwtStatusAdapterInput): JwtPlatformDiagnosticIssue[] {
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
