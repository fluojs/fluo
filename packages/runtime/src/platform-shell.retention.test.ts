import { describe, expect, it } from 'vitest';

import type {
  PlatformComponent,
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from './index.js';
import { RuntimePlatformShell } from './platform-shell.js';

class ProbeFailureComponent implements PlatformComponent {
  readonly id = 'runtime.retention';
  readonly kind = 'runtime-test';
  private healthFailureCause: string | undefined;
  private readinessFailureCause: string | undefined;
  private snapshotFailureCause: string | undefined;
  private stopFailureCause: string | undefined;
  private validation: PlatformValidationResult = { issues: [], ok: true };

  failHealthWith(cause: string): void {
    this.healthFailureCause = cause;
  }

  failReadinessWith(cause: string): void {
    this.readinessFailureCause = cause;
  }

  failSnapshotWith(cause: string): void {
    this.snapshotFailureCause = cause;
  }

  failStopWith(cause: string): void {
    this.stopFailureCause = cause;
  }

  failValidationWith(issues: readonly PlatformDiagnosticIssue[]): void {
    this.validation = { issues: [...issues], ok: false };
  }

  recoverReadiness(): void {
    this.readinessFailureCause = undefined;
  }

  recoverStop(): void {
    this.stopFailureCause = undefined;
  }

  health(): Promise<PlatformHealthReport> {
    if (this.healthFailureCause !== undefined) {
      return Promise.reject(new Error(this.healthFailureCause));
    }

    return Promise.resolve({ status: 'healthy' });
  }

  recoverHealth(): void {
    this.healthFailureCause = undefined;
  }

  ready(): Promise<PlatformReadinessReport> {
    if (this.readinessFailureCause !== undefined) {
      return Promise.reject(new Error(this.readinessFailureCause));
    }

    return Promise.resolve({ critical: true, status: 'ready' });
  }

  snapshot(): PlatformSnapshot {
    if (this.snapshotFailureCause !== undefined) {
      throw new Error(this.snapshotFailureCause);
    }

    return {
      dependencies: [],
      details: {},
      health: { status: 'healthy' },
      id: this.id,
      kind: this.kind,
      ownership: { externallyManaged: false, ownsResources: true },
      readiness: { critical: true, status: 'ready' },
      state: this.state(),
      telemetry: { namespace: 'fluo.runtime-test', tags: {} },
    };
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  state(): PlatformState {
    return 'ready';
  }

  stop(): Promise<void> {
    if (this.stopFailureCause !== undefined) {
      return Promise.reject(new Error(this.stopFailureCause));
    }

    return Promise.resolve();
  }

  validate(): PlatformValidationResult {
    return this.validation;
  }
}

describe('RuntimePlatformShell diagnostic retention', () => {
  it('retains only the latest readiness probe failure during long-running polling', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    for (let attempt = 1; attempt <= 1_000; attempt += 1) {
      component.failReadinessWith(`readiness failure ${attempt}`);
      await shell.ready();
    }
    component.recoverReadiness();
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toMatchObject({
      cause: 'readiness failure 1000',
      componentId: 'runtime.retention',
      message: 'Platform component failed during ready.',
    });
  });

  it('retains only the latest health probe failure during long-running polling', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    for (let attempt = 1; attempt <= 1_000; attempt += 1) {
      component.failHealthWith(`health failure ${attempt}`);
      await shell.health();
    }
    component.recoverHealth();
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toMatchObject({
      cause: 'health failure 1000',
      componentId: 'runtime.retention',
      message: 'Platform component failed during health.',
    });
  });

  it('bounds repeated snapshot probe failures and preserves every latest cause', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);
    component.failReadinessWith('readiness failure 1');
    component.failHealthWith('health failure 1');
    component.failSnapshotWith('snapshot failure 1');

    // When
    let snapshot = await shell.snapshot();
    for (let attempt = 2; attempt <= 1_000; attempt += 1) {
      component.failReadinessWith(`readiness failure ${attempt}`);
      component.failHealthWith(`health failure ${attempt}`);
      component.failSnapshotWith(`snapshot failure ${attempt}`);
      snapshot = await shell.snapshot();
    }

    // Then
    expect(snapshot.diagnostics).toHaveLength(3);
    expect(snapshot.diagnostics.map(({ cause, message }) => ({ cause, message }))).toEqual([
      {
        cause: 'snapshot failure 1000',
        message: 'Platform component failed during snapshot.',
      },
      {
        cause: 'readiness failure 1000',
        message: 'Platform component failed during ready.',
      },
      {
        cause: 'health failure 1000',
        message: 'Platform component failed during health.',
      },
    ]);
  });

  it('preserves every validation issue in the retained snapshot', async () => {
    // Given
    const component = new ProbeFailureComponent();
    component.failValidationWith([
      {
        code: 'RUNTIME_RETENTION_VALIDATION_ONE',
        componentId: component.id,
        message: 'First validation failure.',
        severity: 'error',
      },
      {
        code: 'RUNTIME_RETENTION_VALIDATION_TWO',
        componentId: component.id,
        message: 'Second validation failure.',
        severity: 'error',
      },
    ]);
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    await expect(shell.start()).rejects.toThrow('Platform shell validation failed');
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual([
      'RUNTIME_RETENTION_VALIDATION_ONE',
      'RUNTIME_RETENTION_VALIDATION_TWO',
    ]);
  });

  it('preserves distinct lifecycle failures instead of applying probe deduplication', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);
    await shell.start();

    // When
    component.failStopWith('first stop failure');
    await expect(shell.stop()).rejects.toThrow('One or more platform components failed to stop cleanly.');
    component.failStopWith('second stop failure');
    await expect(shell.stop()).rejects.toThrow('One or more platform components failed to stop cleanly.');
    component.recoverStop();
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics.map(({ cause, message }) => ({ cause, message }))).toEqual([
      {
        cause: 'first stop failure',
        message: 'Platform component failed during stop.',
      },
      {
        cause: 'second stop failure',
        message: 'Platform component failed during stop.',
      },
    ]);
  });
});
