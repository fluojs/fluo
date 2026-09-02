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

describe('fluo typegen watch startup barrier', () => {
  it('withholds a change-invalidated initial generation before reporting ready', async () => {
    // Given: initial generation has captured stale source while the watcher can observe a newer save.
    const signalTarget = createSignalTarget();
    const publishedSources: string[] = [];
    const readySources: string[] = [];
    let currentSource = 'stale source';
    let listener: ((event: string, filename: string | Buffer | null) => void) | undefined;
    let releaseInitialGeneration: (() => void) | undefined;
    let signalInitialGenerationStarted: (() => void) | undefined;
    let signalCurrentSourcePublished: (() => void) | undefined;
    let signalReady: (() => void) | undefined;
    const initialGenerationStarted = new Promise<void>((resolve) => {
      signalInitialGenerationStarted = resolve;
    });
    const currentSourcePublished = new Promise<void>((resolve) => {
      signalCurrentSourcePublished = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const watcher: TypegenWatcher = { close: vi.fn(), on: vi.fn(() => watcher) };
    const watchTarget = vi.fn((_target, _options, nextListener) => {
      listener = nextListener;
      return watcher;
    });
    const generate = vi.fn(async () => {
      const capturedSource = currentSource;
      if (generate.mock.calls.length === 1) {
        signalInitialGenerationStarted?.();
        await new Promise<void>((resolve) => {
          releaseInitialGeneration = resolve;
        });
      }
      return capturedSource;
    });
    const runPromise = runTypegenWatch({
      commit: async (source) => {
        publishedSources.push(source);
        if (source === 'current source') {
          signalCurrentSourcePublished?.();
        }
      },
      modulePath: '/project/src/app.ts',
      onReady() {
        readySources.push(publishedSources.at(-1) ?? 'missing');
        signalReady?.();
      },
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      startGeneration() {
        return { cancel: () => undefined, result: generate() };
      },
      watchTarget,
    });

    try {
      await initialGenerationStarted;
      if (listener === undefined || releaseInitialGeneration === undefined) {
        throw new Error('Typegen watch startup generation did not install its event boundary.');
      }

      // When: source changes before the initial generation can publish its captured bytes.
      currentSource = 'current source';
      listener('change', 'page.tsx');
      releaseInitialGeneration();

      // Then: startup performs a buffered rerun and reports ready only after current bytes publish.
      await currentSourcePublished;
      await ready;
      expect(publishedSources).toEqual(['current source']);
      expect(readySources).toEqual(['current source']);
    } finally {
      releaseInitialGeneration?.();
      expect(watchTarget).toHaveBeenCalledOnce();
      signalTarget.emit('SIGTERM');
      await runPromise;
    }
  });

  it('releases the preinstalled watcher and signal handlers when startup generation fails', async () => {
    // Given: the watcher is active before an application bootstrap that cannot produce an artifact.
    const startupError = new Error('startup bootstrap failed');
    const close = vi.fn();
    const watcher: TypegenWatcher = { close, on: vi.fn(() => watcher) };
    const signalTarget: TypegenWatchSignalTarget = {
      off: vi.fn(),
      once: vi.fn(),
    };
    const watchTarget = vi.fn(() => watcher);

    // When: watch mode performs its deterministic startup generation.
    const action = runTypegenWatch({
      commit: async () => undefined,
      modulePath: '/project/src/app.ts',
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      startGeneration() {
        return {
          cancel: () => undefined,
          result: Promise.reject(startupError),
        };
      },
      watchTarget,
    });

    // Then: startup rejects with the original failure after releasing every acquired resource.
    await expect(action).rejects.toBe(startupError);
    expect(watchTarget).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(signalTarget.off).toHaveBeenCalledTimes(2);
  });

  it('releases the watcher and signal handlers when ready notification fails', async () => {
    // Given: startup generation and watcher acquisition succeed but the ready output boundary fails.
    const readyError = new Error('ready output failed');
    const close = vi.fn();
    const watcher: TypegenWatcher = { close, on: vi.fn(() => watcher) };
    const signalTarget: TypegenWatchSignalTarget = {
      off: vi.fn(),
      once: vi.fn(),
    };

    // When: watch mode announces that its long-running lifecycle is ready.
    const action = runTypegenWatch({
      commit: async () => undefined,
      modulePath: '/project/src/app.ts',
      onReady() {
        throw readyError;
      },
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      startGeneration() {
        return { cancel: () => undefined, result: Promise.resolve('source') };
      },
      watchTarget: () => watcher,
    });

    // Then: setup rejects with the original failure after releasing every acquired resource.
    await expect(action).rejects.toBe(readyError);
    expect(close).toHaveBeenCalledOnce();
    expect(signalTarget.off).toHaveBeenCalledTimes(2);
  });
});
