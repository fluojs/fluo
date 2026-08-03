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

interface LifecycleControl {
  readonly events: string[];
  readonly id?: string;
  readonly startFailureCalls?: readonly number[];
  readonly startFailures?: number;
  readonly startGate?: Promise<void>;
  readonly stopFailureCalls?: readonly number[];
  readonly stopGate?: Promise<void>;
}

class ControlledPlatformComponent implements PlatformComponent {
  readonly id: string;
  readonly kind = 'runtime-test';
  readonly startEntered = new Deferred();
  readonly stopEntered = new Deferred();
  startCalls = 0;
  stopCalls = 0;

  private currentState: PlatformState = 'created';
  private startFailuresRemaining: number;

  constructor(private readonly control: LifecycleControl) {
    this.id = control.id ?? 'runtime.lifecycle';
    this.startFailuresRemaining = control.startFailures ?? 0;
  }

  async health(): Promise<PlatformHealthReport> {
    return { status: 'healthy' };
  }

  async ready(): Promise<PlatformReadinessReport> {
    return { critical: true, status: 'ready' };
  }

  snapshot(): PlatformSnapshot {
    return {
      dependencies: [],
      details: {},
      health: { status: 'healthy' },
      id: this.id,
      kind: this.kind,
      ownership: {
        externallyManaged: false,
        ownsResources: true,
      },
      readiness: { critical: true, status: 'ready' },
      state: this.currentState,
      telemetry: {
        namespace: 'fluo.runtime-test',
        tags: {},
      },
    };
  }

  async start(): Promise<void> {
    this.startCalls += 1;
    this.control.events.push('start');
    this.startEntered.resolve();
    await this.control.startGate;

    if (this.startFailuresRemaining > 0) {
      this.startFailuresRemaining -= 1;
      throw new Error('controlled start failure');
    }

    if (this.control.startFailureCalls?.includes(this.startCalls)) {
      throw new Error('controlled start failure');
    }

    this.currentState = 'ready';
  }

  state(): PlatformState {
    return this.currentState;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.control.events.push('stop');
    this.stopEntered.resolve();
    await this.control.stopGate;

    if (this.control.stopFailureCalls?.includes(this.stopCalls)) {
      throw new Error('controlled stop failure');
    }

    this.currentState = 'stopped';
  }

  async validate(): Promise<PlatformValidationResult> {
    this.control.events.push('validate');
    return { issues: [], ok: true };
  }
}

describe('RuntimePlatformShell lifecycle serialization', () => {
  it('shares one successful startup when concurrent start calls overlap', async () => {
    // Given
    const events: string[] = [];
    const startGate = new Deferred();
    const component = new ControlledPlatformComponent({ events, startGate: startGate.promise });
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    const firstStart = shell.start();
    await component.startEntered.promise;
    const secondStart = shell.start();
    startGate.resolve();
    await Promise.all([firstStart, secondStart]);

    // Then
    expect(component.startCalls).toBe(1);
    expect(events).toEqual(['validate', 'start']);
  });

  it('shares one shutdown when concurrent stop calls overlap', async () => {
    // Given
    const events: string[] = [];
    const stopGate = new Deferred();
    const component = new ControlledPlatformComponent({ events, stopGate: stopGate.promise });
    const shell = RuntimePlatformShell.fromInputs([component]);
    await shell.start();

    // When
    const firstStop = shell.stop();
    await component.stopEntered.promise;
    const secondStop = shell.stop();
    stopGate.resolve();
    await Promise.all([firstStop, secondStop]);

    // Then
    expect(component.stopCalls).toBe(1);
    expect(events).toEqual(['validate', 'start', 'stop']);
  });

  it('waits for an in-flight startup before stopping the started component', async () => {
    // Given
    const events: string[] = [];
    const startGate = new Deferred();
    const component = new ControlledPlatformComponent({ events, startGate: startGate.promise });
    const shell = RuntimePlatformShell.fromInputs([component]);
    const starting = shell.start();
    await component.startEntered.promise;

    // When
    let stopSettled = false;
    const stopping = shell.stop().then(() => {
      stopSettled = true;
    });
    await Promise.resolve();

    // Then
    expect(stopSettled).toBe(false);
    expect(events).toEqual(['validate', 'start']);

    startGate.resolve();
    await Promise.all([starting, stopping]);
    expect(component.state()).toBe('stopped');
    expect(events).toEqual(['validate', 'start', 'stop']);
  });

  it('shares a failed concurrent startup and allows an explicit retry', async () => {
    // Given
    const events: string[] = [];
    const startGate = new Deferred();
    const component = new ControlledPlatformComponent({
      events,
      startFailures: 1,
      startGate: startGate.promise,
    });
    const shell = RuntimePlatformShell.fromInputs([component]);

    // When
    const firstStart = shell.start();
    await component.startEntered.promise;
    const secondStart = shell.start();
    startGate.resolve();
    const concurrentResults = await Promise.allSettled([firstStart, secondStart]);

    // Then
    expect(concurrentResults.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(component.startCalls).toBe(1);

    await expect(shell.start()).resolves.toBeUndefined();
    expect(component.startCalls).toBe(2);
    expect(events).toEqual(['validate', 'start', 'validate', 'start']);
  });

  it('retries partial cleanup before a start queued behind a failed stop', async () => {
    // Given
    const events: string[] = [];
    const stopGate = new Deferred();
    const component = new ControlledPlatformComponent({
      events,
      stopFailureCalls: [1],
      stopGate: stopGate.promise,
    });
    const shell = RuntimePlatformShell.fromInputs([component]);
    await shell.start();

    // When
    const stopping = shell.stop();
    await component.stopEntered.promise;
    const restarting = shell.start();
    stopGate.resolve();

    // Then
    await expect(stopping).rejects.toThrow('One or more platform components failed to stop cleanly.');
    await expect(restarting).resolves.toBeUndefined();
    expect(component.stopCalls).toBe(2);
    expect(component.startCalls).toBe(2);
    expect(events).toEqual(['validate', 'start', 'stop', 'stop', 'validate', 'start']);
  });

  it('retries pending rollback cleanup after a failed restart', async () => {
    // Given
    const events: string[] = [];
    const owner = new ControlledPlatformComponent({
      events,
      id: 'runtime.owner',
      stopFailureCalls: [2],
    });
    const dependent = new ControlledPlatformComponent({
      events,
      id: 'runtime.dependent',
      startFailureCalls: [2],
    });
    const shell = RuntimePlatformShell.fromInputs([
      { component: dependent, dependencies: [owner.id] },
      owner,
    ]);
    await shell.start();
    await shell.stop();

    // When
    await expect(shell.start()).rejects.toThrow(
      'Platform component "runtime.dependent" failed to start: controlled start failure',
    );
    await shell.stop();

    // Then
    expect(owner.stopCalls).toBe(3);
    expect(dependent.stopCalls).toBe(1);
    expect(owner.state()).toBe('stopped');
  });
});
