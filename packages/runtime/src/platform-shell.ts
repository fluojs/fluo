import { InvariantError } from '@fluojs/core';

import type {
  PlatformComponent,
  PlatformComponentInput,
  PlatformComponentRegistration,
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformShell,
  PlatformShellSnapshot,
  PlatformSnapshot,
  PlatformValidationResult,
} from './platform-contract.js';

interface RegisteredPlatformComponent {
  component: PlatformComponent;
  dependencies: readonly string[];
}

function isRegistration(value: PlatformComponentInput): value is PlatformComponentRegistration {
  return typeof value === 'object' && value !== null && 'component' in value;
}

function normalizeRegistration(input: PlatformComponentInput): RegisteredPlatformComponent {
  if (isRegistration(input)) {
    return {
      component: input.component,
      dependencies: [...(input.dependencies ?? [])],
    };
  }

  return {
    component: input,
    dependencies: [],
  };
}

function toRegisteredComponents(components: readonly PlatformComponentInput[] | undefined): RegisteredPlatformComponent[] {
  return (components ?? []).map((component) => normalizeRegistration(component));
}

function createUnknownFailureIssue(componentId: string, phase: string, error: unknown): PlatformDiagnosticIssue {
  return {
    cause: error instanceof Error ? error.message : String(error),
    code: 'RUNTIME_PLATFORM_COMPONENT_FAILURE',
    componentId,
    fixHint: 'Inspect component implementation and ensure validate/start/ready/health/snapshot contracts are deterministic.',
    message: `Platform component failed during ${phase}.`,
    severity: 'error',
  };
}

