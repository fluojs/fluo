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

function createDeferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolveResult: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveResult = resolve;
  });
  return { promise, resolve: resolveResult };
}

async function waitForSignal(signal: Promise<void>, description: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${description}.`));
        }, 1_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

describe('fluo typegen watch cancellation', () => {
  it('cancels a generation before child completion without committing stale source', async () => {
    // Given: a coordinator-owned child generation that has not completed.
    const signalTarget = createSignalTarget();
    const cancel = vi.fn();
    const commit = vi.fn(async () => undefined);
    const watcher: TypegenWatcher = { close: vi.fn(), on: () => watcher };
    const cancellationRequested = createDeferred<void>();
    const generationStarted = createDeferred<void>();
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
            cancellationRequested.resolve();
          },
          result: new Promise<string>((_resolve, reject) => {
            generationStarted.resolve();
            rejectGeneration = reject;
          }),
        };
      },
      watchTarget: () => watcher,
    });

    // When: terminal shutdown arrives before the child can complete.
    await waitForSignal(generationStarted.promise, 'the initial generation to start');
    signalTarget.emit('SIGTERM');
    await waitForSignal(cancellationRequested.promise, 'generation cancellation');
    rejectGeneration(new Error('generation cancelled'));

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
    const cancellationRequested = createDeferred<void>();
    const generationStarted = createDeferred<void>();
    let rejectGeneration: (error: Error) => void = () => undefined;
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
            cancellationRequested.resolve();
          },
          result: new Promise<string>((_resolve, reject) => {
            generationStarted.resolve();
            rejectGeneration = reject;
          }),
        };
      },
      watchTarget: () => watcher,
    });

    // When: shutdown races with the child process completion boundary.
    await waitForSignal(generationStarted.promise, 'the initial generation to start');
    signalTarget.emit('SIGTERM');
    await waitForSignal(cancellationRequested.promise, 'generation cancellation');
    rejectGeneration(new Error('generation cancelled'));

    // Then: a reported-but-incomplete result cannot publish after cancellation.
    await expect(result).resolves.toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });
});
