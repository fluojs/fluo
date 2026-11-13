import type { PlatformDiagnosticIssue } from './platform-contract.js';

export type PlatformProbePhase = 'health' | 'ready' | 'snapshot';
export type PlatformDiagnosticPhase = PlatformProbePhase | 'start' | 'start-rollback' | 'stop' | 'validate';

export function createPlatformFailureIssue(
  componentId: string,
  phase: PlatformDiagnosticPhase,
  error: unknown,
): PlatformDiagnosticIssue {
  return {
    cause: error instanceof Error ? error.message : String(error),
    code: 'RUNTIME_PLATFORM_COMPONENT_FAILURE',
    componentId,
    fixHint: 'Inspect component implementation and ensure validate/start/ready/health/snapshot contracts are deterministic.',
    message: `Platform component failed during ${phase}.`,
    severity: 'error',
  };
}

export function createPlatformValidationFailureIssue(componentId: string): PlatformDiagnosticIssue {
  return {
    code: 'RUNTIME_PLATFORM_VALIDATION_FAILED',
    componentId,
    fixHint: 'Return at least one error-severity issue from validate() so the failure cause is diagnosable.',
    message: 'Platform component reported validation failure without diagnostic issues.',
    severity: 'error',
  };
}

export class PlatformDiagnosticRetention {
  private readonly retained: PlatformDiagnosticIssue[] = [];
  private readonly lifecycleIndexesByComponent = new Map<
    string,
    Map<Exclude<PlatformDiagnosticPhase, PlatformProbePhase>, Map<string, number>>
  >();
  private readonly probeIndexesByComponent = new Map<string, Map<PlatformProbePhase, number>>();

  append(
    phase: Exclude<PlatformDiagnosticPhase, PlatformProbePhase>,
    issues: readonly PlatformDiagnosticIssue[],
  ): void {
    for (const issue of issues) {
      let phaseIndexes = this.lifecycleIndexesByComponent.get(issue.componentId);
      if (phaseIndexes === undefined) {
        phaseIndexes = new Map();
        this.lifecycleIndexesByComponent.set(issue.componentId, phaseIndexes);
      }

      let codeIndexes = phaseIndexes.get(phase);
      if (codeIndexes === undefined) {
        codeIndexes = new Map();
        phaseIndexes.set(phase, codeIndexes);
      }

      const retainedIndex = codeIndexes.get(issue.code);
      if (retainedIndex === undefined) {
        codeIndexes.set(issue.code, this.retained.length);
        this.retained.push(issue);
      } else {
        this.retained[retainedIndex] = issue;
      }
    }
  }

  retainProbe(phase: PlatformProbePhase, issue: PlatformDiagnosticIssue): void {
    let probeIndexes = this.probeIndexesByComponent.get(issue.componentId);
    if (probeIndexes === undefined) {
      probeIndexes = new Map<PlatformProbePhase, number>();
      this.probeIndexesByComponent.set(issue.componentId, probeIndexes);
    }

    const retainedIndex = probeIndexes.get(phase);
    if (retainedIndex === undefined) {
      probeIndexes.set(phase, this.retained.length);
      this.retained.push(issue);
      return;
    }

    this.retained[retainedIndex] = issue;
  }

  toArray(): PlatformDiagnosticIssue[] {
    return [...this.retained];
  }
}
