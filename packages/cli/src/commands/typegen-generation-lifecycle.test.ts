import { describe, expect, it } from 'vitest';

import {
  type TypegenGenerationChild,
  waitForTypegenGenerationChild,
} from './typegen-generation-process.js';

class FakeGenerationChild implements TypegenGenerationChild {
  readonly errorListeners = new Set<(error: Error) => void>();
  readonly exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
  readonly messageListeners = new Set<(message: unknown) => void>();

  kill(_signal: NodeJS.Signals): boolean {
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
