import { mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeTypegenArtifact } from './typegen-artifact.js';
import {
  runTypegenWatch,
  type TypegenWatcher,
  type TypegenWatchScheduler,
  type TypegenWatchSignalTarget,
} from './typegen-watch.js';

const tempDirectories: string[] = [];

function createScheduler(): TypegenWatchScheduler & { flush(): void } {
  let sequence = 0;
  const callbacks = new Map<number, () => void>();
  return {
    clear(handle) {
      callbacks.delete(handle);
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback();
      }
    },
    set(callback) {
      sequence += 1;
      callbacks.set(sequence, callback);
      return sequence;
    },
  };
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

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('fluo typegen watch lifecycle', () => {
  it('coalesces rapid changes, serializes regeneration, and shuts down cleanly', async () => {
    // Given: a successful startup generation and an injectable watcher lifecycle.
    const scheduler = createScheduler();
    const signalTarget = createSignalTarget();
    const close = vi.fn();
    let listener: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const watcher: TypegenWatcher = { close, on: vi.fn(() => watcher) };
    const watchTarget = vi.fn((_target, _options, nextListener) => {
      listener = nextListener;
      return watcher;
    });
    let active = 0;
    let maximumActive = 0;
    let releaseSecondGeneration: (() => void) | undefined;
    let generationCount = 0;
    const generate = vi.fn(async () => {
      generationCount += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (generationCount === 2) {
        await new Promise<void>((resolve) => {
          releaseSecondGeneration = resolve;
        });
      }
      active -= 1;
    });
    const runPromise = runTypegenWatch({
      generate,
      modulePath: '/project/src/app.ts',
      outputPath: '/project/src/generated/react-pages.ts',
      scheduler,
      signalTarget,
      watchTarget,
    });
    await vi.waitFor(() => expect(watchTarget).toHaveBeenCalledOnce());
    listener?.('change', 'generated/react-pages.ts');
    scheduler.flush();
    expect(generate).toHaveBeenCalledOnce();

    // When: save bursts arrive before and during one pending regeneration.
    listener?.('change', 'page.tsx');
    listener?.('change', 'router.ts');
    scheduler.flush();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    listener?.('change', 'layout.tsx');
    listener?.('change', 'metadata.ts');
    scheduler.flush();
    releaseSecondGeneration?.();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    signalTarget.emit('SIGTERM');

    // Then: bursts become one serialized rerun and shutdown releases every owned listener.
    await expect(runPromise).resolves.toBe(0);
    expect(maximumActive).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves the last valid artifact after a watch regeneration failure and recovers later', async () => {
    // Given: startup publishes one valid artifact and the next authoritative bootstrap fails.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-typegen-watch-'));
    tempDirectories.push(cwd);
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    const scheduler = createScheduler();
    const signalTarget = createSignalTarget();
    const onError = vi.fn();
    let listener: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const watcher: TypegenWatcher = { close: vi.fn(), on: vi.fn(() => watcher) };
    const watchTarget = vi.fn((_target, _options, nextListener) => {
      listener = nextListener;
      return watcher;
    });
    let generationCount = 0;
    const generate = vi.fn(async () => {
      generationCount += 1;
      if (generationCount === 2) {
        throw new Error('application bootstrap failed');
      }
      await writeTypegenArtifact(outputPath, generationCount === 1 ? 'valid one\n' : 'valid two\n');
    });
    const runPromise = runTypegenWatch({
      generate,
      modulePath: join(cwd, 'src', 'app.ts'),
      onError,
      outputPath,
      scheduler,
      signalTarget,
      watchTarget,
    });
    await vi.waitFor(() => expect(watchTarget).toHaveBeenCalledOnce());

    // When: one failed generation is followed by another source change.
    listener?.('change', 'page.tsx');
    scheduler.flush();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const artifactAfterFailure = await readFile(outputPath, 'utf8');
    listener?.('change', 'page.tsx');
    scheduler.flush();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    await vi.waitFor(async () => expect(await readFile(outputPath, 'utf8')).toBe('valid two\n'));
    signalTarget.emit('SIGINT');

    // Then: failure never replaces the prior file and a later valid run commits normally.
    expect(artifactAfterFailure).toBe('valid one\n');
    await expect(runPromise).resolves.toBe(0);
  });

  it('does not rewrite an unchanged artifact after a watched source event', async () => {
    // Given: startup generated one artifact and its timestamp records the last meaningful catalog change.
    const cwd = await mkdtemp(join(tmpdir(), 'fluo-typegen-watch-unchanged-'));
    tempDirectories.push(cwd);
    const outputPath = join(cwd, 'generated', 'react-pages.ts');
    const scheduler = createScheduler();
    const signalTarget = createSignalTarget();
    let listener: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const watcher: TypegenWatcher = { close: vi.fn(), on: vi.fn(() => watcher) };
    const watchTarget = vi.fn((_target, _options, nextListener) => {
      listener = nextListener;
      return watcher;
    });
    const generate = vi.fn(async () => {
      await writeTypegenArtifact(outputPath, 'stable artifact\n');
    });
    const runPromise = runTypegenWatch({
      generate,
      modulePath: join(cwd, 'src', 'app.ts'),
      outputPath,
      scheduler,
      signalTarget,
      watchTarget,
    });
    await vi.waitFor(() => expect(watchTarget).toHaveBeenCalledOnce());
    const oldTimestamp = new Date('2020-01-01T00:00:00.000Z');
    await utimes(outputPath, oldTimestamp, oldTimestamp);

    // When: a watched save produces the same authoritative catalog bytes.
    listener?.('change', 'page.tsx');
    scheduler.flush();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    signalTarget.emit('SIGTERM');

    // Then: regeneration reports no write through the preserved filesystem timestamp.
    await expect(runPromise).resolves.toBe(0);
    expect((await stat(outputPath)).mtimeMs).toBe(oldTimestamp.getTime());
  });

  it('does not install watchers or signal handlers when startup generation fails', async () => {
    // Given: the first application bootstrap cannot produce an artifact.
    const startupError = new Error('startup bootstrap failed');
    const signalTarget = createSignalTarget();
    const watchTarget = vi.fn();

    // When: watch mode performs its deterministic startup generation.
    const action = runTypegenWatch({
      generate: async () => {
        throw startupError;
      },
      modulePath: '/project/src/app.ts',
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      watchTarget,
    });

    // Then: startup fails before any long-lived resource is acquired.
    await expect(action).rejects.toBe(startupError);
    expect(watchTarget).not.toHaveBeenCalled();
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
      generate: async () => undefined,
      modulePath: '/project/src/app.ts',
      onReady() {
        throw readyError;
      },
      outputPath: '/project/src/generated/react-pages.ts',
      signalTarget,
      watchTarget: () => watcher,
    });

    // Then: setup rejects with the original failure after releasing every acquired resource.
    await expect(action).rejects.toBe(readyError);
    expect(close).toHaveBeenCalledOnce();
    expect(signalTarget.off).toHaveBeenCalledTimes(2);
  });
});
