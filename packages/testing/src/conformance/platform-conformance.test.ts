import { describe, expect, it } from 'vitest';

import type {
  PlatformComponent,
  PlatformDiagnosticIssue,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from '@konekti/runtime';

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
      snapshotDetails?: Record<string, unknown>;
      state?: PlatformState;
    } = {},
  ) {
    this.currentState = options.state ?? 'created';
    this.diagnostics = options.diagnostics ?? [];
    this.mutateOnValidate = options.mutateOnValidate ?? false;
    this.nonIdempotentStart = options.nonIdempotentStart ?? false;
    this.snapshotDetails = options.snapshotDetails ?? { queueDepth: 3 };
    this.sideEffects = { validateCalls: 0 };
  }

  private readonly diagnostics: PlatformDiagnosticIssue[];
  private readonly mutateOnValidate: boolean;
  private readonly nonIdempotentStart: boolean;
  private readonly snapshotDetails: Record<string, unknown>;

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
        namespace: `konekti.${this.kind}`,
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
