import { describe, expect, it } from 'vitest';

import type {
  PlatformComponent,
  PlatformHealthReport,
  PlatformReadinessReport,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from './platform-contract.js';
import { RuntimePlatformShell } from './platform-shell.js';

class StubPlatformComponent implements PlatformComponent {
  private currentState: PlatformState = 'created';
  private startFailuresRemaining: number;
  private stopFailuresRemaining: number;

  constructor(
    readonly id: string,
    readonly kind: string,
    private readonly events: string[],
    private readonly readinessReport: PlatformReadinessReport,
    private readonly healthReport: PlatformHealthReport,
    private readonly validation: PlatformValidationResult = { ok: true, issues: [] },
    options: {
      failStartTimes?: number;
      failStopTimes?: number;
    } = {},
  ) {
    this.startFailuresRemaining = options.failStartTimes ?? 0;
    this.stopFailuresRemaining = options.failStopTimes ?? 0;
  }

  async health(): Promise<PlatformHealthReport> {
    return this.healthReport;
  }

  async ready(): Promise<PlatformReadinessReport> {
    return this.readinessReport;
  }

  snapshot(): PlatformSnapshot {
    return {
      dependencies: [],
      details: {},
      health: this.healthReport,
      id: this.id,
      kind: this.kind,
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: this.readinessReport,
      state: this.currentState,
      telemetry: {
        namespace: `konekti.${this.kind}`,
        tags: {},
      },
    };
  }

  async start(): Promise<void> {
    if (this.startFailuresRemaining > 0) {
      this.startFailuresRemaining -= 1;
      this.events.push(`start-fail:${this.id}`);
      throw new Error(`start failed for ${this.id}`);
    }

    this.currentState = 'ready';
    this.events.push(`start:${this.id}`);
  }

  state(): PlatformState {
    return this.currentState;
  }

  async stop(): Promise<void> {
    if (this.stopFailuresRemaining > 0) {
      this.stopFailuresRemaining -= 1;
      this.events.push(`stop-fail:${this.id}`);
      throw new Error(`stop failed for ${this.id}`);
    }

    this.currentState = 'stopped';
    this.events.push(`stop:${this.id}`);
  }

  async validate(): Promise<PlatformValidationResult> {
    this.events.push(`validate:${this.id}`);
    return this.validation;
  }
}

describe('RuntimePlatformShell', () => {
  it('validates and starts components in dependency order, then stops in reverse order', async () => {
    const events: string[] = [];
    const redis = new StubPlatformComponent(
      'redis.default',
      'redis',
      events,
      { critical: true, status: 'ready' },
      { status: 'healthy' },
    );
    const queue = new StubPlatformComponent(
      'queue.default',
      'queue',
      events,
      { critical: true, status: 'ready' },
      { status: 'healthy' },
    );

    const shell = RuntimePlatformShell.fromInputs([
      { component: queue, dependencies: ['redis.default'] },
      { component: redis, dependencies: [] },
    ]);

    await shell.start();
    await shell.stop();

    expect(events).toEqual([
      'validate:queue.default',
      'validate:redis.default',
      'start:redis.default',
      'start:queue.default',
      'stop:queue.default',
      'stop:redis.default',
    ]);
  });

  it('throws when registration contains unknown dependency edges', async () => {
    const events: string[] = [];
    const queue = new StubPlatformComponent(
      'queue.default',
      'queue',
      events,
      { critical: true, status: 'ready' },
      { status: 'healthy' },
    );

    const shell = RuntimePlatformShell.fromInputs([
      { component: queue, dependencies: ['redis.default'] },
    ]);

    await expect(shell.start()).rejects.toThrow('depends on unknown component "redis.default"');
  });

  it('produces a shared runtime snapshot with aggregate readiness and health', async () => {
    const events: string[] = [];
    const healthy = new StubPlatformComponent(
      'cache.default',
      'cache',
      events,
      { critical: false, status: 'ready' },
      { status: 'healthy' },
    );
    const degraded = new StubPlatformComponent(
      'search.default',
      'search',
      events,
      { critical: false, reason: 'warmup in progress', status: 'degraded' },
      { reason: 'indexer lag detected', status: 'degraded' },
    );

    const shell = RuntimePlatformShell.fromInputs([
      { component: healthy, dependencies: [] },
      { component: degraded, dependencies: ['cache.default'] },
    ]);

    await shell.start();
    const snapshot = await shell.snapshot();

    expect(snapshot.readiness.status).toBe('degraded');
    expect(snapshot.health.status).toBe('degraded');
    expect(snapshot.components.map((component) => component.id)).toEqual(['cache.default', 'search.default']);
    expect(snapshot.components.find((component) => component.id === 'search.default')?.dependencies).toEqual(['cache.default']);

    await shell.stop();
  });

  it('keeps the original start failure as primary and allows follow-up cleanup when rollback stop fails', async () => {
    const events: string[] = [];
    const redis = new StubPlatformComponent(
      'redis.default',
      'redis',
      events,
      { critical: true, status: 'ready' },
      { status: 'healthy' },
      { ok: true, issues: [] },
      { failStopTimes: 1 },
    );
    const queue = new StubPlatformComponent(
      'queue.default',
      'queue',
      events,
      { critical: true, status: 'ready' },
      { status: 'healthy' },
      { ok: true, issues: [] },
      { failStartTimes: 1 },
    );

    const shell = RuntimePlatformShell.fromInputs([
      { component: queue, dependencies: ['redis.default'] },
      { component: redis, dependencies: [] },
    ]);

    await expect(shell.start()).rejects.toThrow('Platform component "queue.default" failed to start: start failed for queue.default');

    await expect(shell.stop()).resolves.toBeUndefined();

    expect(events).toEqual([
      'validate:queue.default',
      'validate:redis.default',
      'start:redis.default',
      'start-fail:queue.default',
      'stop-fail:redis.default',
      'stop:redis.default',
    ]);
  });
});
