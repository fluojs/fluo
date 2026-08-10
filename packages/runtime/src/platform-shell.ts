import { InvariantError } from '@fluojs/core';

import { PlatformLifecycleConflictError, type PlatformLifecycleOperation } from './errors.js';
import {
  assertValidPlatformComponentGraph,
  orderPlatformComponents,
  type RegisteredPlatformComponent,
  registerPlatformComponents,
} from './platform-component-registry.js';
import type {
  PlatformComponentInput,
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformShell,
  PlatformShellSnapshot,
  PlatformValidationResult,
} from './platform-contract.js';
import { createPlatformFailureIssue, PlatformDiagnosticRetention } from './platform-diagnostic-retention.js';
import { PlatformShellProbeCollector } from './platform-shell-probes.js';

interface PlatformLifecycleTransition {
  readonly operation: PlatformLifecycleOperation;
}

/**
 * A runtime implementation of the {@link PlatformShell} that manages the lifecycle
 * of registered platform components, including dependency ordering and diagnostics.
 */
export class RuntimePlatformShell implements PlatformShell {
  private started = false;
  private orderedComponents: RegisteredPlatformComponent[] = [];
  private rollbackPendingComponents: RegisteredPlatformComponent[] = [];
  private readonly diagnostics = new PlatformDiagnosticRetention();
  private readonly probes: PlatformShellProbeCollector;
  private activeLifecycleTransition: PlatformLifecycleTransition | undefined;

  constructor(private readonly registeredComponents: RegisteredPlatformComponent[]) {
    this.probes = new PlatformShellProbeCollector(registeredComponents, this.diagnostics);
  }

  /**
   * Creates a {@link RuntimePlatformShell} from an optional array of platform component inputs.
   *
   * @param components - The platform component inputs to register in the shell.
   * @returns A new {@link RuntimePlatformShell} instance.
   */
  static fromInputs(components: readonly PlatformComponentInput[] | undefined): RuntimePlatformShell {
    return new RuntimePlatformShell(registerPlatformComponents(components));
  }

  hasRegisteredComponents(): boolean {
    return this.registeredComponents.length > 0;
  }

  start(): Promise<void> {
    return this.runLifecycleTransition('start', () => this.startComponents());
  }

  stop(): Promise<void> {
    return this.runLifecycleTransition('stop', () => this.stopComponents());
  }

  private runLifecycleTransition(operation: PlatformLifecycleOperation, run: () => Promise<void>): Promise<void> {
    const activeTransition = this.activeLifecycleTransition;
    if (activeTransition) {
      return Promise.reject(new PlatformLifecycleConflictError(activeTransition.operation, operation));
    }

    const transition: PlatformLifecycleTransition = { operation };
    this.activeLifecycleTransition = transition;
    const promise = Promise.resolve(run());

    const clearActiveTransition = (): void => {
      if (this.activeLifecycleTransition === transition) {
        this.activeLifecycleTransition = undefined;
      }
    };
    void promise.then(clearActiveTransition, clearActiveTransition);

    return promise;
  }

  private async startComponents(): Promise<void> {
    if (!this.hasRegisteredComponents() || this.started) {
      return;
    }

    if (this.rollbackPendingComponents.length > 0) {
      await this.stopComponents();
    }

    assertValidPlatformComponentGraph(this.registeredComponents);

    const validationFailures = await this.validateComponents();
    if (validationFailures.length > 0) {
      throw new InvariantError(
        `Platform shell validation failed: ${validationFailures.map((issue) => `${issue.componentId}:${issue.code}`).join(', ')}`,
      );
    }

    this.orderedComponents = orderPlatformComponents(this.registeredComponents);
    const startedComponents: RegisteredPlatformComponent[] = [];

    for (const component of this.orderedComponents) {
      try {
        await component.component.start();
        startedComponents.push(component);
      } catch (error) {
        this.diagnostics.append([createPlatformFailureIssue(component.component.id, 'start', error)]);
        const startFailure = new InvariantError(
          `Platform component "${component.component.id}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );

        try {
          await this.stopStartedComponents(startedComponents);
          this.rollbackPendingComponents = [];
        } catch (rollbackError) {
          this.diagnostics.append([
            createPlatformFailureIssue(component.component.id, 'start-rollback', rollbackError),
          ]);
        }

        throw startFailure;
      }
    }

    this.started = true;
    this.rollbackPendingComponents = [];
  }

  private async stopComponents(): Promise<void> {
    const hasRollbackPending = this.rollbackPendingComponents.length > 0;

    if (!this.started && !hasRollbackPending) {
      return;
    }

    const toStop = hasRollbackPending
      ? [...this.rollbackPendingComponents]
      : this.orderedComponents.length > 0
      ? [...this.orderedComponents]
      : [...this.registeredComponents];

    this.started = false;

    await this.stopStartedComponents(toStop);
    this.rollbackPendingComponents = [];
  }

  ready(): Promise<PlatformReadinessReport> {
    return this.probes.ready();
  }

  health(): Promise<PlatformHealthReport> {
    return this.probes.health();
  }

  snapshot(): Promise<PlatformShellSnapshot> {
    return this.probes.snapshot();
  }

  async assertCriticalReadiness(): Promise<void> {
    const readiness = await this.ready();

    if (readiness.status === 'not-ready') {
      throw new InvariantError(
        `Runtime platform shell is not ready: ${readiness.reason ?? 'critical platform component is unavailable.'}`,
      );
    }
  }

  private async validateComponents(): Promise<PlatformDiagnosticIssue[]> {
    const failures: PlatformDiagnosticIssue[] = [];

    for (const registration of this.registeredComponents) {
      let result: PlatformValidationResult;

      try {
        result = await registration.component.validate();
      } catch (error) {
        const issue = createPlatformFailureIssue(registration.component.id, 'validate', error);
        this.diagnostics.append([issue]);
        failures.push(issue);
        continue;
      }

      if (result.warnings) {
        this.diagnostics.append(result.warnings);
      }

      if (!result.ok || result.issues.some((issue) => issue.severity === 'error')) {
        this.diagnostics.append(result.issues);
        failures.push(...result.issues);
      }
    }

    return failures;
  }

  private async stopStartedComponents(startedComponents: RegisteredPlatformComponent[]): Promise<void> {
    const errors: unknown[] = [];
    const pendingComponents: RegisteredPlatformComponent[] = [];

    for (const component of [...startedComponents].reverse()) {
      try {
        await component.component.stop();
      } catch (error) {
        errors.push(error);
        pendingComponents.unshift(component);
        this.diagnostics.append([createPlatformFailureIssue(component.component.id, 'stop', error)]);
      }
    }

    if (errors.length > 0) {
      this.rollbackPendingComponents = pendingComponents;
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
