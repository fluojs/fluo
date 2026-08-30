import { watch } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** Scheduler used to debounce typegen filesystem bursts deterministically. */
export type TypegenWatchScheduler = {
  readonly clear: (handle: number) => void;
  readonly set: (callback: () => void, delayMs: number) => number;
};

/** Signal registration boundary owned by one typegen watch invocation. */
export type TypegenWatchSignalTarget = {
  readonly off: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown;
  readonly once: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown;
};

/** Minimal watcher resource acquired by typegen watch mode. */
export type TypegenWatcher = {
  close(): void;
  on(event: 'error', listener: (error: Error) => void): TypegenWatcher;
};

/** One child generation owned by a typegen watch coordinator. */
export type TypegenWatchGeneration = {
  cancel(): void;
  readonly result: Promise<string>;
};

type TypegenWatchTarget = (
  target: string,
  options: { readonly persistent: boolean; readonly recursive: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => TypegenWatcher;

/** Dependencies and callbacks for one bounded typegen watch lifecycle. */
export type TypegenWatchOptions = {
  readonly commit: (source: string) => Promise<void>;
  readonly debounceMs?: number;
  readonly modulePath: string;
  readonly onError?: (error: unknown) => void;
  readonly onReady?: (watchRoot: string) => void;
  readonly outputPath: string;
  readonly scheduler?: TypegenWatchScheduler;
  readonly signalTarget?: TypegenWatchSignalTarget;
  readonly startGeneration: () => TypegenWatchGeneration;
  readonly watchTarget?: TypegenWatchTarget;
};

const DEFAULT_DEBOUNCE_MS = 100;

function createDefaultScheduler(): TypegenWatchScheduler {
  let sequence = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    clear(handle) {
      const timer = timers.get(handle);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(handle);
      }
    },
    set(callback, delayMs) {
      sequence += 1;
      const handle = sequence;
      const timer = setTimeout(() => {
        timers.delete(handle);
        callback();
      }, delayMs);
      timers.set(handle, timer);
      return handle;
    },
  };
}

const defaultWatchTarget: TypegenWatchTarget = (target, options, listener) => watch(target, options, listener);

function isOwnArtifactEvent(changedPath: string, outputPath: string): boolean {
  if (changedPath === outputPath) {
    return true;
  }

  const changedName = basename(changedPath);
  const outputName = basename(outputPath);
  return changedName.startsWith(`.${outputName}.`) && changedName.endsWith('.tmp');
}

/**
 * Watches the application module directory while generating an initial current artifact.
 *
 * @param options Generation, watcher, scheduler, and signal lifecycle dependencies.
 * @returns Exit code `0` after signal shutdown or `1` after an asynchronous watcher failure.
 */
export async function runTypegenWatch(options: TypegenWatchOptions): Promise<number> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const onError = options.onError ?? (() => undefined);
  const scheduler = options.scheduler ?? createDefaultScheduler();
  const signalTarget = options.signalTarget ?? process;
  const watchTarget = options.watchTarget ?? defaultWatchTarget;
  const watchRoot = dirname(options.modulePath);
  let activeGeneration: TypegenWatchGeneration | undefined;
  let cleanedUp = false;
  let rerunRequested = false;
  let resolved = false;
  let restartTimer: number | undefined;
  let stopping = false;
  let stopCode = 0;
  let watcher: TypegenWatcher | undefined;
  let startupComplete = false;
  let resolveResult: (code: number) => void = () => undefined;

  const result = new Promise<number>((resolvePromise) => {
    resolveResult = resolvePromise;
  });

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    if (restartTimer !== undefined) {
      scheduler.clear(restartTimer);
      restartTimer = undefined;
    }
    watcher?.close();
    signalTarget.off('SIGINT', stopForSignal);
    signalTarget.off('SIGTERM', stopForSignal);
  };

  const settleIfIdle = () => {
    if (!stopping || activeGeneration !== undefined || resolved) {
      return;
    }
    resolved = true;
    resolveResult(stopCode);
  };

  const stop = (code: number) => {
    stopCode = Math.max(stopCode, code);
    if (!stopping) {
      stopping = true;
      cleanup();
      activeGeneration?.cancel();
    }
    settleIfIdle();
  };

  function stopForSignal(): void {
    stop(0);
  }

  const runGeneration = async (reportError: boolean): Promise<void> => {
    let generation: TypegenWatchGeneration | undefined;
    try {
      generation = options.startGeneration();
      activeGeneration = generation;
      const source = await generation.result;
      if (!stopping) {
        await options.commit(source);
      }
    } catch (error: unknown) {
      if (stopping) {
        return;
      }
      if (reportError) {
        onError(error);
        return;
      }
      throw error;
    } finally {
      if (activeGeneration === generation) {
        activeGeneration = undefined;
        settleIfIdle();
      }
    }
  };

  const regenerate = () => {
    if (stopping) {
      return;
    }
    if (activeGeneration !== undefined) {
      rerunRequested = true;
      return;
    }

    void (async () => {
      do {
        rerunRequested = false;
        await runGeneration(true);
      } while (rerunRequested && !stopping);
    })();
  };

  const scheduleRegeneration = (changedPath: string) => {
    if (stopping || isOwnArtifactEvent(changedPath, options.outputPath)) {
      return;
    }
    if (!startupComplete) {
      rerunRequested = true;
      return;
    }
    if (restartTimer !== undefined) {
      scheduler.clear(restartTimer);
    }
    restartTimer = scheduler.set(() => {
      restartTimer = undefined;
      regenerate();
    }, debounceMs);
  };

  try {
    watcher = watchTarget(
      watchRoot,
      { persistent: true, recursive: true },
      (_event, filename) => {
        const changedPath = filename === null ? watchRoot : resolve(watchRoot, String(filename));
        scheduleRegeneration(changedPath);
      },
    );
    watcher.on('error', (error) => {
      onError(error);
      stop(1);
    });
  } catch (error: unknown) {
    watcher?.close();
    throw error;
  }

  try {
    signalTarget.once('SIGINT', stopForSignal);
    signalTarget.once('SIGTERM', stopForSignal);
    await (async () => {
      do {
        rerunRequested = false;
        await runGeneration(false);
      } while (rerunRequested && !stopping);
    })();
    startupComplete = true;
    if (stopping) {
      return result;
    }
    options.onReady?.(watchRoot);
  } catch (error: unknown) {
    cleanup();
    throw error;
  }
  return result;
}
