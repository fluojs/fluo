import { describe, expect, it } from 'vitest';

import type {
  PlatformComponent,
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from '@fluojs/runtime';

import { createPlatformConformanceHarness } from './platform-conformance.js';

class TestPlatformComponent implements PlatformComponent {
  private currentState: PlatformState;
  private readonly sideEffects: { validateCalls: number };

  constructor(
    readonly id: string,
    readonly kind: string,
    options: {
      diagnostics?: PlatformDiagnosticIssue[];
      mutateOnValidate?: boolean;
      nonIdempotentStart?: boolean;
      snapshotError?: Error;
      snapshotDetails?: Record<string, unknown>;
      state?: PlatformState;
      stopError?: Error;
    } = {},
  ) {
    this.currentState = options.state ?? 'created';
    this.diagnostics = options.diagnostics ?? [];
    this.mutateOnValidate = options.mutateOnValidate ?? false;
    this.nonIdempotentStart = options.nonIdempotentStart ?? false;
    this.snapshotError = options.snapshotError;
    this.snapshotDetails = options.snapshotDetails ?? { queueDepth: 3 };
    this.stopError = options.stopError;
    this.sideEffects = { validateCalls: 0 };
  }

  private readonly diagnostics: PlatformDiagnosticIssue[];
  private readonly mutateOnValidate: boolean;
  private readonly nonIdempotentStart: boolean;
  private readonly snapshotError: Error | undefined;
  private readonly snapshotDetails: Record<string, unknown>;
  private readonly stopError: Error | undefined;

  readSideEffects(): { validateCalls: number } {
    return { ...this.sideEffects };
  }

  async health(): Promise<PlatformHealthReport> {
    return { status: this.currentState === 'failed' ? 'unhealthy' : 'healthy' };
  }

  async ready(): Promise<PlatformReadinessReport> {
    if (this.currentState === 'failed') {
      return { critical: true, reason: 'failed', status: 'not-ready' };
    }

    if (this.currentState === 'degraded') {
      return { critical: true, reason: 'degraded', status: 'degraded' };
    }

    return { critical: true, status: 'ready' };
  }

  snapshot(): PlatformSnapshot {
    if (this.snapshotError) {
      throw this.snapshotError;
    }

    return {
      dependencies: [],
      details: this.snapshotDetails,
      health: this.currentState === 'failed' ? { reason: 'failed', status: 'unhealthy' } : { status: 'healthy' },
      id: this.id,
      kind: this.kind,
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness:
        this.currentState === 'failed'
          ? { critical: true, reason: 'failed', status: 'not-ready' }
          : this.currentState === 'degraded'
          ? { critical: true, reason: 'degraded', status: 'degraded' }
          : { critical: true, status: 'ready' },
      state: this.currentState,
      telemetry: {
        namespace: `fluo.${this.kind}`,
        tags: {},
      },
    };
  }

  async start(): Promise<void> {
    if (this.nonIdempotentStart && this.currentState === 'ready') {
      this.currentState = 'degraded';
      return;
    }

    this.currentState = 'ready';
  }

  state(): PlatformState {
    return this.currentState;
  }

  async stop(): Promise<void> {
    if (this.stopError) {
      throw this.stopError;
    }

    this.currentState = 'stopped';
  }

  async validate(): Promise<PlatformValidationResult> {
    this.sideEffects.validateCalls += 1;

    if (this.mutateOnValidate) {
      this.currentState = 'validated';
    }

    return {
      issues: this.diagnostics,
      ok: this.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length === 0,
    };
  }
}

describe('platform conformance harness', () => {
  class StopFailure extends Error {
    readonly code = 'STOP_FAILURE';

    constructor(cause: Error) {
      super('custom stop failed', { cause });
      this.name = 'StopFailure';
    }
  }

  it('passes full checks for a deterministic, sanitized component', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () =>
        new TestPlatformComponent('queue.default', 'queue', {
          diagnostics: [
            {
              code: 'QUEUE_DEPENDENCY_NOT_READY',
              componentId: 'queue.default',
              fixHint: 'Verify Redis dependency readiness before enabling queue startup.',
              message: 'Queue startup requires ready Redis.',
              severity: 'error',
            },
          ],
        }),
      diagnostics: {
        expectedCodes: ['QUEUE_DEPENDENCY_NOT_READY'],
      },
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('queue.default', 'queue', { state: 'degraded' }),
          enterState: () => undefined,
          expectedState: 'degraded',
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('queue.default', 'queue', { state: 'failed' }),
          enterState: () => undefined,
          expectedState: 'failed',
          name: 'failed',
        },
      },
    });

    await expect(harness.assertAll()).resolves.toBeUndefined();
  });

  it('fails when validate mutates component state', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('redis.default', 'redis', { mutateOnValidate: true }),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('redis.default', 'redis', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('redis.default', 'redis', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertValidationHasNoLongLivedSideEffects()).rejects.toThrow('must not transition component state');
  });

  it('fails when duplicate start calls are not idempotent', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('cache.default', 'cache', { nonIdempotentStart: true }),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertStartIsDeterministic()).rejects.toThrow('not idempotent');
  });

  it('reports cleanup failures after start determinism checks', async () => {
    const stopError = new Error('stop exploded');
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('cache.default', 'cache', { stopError }),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertStartIsDeterministic()).rejects.toThrow('stop() failed during conformance cleanup');
  });

  it('preserves the original stop rejection object in cleanup aggregate errors', async () => {
    const cause = new Error('socket close cause');
    const stopError = new StopFailure(cause);
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('cache.default', 'cache', { stopError }),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertStartIsDeterministic()).rejects.toMatchObject({
      errors: [stopError],
    });
    expect(stopError).toBeInstanceOf(StopFailure);
    expect(stopError.cause).toBe(cause);
    expect(stopError.stack).toContain('custom stop failed');
  });

  it('wraps only snapshot failures when checking degraded and failed states', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('cache.default', 'cache'),
      scenarios: {
        degraded: {
          createComponent: () =>
            new TestPlatformComponent('cache.default', 'cache', {
              snapshotError: new Error('snapshot storage unavailable'),
              state: 'degraded',
            }),
          enterState: () => undefined,
          expectedState: 'degraded',
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'failed' }),
          enterState: () => undefined,
          expectedState: 'failed',
          name: 'failed',
        },
      },
    });

    await expect(harness.assertSnapshotSafeInDegradedAndFailedStates()).rejects.toThrow(
      'snapshot() must be safe in "degraded" state: snapshot storage unavailable',
    );
  });

  it('does not report enterState failures as snapshot safety failures', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('cache.default', 'cache'),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'created' }),
          enterState: () => {
            throw new Error('degraded transition failed');
          },
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertSnapshotSafeInDegradedAndFailedStates()).rejects.toThrow('degraded transition failed');
    await expect(harness.assertSnapshotSafeInDegradedAndFailedStates()).rejects.not.toThrow('snapshot() must be safe');
  });

  it('does not report expected-state mismatches as snapshot safety failures', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () => new TestPlatformComponent('cache.default', 'cache'),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'ready' }),
          enterState: () => undefined,
          expectedState: 'degraded',
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('cache.default', 'cache', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertSnapshotSafeInDegradedAndFailedStates()).rejects.toThrow(
      'Scenario "degraded" expected state "degraded" but received "ready".',
    );
    await expect(harness.assertSnapshotSafeInDegradedAndFailedStates()).rejects.not.toThrow('snapshot() must be safe');
  });

  it('requires diagnostics to include stable non-empty messages', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () =>
        new TestPlatformComponent('queue.default', 'queue', {
          diagnostics: [
            {
              code: 'QUEUE_DEPENDENCY_NOT_READY',
              componentId: 'queue.default',
              fixHint: 'Verify Redis dependency readiness before enabling queue startup.',
              message: '',
              severity: 'error',
            },
          ],
        }),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('queue.default', 'queue', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('queue.default', 'queue', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertStableDiagnostics()).rejects.toThrow('must provide a stable non-empty message');
  });

  it('reports missing and unexpected diagnostic codes', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () =>
        new TestPlatformComponent('queue.default', 'queue', {
          diagnostics: [
            {
              code: 'QUEUE_DEPENDENCY_NOT_READY',
              componentId: 'queue.default',
              fixHint: 'Verify Redis dependency readiness before enabling queue startup.',
              message: 'Queue startup requires ready Redis.',
              severity: 'error',
            },
          ],
        }),
      diagnostics: {
        expectedCodes: ['QUEUE_CONFIG_MISSING'],
      },
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('queue.default', 'queue', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('queue.default', 'queue', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertStableDiagnostics()).rejects.toThrow(
      'Missing [QUEUE_CONFIG_MISSING]; unexpected [QUEUE_DEPENDENCY_NOT_READY]',
    );
  });

  it('fails when snapshot details leak unsanitized credential keys', async () => {
    const harness = createPlatformConformanceHarness({
      createComponent: () =>
        new TestPlatformComponent('redis.default', 'redis', {
          snapshotDetails: {
            credentials: {
              password: 'top-secret',
            },
          },
        }),
      scenarios: {
        degraded: {
          createComponent: () => new TestPlatformComponent('redis.default', 'redis', { state: 'degraded' }),
          enterState: () => undefined,
          name: 'degraded',
        },
        failed: {
          createComponent: () => new TestPlatformComponent('redis.default', 'redis', { state: 'failed' }),
          enterState: () => undefined,
          name: 'failed',
        },
      },
    });

    await expect(harness.assertSnapshotSanitized()).rejects.toThrow('unsanitized keys');
  });
});
