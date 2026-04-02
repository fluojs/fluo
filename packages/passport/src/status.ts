import type {
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
} from '@konekti/runtime';

export interface PassportPlatformStatusSnapshot {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformSnapshot['ownership'];
  details: Record<string, unknown>;
}

export interface PassportStatusAdapterInput {
  componentId?: string;
  readinessCritical?: boolean;
  registeredStrategies: string[];
  defaultStrategy?: string;
  cookiePresetEnabled?: boolean;
  cookiePresetReady?: boolean;
  refreshTokenEnabled?: boolean;
  refreshTokenStoreReady?: boolean;
  refreshTokenStoreReason?: string;
  refreshTokenDependencyId?: string;
}

function hasRegisteredStrategies(input: PassportStatusAdapterInput): boolean {
  return input.registeredStrategies.length > 0;
}

function hasDefaultStrategyMismatch(input: PassportStatusAdapterInput): boolean {
  if (!input.defaultStrategy) {
    return false;
  }

  return !input.registeredStrategies.includes(input.defaultStrategy);
}

function isCookiePresetReady(input: PassportStatusAdapterInput): boolean {
  if (!input.cookiePresetEnabled) {
    return true;
  }

  return input.cookiePresetReady ?? true;
}

function isRefreshTokenStoreReady(input: PassportStatusAdapterInput): boolean {
  if (!input.refreshTokenEnabled) {
    return true;
  }

  return input.refreshTokenStoreReady ?? true;
}

function collectReadinessReasons(input: PassportStatusAdapterInput): string[] {
  const reasons: string[] = [];

  if (!hasRegisteredStrategies(input)) {
    reasons.push('No auth strategies are registered.');
  }

  if (hasDefaultStrategyMismatch(input)) {
    reasons.push(`Default strategy "${input.defaultStrategy}" is not registered.`);
  }

  if (!isCookiePresetReady(input)) {
    reasons.push('Cookie auth preset is enabled but not ready.');
  }

  if (!isRefreshTokenStoreReady(input)) {
    reasons.push(input.refreshTokenStoreReason ?? 'Refresh token backing store is unavailable.');
  }

  return reasons;
}

function createReadiness(input: PassportStatusAdapterInput): PlatformReadinessReport {
  const critical = input.readinessCritical ?? false;
  const reasons = collectReadinessReasons(input);

  if (reasons.length === 0) {
    return {
      critical,
      status: 'ready',
    };
  }

  return {
    critical,
    reason: reasons.join(' '),
    status: critical ? 'not-ready' : 'degraded',
  };
}

function createHealth(input: PassportStatusAdapterInput): PlatformHealthReport {
  const reasons = collectReadinessReasons(input);

  if (reasons.length === 0) {
    return {
      status: 'healthy',
    };
  }

  return {
    reason: reasons.join(' '),
    status: 'degraded',
  };
}

export function createPassportPlatformStatusSnapshot(input: PassportStatusAdapterInput): PassportPlatformStatusSnapshot {
  const componentId = input.componentId ?? 'passport.default';
  const degraded = collectReadinessReasons(input).length > 0;

  return {
    details: {
      policyBoundary: {
        applicationOwned: [
          'login credential validation',
          'session persistence and consent policy',
          'account upsert or merge ownership',
        ],
        frameworkOwned: [
          'strategy execution and guard contract',
          'cookie auth preset primitives',
          'refresh token strategy bridge and lifecycle contract',
        ],
      },
      presets: {
        cookieAuth: {
          enabled: input.cookiePresetEnabled ?? false,
          ready: isCookiePresetReady(input),
        },
        refreshToken: {
          backingStore: {
            dependencyId: input.refreshTokenDependencyId,
            reason: input.refreshTokenStoreReason,
            ready: isRefreshTokenStoreReady(input),
          },
          enabled: input.refreshTokenEnabled ?? false,
        },
      },
      strategyRegistry: {
        defaultStrategy: input.defaultStrategy,
        hasStrategies: hasRegisteredStrategies(input),
        registeredStrategies: input.registeredStrategies,
      },
      telemetry: {
        labels: {
          component_id: componentId,
          component_kind: 'passport',
          operation: 'auth-strategy-dispatch',
          result: degraded ? 'degraded' : 'ready',
        },
        namespace: 'passport',
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

export function createPassportPlatformDiagnosticIssues(input: PassportStatusAdapterInput): PlatformDiagnosticIssue[] {
  const componentId = input.componentId ?? 'passport.default';
  const critical = input.readinessCritical ?? false;
  const severity: PlatformDiagnosticIssue['severity'] = critical ? 'error' : 'warning';
  const issues: PlatformDiagnosticIssue[] = [];

  if (!hasRegisteredStrategies(input)) {
    issues.push({
      code: 'AUTH_PASSPORT_STRATEGY_REGISTRY_EMPTY',
      componentId,
      fixHint: 'Register at least one auth strategy via createPassportProviders(..., strategies).',
      message: 'Passport strategy registry has no registered auth strategies.',
      severity,
    });
  }

  if (hasDefaultStrategyMismatch(input)) {
    issues.push({
      code: 'AUTH_PASSPORT_DEFAULT_STRATEGY_NOT_REGISTERED',
      componentId,
      fixHint: 'Register the default strategy token or change defaultStrategy to a registered strategy name.',
      message: `Passport default strategy "${input.defaultStrategy}" is not present in the strategy registry.`,
      severity,
    });
  }

  if (!isCookiePresetReady(input)) {
    issues.push({
      code: 'AUTH_PASSPORT_COOKIE_PRESET_NOT_READY',
      componentId,
      fixHint: 'Ensure cookie auth preset providers are registered and cookie options are configured for this environment.',
      message: 'Cookie auth preset is enabled but cannot accept authentication traffic safely.',
      severity,
    });
  }

  if (!isRefreshTokenStoreReady(input)) {
    issues.push({
      code: 'AUTH_PASSPORT_REFRESH_TOKEN_BACKING_STORE_NOT_READY',
      componentId,
      cause: input.refreshTokenStoreReason,
      dependsOn: input.refreshTokenDependencyId ? [input.refreshTokenDependencyId] : undefined,
      fixHint: 'Restore refresh token backing store readiness, or disable refresh-token strategy for this environment.',
      message: 'Refresh token strategy is enabled, but its backing dependency is not ready.',
      severity,
    });
  }

  return issues;
}
