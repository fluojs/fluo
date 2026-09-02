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
    // Given: caller-process generation is paused before bootstrap, then its application close is held.
    const signalTarget = createSignalTarget();
    const bootstrapStarted = createDeferred<void>();
    const releaseBootstrap = createDeferred<void>();
    const cleanupStarted = createDeferred<void>();
    const releaseCleanup = createDeferred<void>();
    const cancellationRequested = createDeferred<void>();
    const generationStarted = createDeferred<void>();
    const stderr: string[] = [];
    const watcher: TypegenWatcher = { close: vi.fn(), on: vi.fn(() => watcher) };
    let callerGeneration: TypegenWatchGeneration | undefined;
    let cleanupFinished = false;
    const close = vi.fn(async () => {
      cleanupStarted.resolve();
      await releaseCleanup.promise;
      cleanupFinished = true;
    });
    vi.resetModules();
    vi.doMock('./typegen-watch.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./typegen-watch.js')>();
      return {
        ...actual,
        runTypegenWatch(options: TypegenWatchOptions) {
          return actual.runTypegenWatch({
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
              create: async () => {
                bootstrapStarted.resolve();
                await releaseBootstrap.promise;
                return {
                  close,
                  dispatcher: { describeRoutes: () => [] },
                };
              },
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
      await generationStarted.promise;
      if (callerGeneration === undefined) {
        throw new Error('Caller-process generation did not start.');
      }
      let generationRejectedBeforeCleanup = false;
      void callerGeneration.result.catch(() => {
        generationRejectedBeforeCleanup = !cleanupFinished;
      });
      await bootstrapStarted.promise;

      // When: shutdown reaches the active caller-process generation before it can finish bootstrap.
      signalTarget.emit('SIGTERM');
      await cancellationRequested.promise;
      releaseBootstrap.resolve();
      await cleanupStarted.promise;

      // Then: watch ownership is retained until the application's asynchronous close completes.
      releaseCleanup.resolve();
      await expect(callerGeneration.result).rejects.toThrow('Typegen generation was cancelled.');
      await expect(action).resolves.toBe(0);
      expect(generationRejectedBeforeCleanup).toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(stderr).toEqual([]);
    } finally {
      vi.doUnmock('./typegen-watch.js');
      vi.resetModules();
    }
  });
});
