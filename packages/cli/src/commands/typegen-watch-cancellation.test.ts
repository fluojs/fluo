import { describe, expect, it, vi } from 'vitest';

import {
  runTypegenWatch,
  type TypegenWatcher,
  type TypegenWatchSignalTarget,
} from './typegen-watch.js';

function createSignalTarget(): TypegenWatchSignalTarget & { emit(signal: 'SIGINT' | 'SIGTERM'): void } {
  const listeners = new Map<'SIGINT' | 'SIGTERM', () => void>();
  return {
    emit(signal) {
      listeners.get(signal)?.();
    },
    off(signal, listener) {
      if (listeners.get(signal) === listener) {
        listeners.delete(signal);
      }
    },
    once(signal, listener) {
      listeners.set(signal, listener);
    },
  };
}

describe('fluo typegen watch cancellation', () => {
  it('cancels a generation before child completion without committing stale source', async () => {
    // Given: a coordinator-owned child generation that has not completed.
    const signalTarget = createSignalTarget();
    const cancel = vi.fn();
    const commit = vi.fn(async () => undefined);
    const watcher: TypegenWatcher = { close: vi.fn(), on: () => watcher };
    let rejectGeneration: (error: Error) => void = () => undefined;
    const result = runTypegenWatch({
      commit,
      modulePath: '/project/src/app.ts',
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      startGeneration() {
        return {
          cancel() {
            cancel();
            rejectGeneration(new Error('generation cancelled'));
          },
          result: new Promise<string>((_resolve, reject) => {
            rejectGeneration = reject;
          }),
        };
      },
      watchTarget: () => watcher,
    });

    // When: terminal shutdown arrives before the child can complete.
    signalTarget.emit('SIGTERM');

    // Then: the coordinator cancels its child and never commits a stale artifact.
    await expect(result).resolves.toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels during child completion without committing its reported source', async () => {
    // Given: a child has reported source but remains incomplete until its process exit settles.
    const signalTarget = createSignalTarget();
    const cancel = vi.fn();
    const commit = vi.fn(async () => undefined);
    let rejectGeneration: (error: Error) => void = () => undefined;
    let sourceReported = false;
    const watcher: TypegenWatcher = { close: vi.fn(), on: () => watcher };
    const result = runTypegenWatch({
      commit,
      modulePath: '/project/src/app.ts',
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      startGeneration() {
        return {
          cancel() {
            cancel();
            rejectGeneration(new Error('generation cancelled'));
          },
          result: new Promise<string>((_resolve, reject) => {
            sourceReported = true;
            rejectGeneration = reject;
          }),
        };
      },
      watchTarget: () => watcher,
    });
    await vi.waitFor(() => expect(sourceReported).toBe(true));

    // When: shutdown races with the child process completion boundary.
    signalTarget.emit('SIGTERM');

    // Then: a reported-but-incomplete result cannot publish after cancellation.
    await expect(result).resolves.toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
});
