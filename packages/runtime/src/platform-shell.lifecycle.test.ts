import { describe, expect, it } from 'vitest';

import type {
  PlatformComponent,
  PlatformHealthReport,
  PlatformLifecycleOperation,
  PlatformReadinessReport,
  PlatformShell,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from './index.js';
import { RuntimePlatformShell } from './platform-shell.js';

class Deferred {
  readonly promise: Promise<void>;
  private settle: () => void = () => {
    throw new Error('Deferred promise was not initialized.');
  };

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
  }

  resolve(): void {
    this.settle();
  }
}

type LifecycleHook = () => Promise<void> | void;

interface LifecycleControl {
  readonly failStartTimes?: number;
  readonly failStopTimes?: number;
  readonly onStart?: LifecycleHook;
  readonly onStop?: LifecycleHook;
  readonly startGate?: Promise<void>;
  readonly stopGate?: Promise<void>;
}

class ControlledPlatformComponent implements PlatformComponent {
  readonly id = 'runtime.lifecycle';
  readonly kind = 'runtime-test';
  readonly entered: Record<PlatformLifecycleOperation, Deferred> = {
    start: new Deferred(),
    stop: new Deferred(),
  };
  startCalls = 0;
  stopCalls = 0;

  private currentState: PlatformState = 'created';
  private startFailuresRemaining: number;
  private stopFailuresRemaining: number;

  constructor(private readonly control: LifecycleControl = {}) {
    this.startFailuresRemaining = control.failStartTimes ?? 0;
    this.stopFailuresRemaining = control.failStopTimes ?? 0;
  }

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
      state: this.currentState,
      telemetry: { namespace: 'fluo.runtime-test', tags: {} },
    };
  }

  async start(): Promise<void> {
    this.startCalls += 1;
    this.entered.start.resolve();
    await this.control.onStart?.();
    await this.control.startGate;
    if (this.startFailuresRemaining > 0) {
      this.startFailuresRemaining -= 1;
      throw new Error('controlled start failure');
    }
    this.currentState = 'ready';
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.entered.stop.resolve();
    await this.control.onStop?.();
    await this.control.stopGate;
    if (this.stopFailuresRemaining > 0) {
      this.stopFailuresRemaining -= 1;
      throw new Error('controlled stop failure');
    }
    this.currentState = 'stopped';
  }

  state(): PlatformState {
    return this.currentState;
  }

  validate(): Promise<PlatformValidationResult> {
    return Promise.resolve({ issues: [], ok: true });
  }
}

const overlapPairs: readonly (readonly [PlatformLifecycleOperation, PlatformLifecycleOperation])[] = [
  ['start', 'start'],
  ['start', 'stop'],
  ['stop', 'start'],
  ['stop', 'stop'],
];

type ImmediateResult =
  | { readonly error: unknown; readonly status: 'rejected' }
  | { readonly status: 'fulfilled' | 'pending' };

function observeImmediate(promise: Promise<void>): Promise<ImmediateResult> {
  return Promise.race([
    promise.then(
      () => ({ status: 'fulfilled' }) as const,
      (error: unknown) => ({ error, status: 'rejected' }) as const,
    ),
    Promise.resolve().then(() => ({ status: 'pending' }) as const),
  ]);
}

describe('RuntimePlatformShell exclusive lifecycle transitions', () => {
  it.each(overlapPairs)('rejects %s -> %s overlap immediately with typed conflict metadata', async (active, requested) => {
    // Given
    const gate = new Deferred();
    const component = new ControlledPlatformComponent(
      active === 'start' ? { startGate: gate.promise } : { stopGate: gate.promise },
    );
    const shell: PlatformShell = RuntimePlatformShell.fromInputs([component]);
    if (active === 'stop') await shell.start();
    const activeTransition = shell[active]();
    await component.entered[active].promise;

    // When
    const requestedTransition = shell[requested]();
    const immediateResult = await observeImmediate(requestedTransition);
    gate.resolve();
    await activeTransition;

    // Then
    expect(immediateResult).toMatchObject({
      error: {
        activeOperation: active,
        code: 'PLATFORM_LIFECYCLE_CONFLICT',
        meta: { activeOperation: active, requestedOperation: requested },
        name: 'PlatformLifecycleConflictError',
        requestedOperation: requested,
      },
      status: 'rejected',
    });
  });

  it('rejects synchronous callback reentry instead of deadlocking startup', async () => {
    // Given
    let reenter: () => Promise<void> = () => Promise.reject(new Error('reentry was not initialized'));
    let reentryResult: ImmediateResult = { status: 'pending' };
    const component = new ControlledPlatformComponent({
      onStart: async () => {
        reentryResult = await observeImmediate(reenter());
        if (reentryResult.status === 'pending') throw new Error('synchronous callback reentry remained pending');
      },
    });
    const shell: PlatformShell = RuntimePlatformShell.fromInputs([component]);
    reenter = () => shell.stop();

    // When
    await shell.start();

    // Then
    expect(reentryResult).toMatchObject({
      error: {
        activeOperation: 'start',
        code: 'PLATFORM_LIFECYCLE_CONFLICT',
        requestedOperation: 'stop',
      },
      status: 'rejected',
    });
  });

  it('rejects callback reentry after arbitrary awaits instead of deadlocking shutdown', async () => {
    // Given
    let reenter: () => Promise<void> = () => Promise.reject(new Error('reentry was not initialized'));
    let reentryResult: ImmediateResult = { status: 'pending' };
    const component = new ControlledPlatformComponent({
      onStop: async () => {
        await Promise.resolve();
        await Promise.resolve();
        reentryResult = await observeImmediate(reenter());
        if (reentryResult.status === 'pending') throw new Error('awaited callback reentry remained pending');
      },
    });
    const shell: PlatformShell = RuntimePlatformShell.fromInputs([component]);
    reenter = () => shell.start();
    await shell.start();

    // When
    await shell.stop();

    // Then
    expect(reentryResult).toMatchObject({
      error: {
        activeOperation: 'stop',
        code: 'PLATFORM_LIFECYCLE_CONFLICT',
        requestedOperation: 'start',
      },
      status: 'rejected',
    });
  });

  it.each(['start', 'stop'] as const)('clears a failed %s transition for an explicit retry after settlement', async (operation) => {
    // Given
    const component = new ControlledPlatformComponent(
      operation === 'start' ? { failStartTimes: 1 } : { failStopTimes: 1 },
    );
    const shell: PlatformShell = RuntimePlatformShell.fromInputs([component]);
    if (operation === 'stop') await shell.start();

    // When
    await expect(shell[operation]()).rejects.toThrow(
      operation === 'start' ? 'controlled start failure' : 'One or more platform components failed to stop cleanly.',
    );
    const retry = shell[operation]();

    // Then
    await expect(retry).resolves.toBeUndefined();
    expect(operation === 'start' ? component.startCalls : component.stopCalls).toBe(2);
  });

  it('keeps settled sequential start and stop calls idempotent', async () => {
    // Given
    const component = new ControlledPlatformComponent();
    const shell: PlatformShell = RuntimePlatformShell.fromInputs([component]);

    // When
    await shell.start();
    await shell.start();
    await shell.stop();
    await shell.stop();

    // Then
    expect({ start: component.startCalls, stop: component.stopCalls }).toEqual({ start: 1, stop: 1 });
  });
});
