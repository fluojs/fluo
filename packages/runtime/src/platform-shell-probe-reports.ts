import type { RegisteredPlatformComponent } from './platform-component-registry.js';
import type {
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformShellSnapshot,
  PlatformSnapshot,
} from './platform-contract.js';

export function aggregateReadiness(reports: readonly PlatformReadinessReport[]): PlatformReadinessReport {
  const hasCriticalNotReady = reports.some((report) => report.critical && report.status === 'not-ready');
  const hasNotReady = reports.some((report) => report.status === 'not-ready');
  const hasDegraded = reports.some((report) => report.status === 'degraded');
  const hasCritical = reports.some((report) => report.critical);

  if (hasCriticalNotReady) {
    const reason = reports.find((report) => report.critical && report.status === 'not-ready')?.reason;
    return {
      critical: hasCritical,
      reason: reason ?? 'One or more critical platform components are not ready.',
      status: 'not-ready',
    };
  }

  if (hasNotReady || hasDegraded) {
    const reason = reports.find((report) => report.status !== 'ready')?.reason;
    return {
      critical: hasCritical,
      reason: reason ?? 'One or more platform components are degraded or not ready.',
      status: 'degraded',
    };
  }

  return {
    critical: hasCritical,
    status: 'ready',
  };
}

export function aggregateHealth(reports: readonly PlatformHealthReport[]): PlatformHealthReport {
  const hasUnhealthy = reports.some((report) => report.status === 'unhealthy');
  const hasDegraded = reports.some((report) => report.status === 'degraded');

  if (hasUnhealthy) {
    const reason = reports.find((report) => report.status === 'unhealthy')?.reason;
    return {
      reason: reason ?? 'One or more platform components are unhealthy.',
      status: 'unhealthy',
    };
  }

  if (hasDegraded) {
    const reason = reports.find((report) => report.status === 'degraded')?.reason;
    return {
      reason: reason ?? 'One or more platform components are degraded.',
      status: 'degraded',
    };
  }

  return {
    status: 'healthy',
  };
}

export function createEmptyShellSnapshot(diagnostics: PlatformDiagnosticIssue[]): PlatformShellSnapshot {
  return {
    components: [],
    diagnostics,
    generatedAt: new Date().toISOString(),
    health: {
      status: 'healthy',
    },
    readiness: {
      critical: false,
      status: 'ready',
    },
  };
}

export function normalizeSnapshot(
  snapshot: PlatformSnapshot,
  registration: RegisteredPlatformComponent,
): PlatformSnapshot {
  return {
    ...snapshot,
    dependencies: [...registration.dependencies],
    id: registration.component.id,
    kind: registration.component.kind,
  };
}

export function createFailedPlatformSnapshot(
  registration: RegisteredPlatformComponent,
  issue: PlatformDiagnosticIssue,
): PlatformSnapshot {
  return {
    dependencies: [...registration.dependencies],
    details: {},
    health: {
      reason: issue.cause,
      status: 'unhealthy',
    },
    id: registration.component.id,
    kind: registration.component.kind,
    ownership: {
      externallyManaged: false,
      ownsResources: false,
    },
    readiness: {
      critical: true,
      reason: issue.cause,
      status: 'not-ready',
    },
    state: 'failed',
    telemetry: {
      namespace: 'fluo.platform',
      tags: {},
    },
  };
}
