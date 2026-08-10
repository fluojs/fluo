import type { RegisteredPlatformComponent } from './platform-component-registry.js';
import type {
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformShellSnapshot,
  PlatformSnapshot,
} from './platform-contract.js';
import {
  createPlatformFailureIssue,
  type PlatformDiagnosticRetention,
  type PlatformProbePhase,
} from './platform-diagnostic-retention.js';
import {
  aggregateHealth,
  aggregateReadiness,
  createEmptyShellSnapshot,
  createFailedPlatformSnapshot,
  normalizeSnapshot,
} from './platform-shell-probe-reports.js';

interface PlatformProbeDiagnostic {
  readonly issue: PlatformDiagnosticIssue;
  readonly phase: PlatformProbePhase;
}

interface PlatformSnapshotProbeResult {
  readonly diagnostics: PlatformProbeDiagnostic[];
  readonly health: PlatformHealthReport;
  readonly readiness: PlatformReadinessReport;
  readonly snapshot: PlatformSnapshot;
}

interface PlatformSnapshotResult {
  readonly diagnostics: PlatformProbeDiagnostic[];
  readonly snapshot: PlatformSnapshot;
}

interface PlatformReadinessResult {
  readonly diagnostics: PlatformProbeDiagnostic[];
  readonly readiness: PlatformReadinessReport;
}

interface PlatformHealthResult {
  readonly diagnostics: PlatformProbeDiagnostic[];
  readonly health: PlatformHealthReport;
}

export class PlatformShellProbeCollector {
  constructor(
    private readonly registeredComponents: readonly RegisteredPlatformComponent[],
    private readonly diagnostics: PlatformDiagnosticRetention,
  ) {}

  async ready(): Promise<PlatformReadinessReport> {
    if (this.registeredComponents.length === 0) {
      return {
        critical: false,
        status: 'ready',
      };
    }

    const reports: PlatformReadinessReport[] = [];

    for (const component of this.registeredComponents) {
      try {
        reports.push(await component.component.ready());
      } catch (error) {
        const issue = createPlatformFailureIssue(component.component.id, 'ready', error);
        this.diagnostics.retainProbe('ready', issue);
        reports.push({
          critical: true,
          reason: issue.cause,
          status: 'not-ready',
        });
      }
    }

    return aggregateReadiness(reports);
  }

  async health(): Promise<PlatformHealthReport> {
    if (this.registeredComponents.length === 0) {
      return {
        status: 'healthy',
      };
    }

    const reports: PlatformHealthReport[] = [];

    for (const component of this.registeredComponents) {
      try {
        reports.push(await component.component.health());
      } catch (error) {
        const issue = createPlatformFailureIssue(component.component.id, 'health', error);
        this.diagnostics.retainProbe('health', issue);
        reports.push({
          reason: issue.cause,
          status: 'unhealthy',
        });
      }
    }

    return aggregateHealth(reports);
  }

  async snapshot(): Promise<PlatformShellSnapshot> {
    if (this.registeredComponents.length === 0) {
      return createEmptyShellSnapshot(this.diagnostics.toArray());
    }

    const probeResults = await Promise.all(
      this.registeredComponents.map((registration) => this.collectSnapshotProbe(registration)),
    );
    const components = probeResults.map((result) => result.snapshot);
    const readiness = aggregateReadiness(probeResults.map((result) => result.readiness));
    const health = aggregateHealth(probeResults.map((result) => result.health));
    for (const result of probeResults) {
      for (const diagnostic of result.diagnostics) {
        this.diagnostics.retainProbe(diagnostic.phase, diagnostic.issue);
      }
    }

    return {
      components,
      diagnostics: this.diagnostics.toArray(),
      generatedAt: new Date().toISOString(),
      health,
      readiness,
    };
  }

  private async collectSnapshotProbe(
    registration: RegisteredPlatformComponent,
  ): Promise<PlatformSnapshotProbeResult> {
    const [snapshot, readiness, health] = await Promise.all([
      this.collectComponentSnapshot(registration),
      this.collectComponentReadiness(registration),
      this.collectComponentHealth(registration),
    ]);

    return {
      diagnostics: [...snapshot.diagnostics, ...readiness.diagnostics, ...health.diagnostics],
      health: health.health,
      readiness: readiness.readiness,
      snapshot: snapshot.snapshot,
    };
  }

  private collectComponentSnapshot(registration: RegisteredPlatformComponent): PlatformSnapshotResult {
    try {
      const snapshot = registration.component.snapshot();
      return {
        diagnostics: [],
        snapshot: normalizeSnapshot(snapshot, registration),
      };
    } catch (error) {
      const issue = createPlatformFailureIssue(registration.component.id, 'snapshot', error);
      return {
        diagnostics: [{ issue, phase: 'snapshot' }],
        snapshot: createFailedPlatformSnapshot(registration, issue),
      };
    }
  }

  private async collectComponentReadiness(
    registration: RegisteredPlatformComponent,
  ): Promise<PlatformReadinessResult> {
    try {
      return {
        diagnostics: [],
        readiness: await registration.component.ready(),
      };
    } catch (error) {
      const issue = createPlatformFailureIssue(registration.component.id, 'ready', error);
      return {
        diagnostics: [{ issue, phase: 'ready' }],
        readiness: {
          critical: true,
          reason: issue.cause,
          status: 'not-ready',
        },
      };
    }
  }

  private async collectComponentHealth(registration: RegisteredPlatformComponent): Promise<PlatformHealthResult> {
    try {
      return {
        diagnostics: [],
        health: await registration.component.health(),
      };
    } catch (error) {
      const issue = createPlatformFailureIssue(registration.component.id, 'health', error);
      return {
        diagnostics: [{ issue, phase: 'health' }],
        health: {
          reason: issue.cause,
          status: 'unhealthy',
        },
      };
    }
  }
}
