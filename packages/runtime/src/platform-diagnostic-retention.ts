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

export class PlatformDiagnosticRetention {
  private readonly retained: PlatformDiagnosticIssue[] = [];
  private readonly probeIndexesByComponent = new Map<string, Map<PlatformProbePhase, number>>();

  append(issues: readonly PlatformDiagnosticIssue[]): void {
    this.retained.push(...issues);
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
