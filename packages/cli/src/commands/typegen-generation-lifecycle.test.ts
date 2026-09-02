import { describe, expect, it, vi } from 'vitest';

import {
  startTypegenGenerationProcess,
  type TypegenGenerationChild,
  waitForTypegenGenerationChild,
} from './typegen-generation-process.js';

class FakeGenerationChild implements TypegenGenerationChild {
  readonly errorListeners = new Set<(error: Error) => void>();
  readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  readonly messageListeners = new Set<(message: unknown) => void>();
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }

  offError(listener: (error: Error) => void): void {
    this.errorListeners.delete(listener);
  }

  offExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.exitListeners.delete(listener);
  }

  offMessage(listener: (message: unknown) => void): void {
    this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.add(listener);
  }

  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.exitListeners.add(listener);
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.add(listener);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.exitListeners) {
      listener(code, signal);
    }
  }

  emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }
}

describe('fluo typegen generation child lifecycle', () => {
  it('sends one immediate SIGTERM and escalates only after the full cancellation grace period', async () => {
    // Given: a generation child that accepts SIGTERM but never exits.
    vi.useFakeTimers();
    try {
      const child = new FakeGenerationChild();
      const generation = startTypegenGenerationProcess(
        { cwd: '/project', exportName: 'AppModule', modulePath: '/project/src/app.ts' },
        () => child,
      );

      // When: its owner cancels repeatedly while the bounded grace period advances.
      generation.cancel();
      generation.cancel();
      expect(child.signals).toEqual(['SIGTERM']);
      vi.advanceTimersByTime(499);
      expect(child.signals).toEqual(['SIGTERM']);
      vi.advanceTimersByTime(1);

      // Then: one SIGKILL is sent exactly at the deadline without wall-clock waiting.
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
      child.emitExit(null, 'SIGKILL');
      await expect(generation.result).rejects.toThrow('signal SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears cancellation escalation and completion listeners when SIGTERM exits the child early', async () => {
    // Given: a generation child with one pending SIGKILL escalation after cooperative cancellation.
    vi.useFakeTimers();
    try {
      const child = new FakeGenerationChild();
      const generation = startTypegenGenerationProcess(
        { cwd: '/project', exportName: 'AppModule', modulePath: '/project/src/app.ts' },
        () => child,
      );
      generation.cancel();

      // When: the child exits before the bounded deadline.
      child.emitExit(null, 'SIGTERM');
      await expect(generation.result).rejects.toThrow('signal SIGTERM');

      // Then: lifecycle listeners and the no-longer-owned escalation timer are both removed.
      expect(child.errorListeners.size).toBe(0);
      expect(child.exitListeners.size).toBe(0);
      expect(child.messageListeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(500);
      expect(child.signals).toEqual(['SIGTERM']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for process exit and removes every completion listener', async () => {
    // Given: a generation child that has sent source but has not exited.
    const child = new FakeGenerationChild();
    let state: 'pending' | 'resolved' = 'pending';
    const result = waitForTypegenGenerationChild(child).then((source) => {
      state = 'resolved';
      return source;
    });

    // When: source arrives before the process exit event.
    child.emitMessage({ kind: 'source', source: 'generated source' });
    await Promise.resolve();

    // Then: completion remains pending until exit and leaves no retained listeners afterward.
    expect(state).toBe('pending');
    expect(child.errorListeners.size).toBe(1);
    expect(child.exitListeners.size).toBe(1);
    expect(child.messageListeners.size).toBe(1);
    child.emitExit(0, null);
    await expect(result).resolves.toBe('generated source');
    expect(child.errorListeners.size).toBe(0);
    expect(child.exitListeners.size).toBe(0);
    expect(child.messageListeners.size).toBe(0);
  });
});
