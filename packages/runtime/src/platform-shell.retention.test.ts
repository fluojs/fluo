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
  readonly kind = 'runtime-test';
  private healthFailureCause: string | undefined;
  private readinessFailureCause: string | undefined;
  private snapshotFailureCause: string | undefined;
  private stopFailureCause: string | undefined;
  private validation: PlatformValidationResult = { issues: [], ok: true };

  constructor(readonly id = 'runtime.retention') {}

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

  it('snapshot: repeated stop failures retain only the latest cause and independent arrays', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);
    await shell.start();

    // When
    component.failStopWith('first stop failure');
    await expect(shell.stop()).rejects.toThrow('One or more platform components failed to stop cleanly.');
    const firstSnapshot = await shell.snapshot();
    for (let attempt = 2; attempt <= 1_000; attempt += 1) {
      component.failStopWith(`stop failure ${attempt}`);
      await expect(shell.stop()).rejects.toThrow('One or more platform components failed to stop cleanly.');
    }
    component.recoverStop();
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics.map(({ cause, message }) => ({ cause, message }))).toEqual([
      {
        cause: 'stop failure 1000',
        message: 'Platform component failed during stop.',
      },
    ]);
    expect(firstSnapshot.diagnostics).toHaveLength(1);
    expect(firstSnapshot.diagnostics[0]?.cause).toBe('first stop failure');
    snapshot.diagnostics.pop();
    expect((await shell.snapshot()).diagnostics).toHaveLength(1);
  });

  it('snapshot: repeated validation codes preserve components, order and latest diagnostic details', async () => {
    // Given
    const components = [new ProbeFailureComponent(), new ProbeFailureComponent('runtime.other')];
    const shell = RuntimePlatformShell.fromInputs(components);
    let attempt = 0;
    for (const component of components) {
      component.validate = () => ({
        issues: ['ONE', 'TWO'].map((code) => ({
          cause: `cause ${attempt}`,
          code,
          componentId: component.id,
          fixHint: `fix ${attempt}`,
          message: `arbitrary message ${attempt}`,
          severity: 'error',
        })),
        ok: false,
        warnings: [{
          code: 'WARNING',
          componentId: component.id,
          message: `warning ${attempt}`,
          severity: attempt === 1 ? 'info' : 'warning',
        }],
      });
    }

    // When
    for (attempt = 1; attempt <= 1_000; attempt += 1) {
      await expect(shell.start()).rejects.toThrow('Platform shell validation failed');
    }
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics).toEqual(components.flatMap((component) => [
      { code: 'WARNING', componentId: component.id, message: 'warning 1000', severity: 'warning' },
      ...['ONE', 'TWO'].map((code) => ({
        cause: 'cause 1000',
        code,
        componentId: component.id,
        fixHint: 'fix 1000',
        message: 'arbitrary message 1000',
        severity: 'error',
      })),
    ]));
    expect(snapshot.diagnostics.every((issue) => !('phase' in issue))).toBe(true);
  });

  it('snapshot: thrown and synthesized validation failures stay bounded across retries', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);
    let attempt = 0;
    component.validate = () => {
      if (attempt % 2 === 1) {
        throw new Error(`validation ${attempt}`);
      }
      return { issues: [], ok: false };
    };

    // When
    for (attempt = 1; attempt <= 1_000; attempt += 1) {
      await expect(shell.start()).rejects.toThrow('Platform shell validation failed');
    }
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics).toHaveLength(2);
    expect(snapshot.diagnostics[0]).toMatchObject({
      cause: 'validation 999',
      code: 'RUNTIME_PLATFORM_COMPONENT_FAILURE',
    });
    expect(snapshot.diagnostics[1]?.code).toBe('RUNTIME_PLATFORM_VALIDATION_FAILED');
  });

  it('snapshot: validation and lifecycle failures with the same code retain separate phases', async () => {
    // Given
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([component]);
    let attempt = 0;
    let failStart = true;
    component.validate = () => ({
      issues: [],
      ok: true,
      warnings: [{
        code: 'RUNTIME_PLATFORM_COMPONENT_FAILURE',
        componentId: component.id,
        message: `custom validation text ${attempt}`,
        severity: 'warning',
      }],
    });
    component.start = () => failStart ? Promise.reject(new Error(`start ${attempt}`)) : Promise.resolve();

    // When
    for (attempt = 1; attempt <= 1_000; attempt += 1) {
      failStart = true;
      await expect(shell.start()).rejects.toThrow(`failed to start: start ${attempt}`);
      failStart = false;
      await shell.start();
      component.failStopWith(`stop ${attempt}`);
      await expect(shell.stop()).rejects.toThrow('One or more platform components failed to stop cleanly.');
      component.recoverStop();
      await shell.stop();
    }
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics.map(({ cause, message, severity }) => ({ cause, message, severity }))).toEqual([
      { cause: undefined, message: 'custom validation text 1000', severity: 'warning' },
      { cause: 'start 1000', message: 'Platform component failed during start.', severity: 'error' },
      { cause: 'stop 1000', message: 'Platform component failed during stop.', severity: 'error' },
    ]);
  });

  it('snapshot: repeated startup rollback cycles preserve lifecycle phases and probe entries', async () => {
    // Given
    const dependency = new ProbeFailureComponent('runtime.dependency');
    const component = new ProbeFailureComponent();
    const shell = RuntimePlatformShell.fromInputs([
      dependency,
      { component, dependencies: [dependency.id] },
    ]);
    let attempt = 0;
    let stopCalls = 0;
    component.start = () => Promise.reject(new Error(`start ${attempt}`));
    dependency.stop = () => {
      stopCalls += 1;
      return stopCalls % 2 === 1
        ? Promise.reject(new Error(`rollback ${attempt}`))
        : Promise.resolve();
    };
    component.failReadinessWith('probe before lifecycle');
    await shell.ready();
    component.recoverReadiness();

    // When
    for (attempt = 1; attempt <= 1_000; attempt += 1) {
      await expect(shell.start()).rejects.toThrow(`failed to start: start ${attempt}`);
    }
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics.map(({ componentId, cause, message }) => ({ componentId, cause, message }))).toEqual([
      { componentId: component.id, cause: 'probe before lifecycle', message: 'Platform component failed during ready.' },
      { componentId: component.id, cause: 'start 1000', message: 'Platform component failed during start.' },
      { componentId: dependency.id, cause: 'rollback 1000', message: 'Platform component failed during stop.' },
      {
        componentId: component.id,
        cause: 'One or more platform components failed to stop cleanly.',
        message: 'Platform component failed during start-rollback.',
      },
    ]);
    expect(stopCalls).toBe(1_999);
    await shell.stop();
    expect(stopCalls).toBe(2_000);
  });
});
