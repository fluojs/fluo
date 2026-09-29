import { ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createContentChangeGate, runNodeRestartRunner } from './node-restart-runner.js';

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
    on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  };
} {
  const offCalls: string[] = [];
  return {
    offCalls,
    target: {
      off: (signal) => {
        offCalls.push(signal);
      },
      on: () => undefined,
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
  it('keeps the app child running for Vite-owned React and CSS graph edits', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-react-hmr-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    mkdirSync(sourceDirectory);
    const page = join(sourceDirectory, 'page.tsx');
    const styles = join(sourceDirectory, 'styles.css');
    const client = join(sourceDirectory, 'client.ts');
    writeFileSync(page, 'export const Page = () => null;\n');
    writeFileSync(styles, 'body { color: red; }\n');
    writeFileSync(client, 'export const label = "first";\n');
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const scheduler = createManualRestartScheduler();
    const children: ChildProcess[] = [];
    const signalTarget = new EventEmitter();
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory: workspaceDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => {
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      watchTarget: (target, optionsOrListener, listener) => {
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return new TestWatcher();
      },
    });
    const child = children[0];
    if (!child) throw new Error('Expected React child.');
    child.emit('message', { type: 'fluo:react-vite-hmr-files', files: [page, styles, client] });

    writeFileSync(page, 'export const Page = () => <main />;\n');
    listeners.get(sourceDirectory)?.('change', 'page.tsx');
    scheduler.flush();
    writeFileSync(styles, 'body { color: blue; }\n');
    listeners.get(sourceDirectory)?.('change', 'styles.css');
    scheduler.flush();
    writeFileSync(client, 'export const label = "next";\n');
    listeners.get(sourceDirectory)?.('change', 'client.ts');
    scheduler.flush();

    expect(children).toHaveLength(1);
    expect(signals).toEqual([]);
    signalTarget.emit('SIGTERM');
    closeMockChild(child, 0);
    await expect(running).resolves.toBe(0);
  });

  it('replays a Vite-owned change when its watcher missed the corrected contents', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-react-recovery-'));
    createdDirectories.push(projectDirectory);
    const sourceDirectory = join(projectDirectory, 'src');
    mkdirSync(sourceDirectory);
    const page = join(sourceDirectory, 'page.tsx');
    writeFileSync(page, 'export const Page = () => "initial";\n');
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const messages: unknown[] = [];
    const scheduler = createManualRestartScheduler();
    const signalTarget = new EventEmitter();
    const child = createMockChild(signals);
    child.send = (message) => { messages.push(message); return true; };
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => child,
      watchTarget: (target, optionsOrListener, listener) => {
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return new TestWatcher();
      },
    });

    child.emit('message', { type: 'fluo:react-vite-hmr-file', file: page });
    const invalidSource = 'export const Page = () => "invalid";\n';
    writeFileSync(page, invalidSource);
    child.emit('message', {
      type: 'fluo:react-vite-hmr-observed',
      file: page,
      digest: createHash('sha256').update(invalidSource).digest('hex'),
    });
    listeners.get(sourceDirectory)?.('change', 'page.tsx');
    scheduler.flush();
    expect(messages).toEqual([]);

    writeFileSync(page, 'export const Page = () => "recovered";\n');
    listeners.get(sourceDirectory)?.('change', 'page.tsx');
    scheduler.flush();

    expect(messages).toEqual([{ type: 'fluo:react-vite-hmr-reconcile', file: page }]);
    expect(signals).toEqual([]);
    signalTarget.emit('SIGTERM');
    closeMockChild(child, 0);
    await expect(running).resolves.toBe(0);
  });

  it('restarts the server generation inside a React child when server-only source changes', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-react-server-restart-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    mkdirSync(sourceDirectory);
    const page = join(sourceDirectory, 'page.tsx');
    const server = join(sourceDirectory, 'main.ts');
    writeFileSync(page, 'export const Page = () => null;\n');
    writeFileSync(server, 'export const main = 1;\n');
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = new EventEmitter();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const scheduler = createManualRestartScheduler();
    const children: ChildProcess[] = [];
    const messages: unknown[] = [];
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory: workspaceDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => {
        const child = createMockChild(signals);
        child.send = (message) => { messages.push(message); return true; };
        children.push(child);
        return child;
      },
      watchTarget: (target, optionsOrListener, listener) => {
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return new TestWatcher();
      },
    });
    const original = children[0];
    if (!original) throw new Error('Expected original child.');
    original.emit('message', { type: 'fluo:react-vite-host-ready' });
    original.emit('message', { type: 'fluo:react-vite-hmr-file', file: page });

    writeFileSync(server, 'export const main = 2;\n');
    listeners.get(sourceDirectory)?.('change', 'main.ts');
    scheduler.flush();
    expect(signals).toEqual([]);
    expect(messages).toEqual([{ type: 'fluo:react-vite-server-restart', files: [server], reload: false }]);
    expect(children).toHaveLength(1);

    signalTarget.emit('SIGTERM');
    closeMockChild(original, 0);
    await expect(running).resolves.toBe(0);
  });

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

  it('stops the child when the required source target is absent before target discovery', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    const signalTarget = createSignalTarget();
    const stderr: string[] = [];
    const signals: Array<NodeJS.Signals | undefined> = [];
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
      watchTarget: () => new TestWatcher(),
    });

    expect(signals).toEqual(['SIGTERM']);
    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] watcher failed for ${sourceDirectory}: ENOENT`);
  });

  it('stops the child when the source target disappears after target discovery', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(join(sourceDirectory, 'main.ts'), 'export const main = true;\n');
    const watchers = new Map<string, TestWatcher>();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const signalTarget = createSignalTarget();
    const stderr: string[] = [];
    const children: ChildProcess[] = [];

    const runPromise = runNodeRestartRunner({
      env: {},
      projectDirectory: workspaceDirectory,
      signalTarget: signalTarget.target,
      spawnChild: () => {
        rmSync(sourceDirectory, { force: true, recursive: true });
        const child = createMockChild(signals);
        children.push(child);
        return child;
      },
      stderr: { write: (message) => stderr.push(message) },
      watchTarget: (target) => {
        const watcher = new TestWatcher();
        watchers.set(target, watcher);
        return watcher;
      },
    });

    expect(signals).toEqual(['SIGTERM']);
    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    expect(watchers).toHaveLength(0);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(stderr.join('')).toContain(`[fluo] watcher failed for ${sourceDirectory}: ENOENT`);
  });

  it('stops the child when recursive fallback traversal loses source coverage', async () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-watcher-'));
    createdDirectories.push(workspaceDirectory);
    const sourceDirectory = join(workspaceDirectory, 'src');
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(join(sourceDirectory, 'main.ts'), 'export const main = true;\n');
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
          rmSync(sourceDirectory, { force: true, recursive: true });
          throw new Error('recursive watch unavailable');
        }
        const watcher = new TestWatcher();
        fallbackWatchers.set(target, watcher);
        return watcher;
      },
    });

    expect(signals).toEqual(['SIGTERM']);
    const activeChild = children[0];
    if (!activeChild) {
      throw new Error('Expected the active app child');
    }
    closeMockChild(activeChild, 0);

    await expect(runPromise).resolves.toBe(1);
    expect(fallbackWatchers).toHaveLength(0);
    expect(signalTarget.offCalls).toEqual(['SIGINT', 'SIGTERM']);
    expect(stderr.join('')).toContain(
      `[fluo] watcher failed for ${sourceDirectory}: recursive watch unavailable; required fallback watcher could not be acquired`,
    );
  });
});

describe('React Vite development restart', () => {
  it('starts a replacement when a Vite-owned edit follows an unexpected ready child exit', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-exited-hmr-'));
    createdDirectories.push(projectDirectory);
    const source = join(projectDirectory, 'src');
    mkdirSync(source);
    const page = join(source, 'page.tsx');
    writeFileSync(page, 'export const label = "first";\n');
    const scheduler = createManualRestartScheduler();
    const signalTarget = new EventEmitter();
    const children: ChildProcess[] = [];
    const messages: unknown[] = [];
    const watchers: TestWatcher[] = [];
    let onChange: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => {
        const child = createMockChild([]);
        children.push(child);
        return child;
      },
      watchTarget: (target, optionsOrListener, listener) => {
        if (target === source) onChange = typeof optionsOrListener === 'function' ? optionsOrListener : listener;
        const watcher = new TestWatcher();
        watchers.push(watcher);
        return watcher;
      },
    });
    const first = children[0];
    if (!first) throw new Error('Expected the first child.');
    first.emit('message', { type: 'fluo:react-vite-host-ready' });
    first.emit('message', { type: 'fluo:react-vite-hmr-file', file: page });
    closeMockChild(first, 1);
    try {
      expect(watchers.every((watcher) => !watcher.closed)).toBe(true);
      writeFileSync(page, 'export const label = "corrected";\n');
      onChange?.('change', 'page.tsx');
      scheduler.flush();
      expect(children).toHaveLength(2);
      const replacement = children[1];
      if (!replacement) throw new Error('Expected a replacement child.');
      replacement.send = (message) => { messages.push(message); return true; };
      replacement.emit('message', { type: 'fluo:react-vite-host-ready' });
      replacement.emit('message', { type: 'fluo:react-vite-hmr-file', file: page });
      writeFileSync(page, 'export const label = "updated";\n');
      onChange?.('change', 'page.tsx');
      scheduler.flush();
      expect(children).toHaveLength(2);
      expect(messages).toEqual([{ type: 'fluo:react-vite-hmr-reconcile', file: page }]);
    } finally {
      signalTarget.emit('SIGTERM');
      const replacement = children[1];
      if (replacement && replacement.exitCode === null) closeMockChild(replacement, 0);
      await running;
    }
    expect(watchers.every((watcher) => watcher.closed)).toBe(true);
  });

  it('retains watcher coverage after a failed child bootstrap for the next edit', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-failed-bootstrap-'));
    createdDirectories.push(projectDirectory);
    const source = join(projectDirectory, 'src');
    mkdirSync(source);
    const file = join(source, 'main.ts');
    writeFileSync(file, 'export const value = ;\n');
    const scheduler = createManualRestartScheduler();
    const signalTarget = new EventEmitter();
    const children: ChildProcess[] = [];
    const watchers: TestWatcher[] = [];
    let onChange: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => {
        const child = createMockChild([]);
        children.push(child);
        return child;
      },
      watchTarget: (target, optionsOrListener, listener) => {
        if (target === source) onChange = typeof optionsOrListener === 'function' ? optionsOrListener : listener;
        const watcher = new TestWatcher();
        watchers.push(watcher);
        return watcher;
      },
    });
    const failed = children[0];
    if (!failed) throw new Error('Expected the first child.');
    closeMockChild(failed, 1);
    expect(watchers.every((watcher) => !watcher.closed)).toBe(true);

    writeFileSync(file, 'export const value = 1;\n');
    onChange?.('change', 'main.ts');
    scheduler.flush();
    expect(children).toHaveLength(2);
    signalTarget.emit('SIGTERM');
    const corrected = children[1];
    if (!corrected) throw new Error('Expected the corrected child.');
    closeMockChild(corrected, 0);
    await expect(running).resolves.toBe(0);
    expect(watchers.every((watcher) => watcher.closed)).toBe(true);
  });

  it('advances the Studio epoch with each in-process server generation', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-studio-epoch-'));
    createdDirectories.push(projectDirectory);
    const source = join(projectDirectory, 'src');
    mkdirSync(source);
    const server = join(source, 'main.ts');
    writeFileSync(server, 'export const value = 1;\n');
    const env: NodeJS.ProcessEnv = { FLUO_STUDIO: '1', FLUO_STUDIO_TOKEN: 'test-token' };
    const scheduler = createManualRestartScheduler();
    const messages: unknown[] = [];
    const child = createMockChild([]);
    child.send = (message) => { messages.push(message); return true; };
    const signalTarget = new EventEmitter();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const running = runNodeRestartRunner({
      env,
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => child,
      watchTarget: (target, optionsOrListener, listener) => {
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return new TestWatcher();
      },
    });
    const initialEpoch = env.FLUO_STUDIO_EPOCH;
    child.emit('message', { type: 'fluo:react-vite-host-ready' });
    writeFileSync(server, 'export const value = 2;\n');
    listeners.get(source)?.('change', 'main.ts');
    scheduler.flush();
    expect(messages).toEqual([{
      type: 'fluo:react-vite-server-restart',
      files: [server],
      reload: false,
      epoch: env.FLUO_STUDIO_EPOCH,
    }]);
    expect(env.FLUO_STUDIO_EPOCH).not.toBe(initialEpoch);
    signalTarget.emit('SIGTERM');
    closeMockChild(child, 0);
    await expect(running).resolves.toBe(0);
  });

  it('replaces an unready child instead of losing a startup edit through IPC', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-unready-host-'));
    createdDirectories.push(projectDirectory);
    const source = join(projectDirectory, 'src');
    mkdirSync(source);
    const file = join(source, 'main.ts');
    writeFileSync(file, 'export const value = 1;\n');
    const scheduler = createManualRestartScheduler();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const messages: unknown[] = [];
    const children: ChildProcess[] = [];
    const signalTarget = new EventEmitter();
    let onChange: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => {
        const child = createMockChild(signals);
        child.send = (message) => { messages.push(message); return true; };
        children.push(child);
        return child;
      },
      watchTarget: (target, optionsOrListener, listener) => {
        if (target === source) onChange = typeof optionsOrListener === 'function' ? optionsOrListener : listener;
        return new TestWatcher();
      },
    });
    writeFileSync(file, 'export const value = 2;\n');
    onChange?.('change', 'main.ts');
    scheduler.flush();
    expect(messages).toEqual([]);
    expect(signals).toEqual(['SIGTERM']);
    const first = children[0];
    if (!first) throw new Error('Expected the starting child.');
    closeMockChild(first, 0);
    expect(children).toHaveLength(2);
    signalTarget.emit('SIGTERM');
    const second = children[1];
    if (!second) throw new Error('Expected the replacement child.');
    closeMockChild(second, 0);
    await expect(running).resolves.toBe(0);
  });

  it('reconciles atomic replacements and deleted source by content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fluo-cli-atomic-restart-'));
    createdDirectories.push(directory);
    const source = join(directory, 'src');
    mkdirSync(source);
    const file = join(source, 'service.ts');
    writeFileSync(file, 'export const value = 1;\n');
    const gate = createContentChangeGate(directory);
    gate.commitBaseline([source]);
    expect(gate.hasMeaningfulChange([source])).toBe(false);

    const replacement = join(source, 'replacement.ts');
    writeFileSync(replacement, 'export const value = 2;\n');
    renameSync(replacement, file);
    expect(gate.hasMeaningfulChange([source])).toBe(true);
    gate.commitBaseline([source]);
    expect(gate.hasMeaningfulChange([source])).toBe(false);

    rmSync(file);
    expect(gate.hasMeaningfulChange([source])).toBe(true);
    gate.commitBaseline([source]);
    expect(gate.hasMeaningfulChange([source])).toBe(false);
  });

  it('reloads after readiness when both Vite client and bootstrap graph own a file', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-shared-graph-'));
    createdDirectories.push(projectDirectory);
    const source = join(projectDirectory, 'src');
    mkdirSync(source);
    const shared = join(source, 'react-app.tsx');
    writeFileSync(shared, 'export const value = 1;\n');
    const scheduler = createManualRestartScheduler();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const messages: unknown[] = [];
    const child = createMockChild(signals);
    child.send = (message) => { messages.push(message); return true; };
    const signalTarget = new EventEmitter();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => child,
      watchTarget: (target, optionsOrListener, listener) => {
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return new TestWatcher();
      },
    });
    child.emit('message', { type: 'fluo:react-vite-hmr-file', file: shared });
    child.emit('message', { type: 'fluo:react-vite-host-ready' });
    child.emit('message', { type: 'fluo:react-vite-server-files', files: [shared] });

    writeFileSync(shared, 'export const value = 2;\n');
    listeners.get(source)?.('change', 'react-app.tsx');
    scheduler.flush();
    expect(messages).toEqual([{ type: 'fluo:react-vite-server-restart', files: [shared], reload: true }]);
    expect(signals).toEqual([]);
    signalTarget.emit('SIGTERM');
    closeMockChild(child, 0);
    await expect(running).resolves.toBe(0);
  });

  it('selects a full restart for a mixed client-only and server edit', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-mixed-edit-'));
    createdDirectories.push(projectDirectory);
    const source = join(projectDirectory, 'src');
    mkdirSync(source);
    const page = join(source, 'page.tsx');
    const server = join(source, 'main.ts');
    writeFileSync(page, 'export const Page = () => null;\n');
    writeFileSync(server, 'export const value = 1;\n');
    const scheduler = createManualRestartScheduler();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const messages: unknown[] = [];
    const children: ChildProcess[] = [];
    const signalTarget = new EventEmitter();
    let onChange: ((event: string, filename: string | Buffer | null) => void) | undefined;
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => {
        const child = createMockChild(signals);
        child.send = (message) => { messages.push(message); return true; };
        children.push(child);
        return child;
      },
      watchTarget: (target, optionsOrListener, listener) => {
        if (target === source) onChange = typeof optionsOrListener === 'function' ? optionsOrListener : listener;
        return new TestWatcher();
      },
    });
    const first = children[0];
    if (!first) throw new Error('Expected the first child.');
    first.emit('message', { type: 'fluo:react-vite-host-ready' });
    first.emit('message', { type: 'fluo:react-vite-hmr-file', file: page });
    first.emit('message', { type: 'fluo:react-vite-server-files', files: [server] });
    writeFileSync(page, 'export const Page = () => <main />;\n');
    writeFileSync(server, 'export const value = 2;\n');
    onChange?.('change', 'page.tsx');
    onChange?.('change', 'main.ts');
    scheduler.flush();
    expect(messages).toEqual([]);
    expect(signals).toEqual(['SIGTERM']);
    closeMockChild(first, 0);
    expect(children).toHaveLength(2);
    signalTarget.emit('SIGTERM');
    const second = children[1];
    if (!second) throw new Error('Expected the replacement child.');
    closeMockChild(second, 0);
    await expect(running).resolves.toBe(0);
  });

  it('keeps the browser-owned child alive for a server-only edit', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-react-server-only-'));
    createdDirectories.push(projectDirectory);
    const sourceDirectory = join(projectDirectory, 'src');
    mkdirSync(sourceDirectory);
    const server = join(sourceDirectory, 'main.ts');
    writeFileSync(server, 'export const version = 1;\n');
    const scheduler = createManualRestartScheduler();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const messages: unknown[] = [];
    const child = createMockChild(signals);
    child.send = (message) => { messages.push(message); return true; };
    const signalTarget = new EventEmitter();
    const listeners = new Map<string, (event: string, filename: string | Buffer | null) => void>();
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      restartScheduler: scheduler,
      signalTarget,
      spawnChild: () => child,
      watchTarget: (target, optionsOrListener, listener) => {
        listeners.set(target, typeof optionsOrListener === 'function' ? optionsOrListener : listener ?? (() => undefined));
        return new TestWatcher();
      },
    });

    child.emit('message', { type: 'fluo:react-vite-host-ready' });
    writeFileSync(server, 'export const version = 2;\n');
    listeners.get(sourceDirectory)?.('change', 'main.ts');
    scheduler.flush();
    expect(signals).toEqual([]);
    expect(messages).toEqual([{ type: 'fluo:react-vite-server-restart', files: [server], reload: false }]);

    signalTarget.emit('SIGTERM');
    closeMockChild(child, 0);
    await expect(running).resolves.toBe(0);
  });

  it('starts the transformed entry with .env and releases watchers after shutdown', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-react-restart-'));
    createdDirectories.push(projectDirectory);
    mkdirSync(join(projectDirectory, 'src'));
    writeFileSync(join(projectDirectory, 'src', 'main.ts'), '');
    const signalTarget = new EventEmitter();
    const watchers: TestWatcher[] = [];
    const signals: Array<NodeJS.Signals | undefined> = [];
    const child = createMockChild(signals);
    let childArgs: readonly string[] = [];
    const running = runNodeRestartRunner({
      env: {},
      projectDirectory,
      reactVite: true,
      signalTarget,
      spawnChild: (_command, args) => {
        childArgs = args;
        return child;
      },
      watchTarget: () => {
        const watcher = new TestWatcher();
        watchers.push(watcher);
        return watcher;
      },
    });

    expect(childArgs).toContain('--env-file=.env');
    expect(childArgs).toContain('__react-vite-app');
    signalTarget.emit('SIGINT');
    closeMockChild(child, 0);

    await expect(running).resolves.toBe(0);
    expect(signals).toEqual(['SIGTERM']);
    expect(watchers.length).toBeGreaterThan(0);
    expect(watchers.every((watcher) => watcher.closed)).toBe(true);
  });
});

describe('terminal process-group shutdown', () => {
  it.skipIf(process.platform === 'win32')('stops the app and watcher with a clean exit after foreground Ctrl+C', async () => {
    const projectDirectory = mkdtempSync(join(tmpdir(), 'fluo-cli-terminal-signal-'));
    createdDirectories.push(projectDirectory);
    mkdirSync(join(projectDirectory, 'src'));
    mkdirSync(join(projectDirectory, 'node_modules', 'vite'), { recursive: true });
    symlinkSync(join(import.meta.dirname, '..', '..', 'node_modules', 'tsx'), join(projectDirectory, 'node_modules', 'tsx'), 'dir');
    writeFileSync(join(projectDirectory, 'package.json'), JSON.stringify({
      name: 'signal-fixture', dependencies: { '@fluojs/react': '0.1.0' }, scripts: { dev: 'fluo dev' },
    }));
    writeFileSync(join(projectDirectory, 'vite.client.config.ts'), '');
    writeFileSync(join(projectDirectory, 'vite.server.config.ts'), '');
    writeFileSync(join(projectDirectory, 'node_modules', 'vite', 'package.json'), JSON.stringify({
      name: 'vite', type: 'module', exports: './index.mjs',
    }));
    writeFileSync(join(projectDirectory, 'node_modules', 'vite', 'index.mjs'), `
      import { EventEmitter } from 'node:events';
      import { createServer as createHttpServer } from 'node:http';
      export async function createServer() {
        return {
          async transformRequest() { return null; },
          async waitForRequestsIdle() {},
          moduleGraph: { async getModuleByUrl() { return null; } },
          ws: { send() {} },
          watcher: new EventEmitter(),
          async ssrLoadModule() {
            return {
              async startReactViteApp() {
                const server = createHttpServer((_request, response) => response.end('ready'));
                await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
                const address = server.address();
                console.log('APP_READY:' + address.port + ':' + process.pid);
                return {
                  url: 'http://127.0.0.1:' + address.port,
                  close() {
                    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
                  },
                };
              },
            };
          },
          async close() {},
        };
      }
    `);
    writeFileSync(join(projectDirectory, '.env'), '');
    writeFileSync(join(projectDirectory, 'src', 'main.ts'), '');
    const runner = spawn(process.execPath, [
      join(import.meta.dirname, '..', '..', 'bin', 'fluo.mjs'), 'dev', '--reporter', 'pretty',
    ], {
      cwd: projectDirectory,
      detached: true,
      env: { ...process.env, CI: '1', FLUO_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    let closed = false;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<{ appPid: number; port: number }>((resolve, reject) => {
      readyTimeout = setTimeout(() => reject(new Error(`App did not start: ${output}\n${errors}`)), 15_000);
      runner.stdout.on('data', (chunk) => {
        output += String(chunk);
        const match = /APP_READY:(\d+):(\d+)/u.exec(output);
        if (match && output.includes('React dev app ready')) {
          resolve({ port: Number(match[1]), appPid: Number(match[2]) });
        }
      });
      runner.stderr.on('data', (chunk) => { errors += String(chunk); });
      runner.once('error', reject);
      runner.once('close', (code, signal) => reject(new Error(`Runner closed before ready: ${code ?? signal}\n${output}\n${errors}`)));
    });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      runner.once('close', (code, signal) => {
        closed = true;
        resolve({ code, signal });
      });
    });

    try {
      const { appPid, port } = await ready;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe('ready');
      if (!runner.pid) {
        throw new Error('Expected a process-group leader');
      }
      process.kill(-runner.pid, 'SIGINT');
      const stopped = await Promise.race([
        exit,
        new Promise<never>((_resolve, reject) => {
          closeTimeout = setTimeout(() => reject(new Error(`Runner did not stop: ${output}\n${errors}`)), 10_000);
        }),
      ]);

      expect(stopped, `${output}\n${errors}`).toEqual({ code: 0, signal: null });
      expect(errors).not.toContain('lifecycle failed');
      expect(output).toContain('dev lifecycle completed');
      expect(() => process.kill(appPid, 0)).toThrow();
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    } finally {
      if (readyTimeout) clearTimeout(readyTimeout);
      if (closeTimeout) clearTimeout(closeTimeout);
      if (!closed && runner.pid) process.kill(-runner.pid, 'SIGKILL');
    }
  }, 30_000);
});
