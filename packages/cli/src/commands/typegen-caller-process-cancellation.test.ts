import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { TypegenCommandRuntimeOptions } from './typegen.js';
import type {
  TypegenWatcher,
  TypegenWatchGeneration,
  TypegenWatchOptions,
  TypegenWatchSignalTarget,
} from './typegen-watch.js';

const fixtureModulePath = `${dirname(fileURLToPath(import.meta.url))}/../fixtures/typegen-react-app.module.ts`;

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

describe('fluo typegen caller-process cancellation', () => {
  it('waits for application cleanup before ending a cancelled watch', async () => {
    // Given: caller-process generation has reached application close, which remains explicitly pending.
    const signalTarget = createSignalTarget();
    const applicationCloseStarted = createDeferred<void>();
    const releaseApplicationClose = createDeferred<void>();
    const cancellationRequested = createDeferred<void>();
    const generationStarted = createDeferred<void>();
    const stderr: string[] = [];
    const watcher: TypegenWatcher = { close: vi.fn(), on: vi.fn(() => watcher) };
    let callerGeneration: TypegenWatchGeneration | undefined;
    let runTypegenWatchResult: Promise<number> | undefined;
    let applicationClosed = false;
    const close = vi.fn(async () => {
      applicationCloseStarted.resolve();
      await releaseApplicationClose.promise;
      applicationClosed = true;
    });
    vi.resetModules();
    vi.doMock('./typegen-watch.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./typegen-watch.js')>();
      return {
        ...actual,
        runTypegenWatch(options: TypegenWatchOptions) {
          const result = actual.runTypegenWatch({
            ...options,
            signalTarget,
            startGeneration() {
              const generation = options.startGeneration();
              callerGeneration = generation;
              generationStarted.resolve();
              return {
                cancel() {
                  generation.cancel();
                  cancellationRequested.resolve();
                },
                result: generation.result,
              };
            },
            watchTarget: () => watcher,
          });
          runTypegenWatchResult = result;
          return result;
        },
      };
    });

    try {
      const { runTypegenCommand } = await import('./typegen.js');
      const runtime: TypegenCommandRuntimeOptions = {
        cwd: '/project',
        loadReactTypegenModules: async () => ({
          react: { createReactPageCatalog: () => [] },
          runtime: {
            FluoFactory: Object.assign(() => undefined, {
              create: async () => ({
                close,
                dispatcher: { describeRoutes: () => [] },
              }),
            }),
          },
          typegen: { generateReactPageTypes: () => 'source' },
        }),
        stderr: { write: (message) => stderr.push(message) },
      };
      const action = runTypegenCommand([
        fixtureModulePath,
        '--output',
        '/project/generated/react-pages.ts',
        '--watch',
      ], runtime);
      await waitForSignal(generationStarted.promise, 'caller-process generation startup');
      if (callerGeneration === undefined || runTypegenWatchResult === undefined) {
        throw new Error('Caller-process generation did not start.');
      }
      let watchSettled = false;
      void runTypegenWatchResult.then(() => {
        watchSettled = true;
      });
      await waitForSignal(applicationCloseStarted.promise, 'application.close() to start');

      // When: shutdown reaches the pending application close lifecycle.
      signalTarget.emit('SIGTERM');
      await waitForSignal(cancellationRequested.promise, 'caller-process cancellation');
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      // Then: cancellation cannot settle the watch before application close releases generation ownership.
      expect(applicationClosed).toBe(false);
      expect(watchSettled).toBe(false);
      releaseApplicationClose.resolve();
      await expect(callerGeneration.result).rejects.toThrow('Typegen generation was cancelled.');
      await expect(runTypegenWatchResult).resolves.toBe(0);
      await expect(action).resolves.toBe(0);
      expect(close).toHaveBeenCalledOnce();
      expect(watcher.close).toHaveBeenCalledOnce();
      expect(stderr).toEqual([]);
    } finally {
      vi.doUnmock('./typegen-watch.js');
      vi.resetModules();
    }
  });
});
