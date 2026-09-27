import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
      import { createServer as createHttpServer } from 'node:http';
      export async function createServer() {
        return {
          async ssrLoadModule() {
            return {
              async startReactViteApp() {
                const server = createHttpServer((_request, response) => response.end('ready'));
                await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
                const address = server.address();
                console.log('APP_READY:' + address.port + ':' + process.pid);
                return {
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
