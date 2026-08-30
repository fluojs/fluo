import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runNodeRestartRunner } from './node-restart-runner.js';

const createdDirectories: string[] = [];

class TestWatcher extends EventEmitter {
  closed = false;

  close(): void {
    this.closed = true;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

function createMockChild(signals: Array<NodeJS.Signals | undefined>): ChildProcess {
  const child = new ChildProcess();
  Object.defineProperty(child, 'exitCode', { configurable: true, value: null, writable: true });
  Object.defineProperty(child, 'killed', { configurable: true, value: false, writable: true });
  child.kill = (signal?: NodeJS.Signals) => {
    signals.push(signal);
    Object.defineProperty(child, 'killed', { configurable: true, value: true, writable: true });
    return true;
  };
  return child;
}

function closeMockChild(child: ChildProcess, code: number): void {
  Object.defineProperty(child, 'exitCode', { configurable: true, value: code, writable: true });
  child.emit('close', code);
}

function createSignalTarget(): {
  readonly offCalls: string[];
  readonly target: {
    off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
    once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  };
} {
  const offCalls: string[] = [];
  return {
    offCalls,
    target: {
      off: (signal) => {
        offCalls.push(signal);
      },
      once: () => undefined,
    },
  };
}

function createManualRestartScheduler(): {
  readonly clearCalls: number[];
  clear(handle: ReturnType<typeof setTimeout> | number): void;
  flush(): void;
  set(callback: () => void, delayMs: number): number;
} {
  const callbacks = new Map<number, () => void>();
  const clearCalls: number[] = [];
  let nextHandle = -1;
  return {
    clear(handle) {
      if (typeof handle === 'number') {
        clearCalls.push(handle);
        callbacks.delete(handle);
      }
    },
    clearCalls,
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pendingCallbacks) {
        callback();
      }
    },
    set(callback, _delayMs) {
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle;
    },
  };
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Node restart runner watcher failures', () => {
  it('routes a primary watcher error through terminal cleanup during an active restart', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    const sourceFile = join(sourceDirectory, 'main.ts');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(sourceFile, 'console.log("one");\n');
    const watchers = new Map<string, TestWatcher>();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = createSignalTarget();
    const scheduler = createManualRestartScheduler();
    const stderr: string[] = [];
    const children: ChildProcess[] = [];

    const runPromise = runNodeRestartRunner({
      debounceMs: 1,
      env: {},
      projectDirectory: workspaceDirectory,
      restartScheduler: scheduler,
      signalTarget: signalTarget.target,
      spawnChild: () => {
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      stderr: { write: (message) => stderr.push(message) },
      watchTarget: (target, optionsOrListener, listener) => {
        const watcher = new TestWatcher();
        watchers.set(target, watcher);
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return watcher;
      },
    });

    writeFileSync(sourceFile, 'console.log("two");\n');
    listeners.get(sourceDirectory)?.('change', 'main.ts');
    scheduler.flush();
    listeners.get(sourceDirectory)?.('change', 'main.ts');
    expect(children).toHaveLength(1);
    expect(signals).toEqual(['SIGTERM']);
    watchers.get(sourceDirectory)?.emit('error', new Error('primary watcher failed'));
    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    scheduler.flush();
    expect(children).toHaveLength(1);
    expect(scheduler.clearCalls).toEqual([1]);
    expect([...watchers.values()].every((watcher) => watcher.closed)).toBe(true);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(signals).toEqual(['SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] watcher failed for ${sourceDirectory}: primary watcher failed`);
  });

  it('routes a fallback watcher error through terminal cleanup during an active restart', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    const nestedDirectory = join(sourceDirectory, 'features');
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(join(nestedDirectory, 'feature.ts'), 'export const feature = true;\n');
    const fallbackWatchers = new Map<string, TestWatcher>();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = createSignalTarget();
    const scheduler = createManualRestartScheduler();
    const stderr: string[] = [];
    const children: ChildProcess[] = [];

    const runPromise = runNodeRestartRunner({
      debounceMs: 1,
      env: {},
      projectDirectory: workspaceDirectory,
      restartScheduler: scheduler,
      signalTarget: signalTarget.target,
      spawnChild: () => {
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      stderr: { write: (message) => stderr.push(message) },
      watchTarget: (target, optionsOrListener) => {
        if (typeof optionsOrListener !== 'function') {
          throw new Error('recursive watch unavailable');
        }
        const watcher = new TestWatcher();
        fallbackWatchers.set(target, watcher);
        listeners.set(target, optionsOrListener);
        return watcher;
      },
    });

    writeFileSync(join(nestedDirectory, 'feature.ts'), 'export const feature = false;\n');
    listeners.get(nestedDirectory)?.('change', 'feature.ts');
    scheduler.flush();
    listeners.get(nestedDirectory)?.('change', 'feature.ts');
    expect(children).toHaveLength(1);
    expect(signals).toEqual(['SIGTERM']);
    fallbackWatchers.get(nestedDirectory)?.emit('error', new Error('fallback watcher failed'));
    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    scheduler.flush();
    expect(children).toHaveLength(1);
    expect(scheduler.clearCalls).toEqual([1]);
    expect([...fallbackWatchers.values()].every((watcher) => watcher.closed)).toBe(true);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(signals).toEqual(['SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] watcher failed for ${nestedDirectory}: fallback watcher failed`);
  });

  it('stops the child when recursive and fallback source watcher acquisition fails', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    const nestedDirectory = join(sourceDirectory, 'features');
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(join(nestedDirectory, 'feature.ts'), 'export const feature = true;\n');
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = createSignalTarget();
    const stderr: string[] = [];
    const children: ChildProcess[] = [];

    const runPromise = runNodeRestartRunner({
      env: {},
      projectDirectory: workspaceDirectory,
      signalTarget: signalTarget.target,
      spawnChild: () => {
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      stderr: { write: (message) => stderr.push(message) },
      watchTarget: () => {
        throw new Error('watcher unavailable');
      },
    });

    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(signals).toEqual(['SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] watcher failed for ${sourceDirectory}:`);
  });

  it('stops the child when a required fallback source watcher cannot be acquired', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    const nestedDirectory = join(sourceDirectory, 'features');
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(join(nestedDirectory, 'feature.ts'), 'export const feature = true;\n');
    const fallbackWatchers = new Map<string, TestWatcher>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = createSignalTarget();
    const stderr: string[] = [];
    const children: ChildProcess[] = [];

    const runPromise = runNodeRestartRunner({
      env: {},
      projectDirectory: workspaceDirectory,
      signalTarget: signalTarget.target,
      spawnChild: () => {
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      stderr: { write: (message) => stderr.push(message) },
      watchTarget: (target, optionsOrListener) => {
        if (typeof optionsOrListener !== 'function') {
          throw new Error('recursive watch unavailable');
        }
        if (target === nestedDirectory) {
          throw new Error('nested watcher unavailable');
        }
        const watcher = new TestWatcher();
        fallbackWatchers.set(target, watcher);
        return watcher;
      },
    });

    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    expect([...fallbackWatchers.values()].every((watcher) => watcher.closed)).toBe(true);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(signals).toEqual(['SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] unable to watch ${nestedDirectory}: nested watcher unavailable`);
  });

  it('stops the child when a dynamically discovered fallback watcher cannot be acquired', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    const dynamicDirectory = join(sourceDirectory, 'generated');
    mkdirSync(sourceDirectory, { recursive: true });
    const fallbackWatchers = new Map<string, TestWatcher>();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = createSignalTarget();
    const scheduler = createManualRestartScheduler();
    const stderr: string[] = [];
    const children: ChildProcess[] = [];

    const runPromise = runNodeRestartRunner({
      debounceMs: 1,
      env: {},
      projectDirectory: workspaceDirectory,
      restartScheduler: scheduler,
      signalTarget: signalTarget.target,
      spawnChild: () => {
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      stderr: { write: (message) => stderr.push(message) },
      watchTarget: (target, optionsOrListener) => {
        if (typeof optionsOrListener !== 'function') {
          throw new Error('recursive watch unavailable');
        }
        if (target === dynamicDirectory) {
          throw new Error('dynamic watcher unavailable');
        }
        const watcher = new TestWatcher();
        fallbackWatchers.set(target, watcher);
        listeners.set(target, optionsOrListener);
        return watcher;
      },
    });

    mkdirSync(dynamicDirectory);
    writeFileSync(join(dynamicDirectory, 'feature.ts'), 'export const feature = true;\n');
    const sourceListener = listeners.get(sourceDirectory);
    if (!sourceListener) {
      throw new Error('Expected the fallback source listener');
    }
    sourceListener('rename', 'generated');

    expect(signals).toEqual(['SIGTERM']);
    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    expect(scheduler.clearCalls).toEqual([0]);
    expect([...fallbackWatchers.values()].every((watcher) => watcher.closed)).toBe(true);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] unable to watch ${dynamicDirectory}: dynamic watcher unavailable`);
  });
});
