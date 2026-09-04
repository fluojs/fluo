import { describe, expect, it } from 'vitest';

import type {
  PlatformComponent,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from './index.js';
import { RuntimePlatformShell } from './platform-shell.js';

class ValidationComponent implements PlatformComponent {
  started = false;

  constructor(
    readonly id: string,
    private readonly validation: PlatformValidationResult,
  ) {}

  readonly kind = 'runtime-test';

  health(): Promise<PlatformHealthReport> {
    return Promise.resolve({ status: 'healthy' });
  }

  ready(): Promise<PlatformReadinessReport> {
    return Promise.resolve({ critical: true, status: 'ready' });
  }

  snapshot(): PlatformSnapshot {
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
    this.started = true;
    return Promise.resolve();
  }

  state(): PlatformState {
    return this.started ? 'ready' : 'created';
  }

  stop(): Promise<void> {
    this.started = false;
    return Promise.resolve();
  }

  validate(): PlatformValidationResult {
    return this.validation;
  }
}

describe('RuntimePlatformShell validation gate', () => {
  it('stops startup when validation reports ok false without issues', async () => {
    // Given
    const component = new ValidationComponent('runtime.validation.silent', { issues: [], ok: false });
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    await expect(shell.start()).rejects.toThrow(
      'Platform shell validation failed: runtime.validation.silent:RUNTIME_PLATFORM_VALIDATION_FAILED',
    );

    // Then
    expect(component.started).toBe(false);
  });

  it('retains a stable diagnostic when validation reports ok false without issues', async () => {
    // Given
    const component = new ValidationComponent('runtime.validation.silent', { issues: [], ok: false });
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    await expect(shell.start()).rejects.toThrow('Platform shell validation failed');
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toMatchObject({
      code: 'RUNTIME_PLATFORM_VALIDATION_FAILED',
      componentId: 'runtime.validation.silent',
      message: 'Platform component reported validation failure without diagnostic issues.',
      severity: 'error',
    });
  });

  it('preserves component-provided issue ordering when validation reports issues', async () => {
    // Given
    const component = new ValidationComponent('runtime.validation.ordered', {
      issues: [
        {
          code: 'RUNTIME_VALIDATION_ORDER_ONE',
          componentId: 'runtime.validation.ordered',
          message: 'First validation failure.',
          severity: 'error',
        },
        {
          code: 'RUNTIME_VALIDATION_ORDER_TWO',
          componentId: 'runtime.validation.ordered',
          message: 'Second validation failure.',
          severity: 'error',
        },
      ],
      ok: false,
    });
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    await expect(shell.start()).rejects.toThrow(
      'Platform shell validation failed: runtime.validation.ordered:RUNTIME_VALIDATION_ORDER_ONE, runtime.validation.ordered:RUNTIME_VALIDATION_ORDER_TWO',
    );
    const snapshot = await shell.snapshot();

    // Then
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual([
      'RUNTIME_VALIDATION_ORDER_ONE',
      'RUNTIME_VALIDATION_ORDER_TWO',
    ]);
  });

  it('starts components when validation reports ok true with non-error issues', async () => {
    // Given
    const component = new ValidationComponent('runtime.validation.info', {
      issues: [
        {
          code: 'RUNTIME_VALIDATION_INFO',
          componentId: 'runtime.validation.info',
          message: 'Informational validation note.',
          severity: 'info',
        },
      ],
      ok: true,
    });
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    await shell.start();

    // Then
    expect(component.started).toBe(true);
  });
});