function aggregateReadiness(reports: PlatformReadinessReport[]): PlatformReadinessReport {
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

function aggregateHealth(reports: PlatformHealthReport[]): PlatformHealthReport {
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

function createEmptyShellSnapshot(diagnostics: PlatformDiagnosticIssue[]): PlatformShellSnapshot {
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

function normalizeSnapshot(snapshot: PlatformSnapshot, component: PlatformComponent, dependencies: readonly string[]): PlatformSnapshot {
  return {
    ...snapshot,
    dependencies: [...dependencies],
    id: component.id,
    kind: component.kind,
  };
}

/**
 * A runtime implementation of the {@link PlatformShell} that manages the lifecycle
 * of registered platform components, including dependency ordering and diagnostics.
 */
export class RuntimePlatformShell implements PlatformShell {
  private started = false;
  private stopped = false;
  private orderedComponents: RegisteredPlatformComponent[] = [];
  private rollbackPendingComponents: RegisteredPlatformComponent[] = [];
  private readonly diagnostics: PlatformDiagnosticIssue[] = [];

  constructor(private readonly registeredComponents: RegisteredPlatformComponent[]) {}

  /**
   * Creates a {@link RuntimePlatformShell} from an optional array of platform component inputs.
   *
   * @param components - The platform component inputs to register in the shell.
   * @returns A new {@link RuntimePlatformShell} instance.
   */
  static fromInputs(components: readonly PlatformComponentInput[] | undefined): RuntimePlatformShell {
    return new RuntimePlatformShell(toRegisteredComponents(components));
  }

  hasRegisteredComponents(): boolean {
    return this.registeredComponents.length > 0;
  }

  async start(): Promise<void> {
    if (!this.hasRegisteredComponents() || this.started) {
      return;
    }

    if (this.rollbackPendingComponents.length > 0) {
      await this.stop();
    }

    this.validateIdentityAndDependencies();

    const validationFailures = await this.validateComponents();
    if (validationFailures.length > 0) {
      throw new InvariantError(
        `Platform shell validation failed: ${validationFailures.map((issue) => `${issue.componentId}:${issue.code}`).join(', ')}`,
      );
    }

    this.orderedComponents = this.orderByDependency();
    const startedComponents: RegisteredPlatformComponent[] = [];

    for (const component of this.orderedComponents) {
      try {
        await component.component.start();
        startedComponents.push(component);
      } catch (error) {
        this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'start', error));
        const startFailure = new InvariantError(
          `Platform component "${component.component.id}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );

        try {
          await this.stopStartedComponents(startedComponents);
          this.rollbackPendingComponents = [];
        } catch (rollbackError) {
          this.rollbackPendingComponents = [...startedComponents];
          this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'start-rollback', rollbackError));
        }

        throw startFailure;
      }
    }

    this.started = true;
    this.stopped = false;
    this.rollbackPendingComponents = [];
  }

  async stop(): Promise<void> {
    const hasRollbackPending = this.rollbackPendingComponents.length > 0;

    if ((!this.started && !hasRollbackPending) || this.stopped) {
      return;
    }

    const toStop = hasRollbackPending
      ? [...this.rollbackPendingComponents]
      : this.orderedComponents.length > 0
      ? [...this.orderedComponents]
      : [...this.registeredComponents];

    await this.stopStartedComponents(toStop);
    this.rollbackPendingComponents = [];
    this.started = false;
    this.stopped = true;
  }

  async ready(): Promise<PlatformReadinessReport> {
    if (!this.hasRegisteredComponents()) {
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
        const issue = createUnknownFailureIssue(component.component.id, 'ready', error);
        this.diagnostics.push(issue);
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
    if (!this.hasRegisteredComponents()) {
      return {
        status: 'healthy',
      };
    }

    const reports: PlatformHealthReport[] = [];

    for (const component of this.registeredComponents) {
      try {
        reports.push(await component.component.health());
      } catch (error) {
        const issue = createUnknownFailureIssue(component.component.id, 'health', error);
        this.diagnostics.push(issue);
        reports.push({
          reason: issue.cause,
          status: 'unhealthy',
        });
      }
    }

    return aggregateHealth(reports);
  }

  async snapshot(): Promise<PlatformShellSnapshot> {
    if (!this.hasRegisteredComponents()) {
      return createEmptyShellSnapshot([...this.diagnostics]);
    }

    const components: PlatformSnapshot[] = [];
    for (const registration of this.registeredComponents) {
      try {
        const snapshot = registration.component.snapshot();
        components.push(normalizeSnapshot(snapshot, registration.component, registration.dependencies));
      } catch (error) {
        const issue = createUnknownFailureIssue(registration.component.id, 'snapshot', error);
        this.diagnostics.push(issue);
        components.push({
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
        });
      }
    }

    const [readiness, health] = await Promise.all([this.ready(), this.health()]);

    return {
      components,
      diagnostics: [...this.diagnostics],
      generatedAt: new Date().toISOString(),
      health,
      readiness,
    };
  }

  async assertCriticalReadiness(): Promise<void> {
    const readiness = await this.ready();

    if (readiness.status === 'not-ready') {
      throw new InvariantError(
        `Runtime platform shell is not ready: ${readiness.reason ?? 'critical platform component is unavailable.'}`,
      );
    }
  }

  private validateIdentityAndDependencies(): void {
    const ids = new Set<string>();

    for (const registration of this.registeredComponents) {
      if (!registration.component.id || registration.component.id.trim().length === 0) {
        throw new InvariantError('Platform component id must be a non-empty string.');
      }

      if (ids.has(registration.component.id)) {
        throw new InvariantError(`Duplicate platform component id "${registration.component.id}" is not allowed.`);
      }

      ids.add(registration.component.id);
    }

    for (const registration of this.registeredComponents) {
      for (const dependency of registration.dependencies) {
        if (!ids.has(dependency)) {
          throw new InvariantError(
            `Platform component "${registration.component.id}" depends on unknown component "${dependency}".`,
          );
        }

        if (dependency === registration.component.id) {
          throw new InvariantError(
            `Platform component "${registration.component.id}" cannot depend on itself.`,
          );
        }
      }
    }
  }

  private async validateComponents(): Promise<PlatformDiagnosticIssue[]> {
    const failures: PlatformDiagnosticIssue[] = [];

    for (const registration of this.registeredComponents) {
      let result: PlatformValidationResult;

      try {
        result = await registration.component.validate();
      } catch (error) {
        const issue = createUnknownFailureIssue(registration.component.id, 'validate', error);
        this.diagnostics.push(issue);
        failures.push(issue);
        continue;
      }

      if (result.warnings) {
        this.diagnostics.push(...result.warnings);
      }

      if (!result.ok || result.issues.some((issue) => issue.severity === 'error')) {
        this.diagnostics.push(...result.issues);
        failures.push(...result.issues);
      }
    }

    return failures;
  }

  private orderByDependency(): RegisteredPlatformComponent[] {
    const byId = new Map(this.registeredComponents.map((registration) => [registration.component.id, registration]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const ordered: RegisteredPlatformComponent[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) {
        return;
      }

      if (visiting.has(id)) {
        throw new InvariantError(`Platform component dependency cycle detected at "${id}".`);
      }

      visiting.add(id);

      const registration = byId.get(id);
      if (!registration) {
        throw new InvariantError(`Platform component "${id}" is missing from runtime registration.`);
      }

      for (const dependency of registration.dependencies) {
        visit(dependency);
      }

      visiting.delete(id);
      visited.add(id);
      ordered.push(registration);
    };

    for (const registration of this.registeredComponents) {
      visit(registration.component.id);
    }

    return ordered;
  }

  private async stopStartedComponents(startedComponents: RegisteredPlatformComponent[]): Promise<void> {
    const errors: unknown[] = [];

    for (const component of [...startedComponents].reverse()) {
      try {
        await component.component.stop();
      } catch (error) {
        errors.push(error);
        this.diagnostics.push(createUnknownFailureIssue(component.component.id, 'stop', error));
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more platform components failed to stop cleanly.');
    }
  }
}

/**
 * Creates a {@link RuntimePlatformShell} instance to manage platform component lifecycles.
 *
 * @param components - The platform component inputs to register in the shell.
 * @returns A new {@link RuntimePlatformShell} instance.
 */
export function createRuntimePlatformShell(components: readonly PlatformComponentInput[] | undefined): RuntimePlatformShell {
  return RuntimePlatformShell.fromInputs(components);
}
