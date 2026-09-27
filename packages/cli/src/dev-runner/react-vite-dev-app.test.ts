import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { runReactViteDevApp } from './react-vite-dev-app.js';

const directories: string[] = [];

type FixtureState = {
  appCloseCalls: number;
  appEntered: { promise: Promise<void>; resolve(): void };
  appGate: { promise: Promise<void>; resolve(): void };
  appStartCalls: number;
  closeEntered: { promise: Promise<void>; resolve(): void };
  closeGate: { promise: Promise<void>; resolve(): void };
  configLoader?: string;
  createEntered: { promise: Promise<void>; resolve(): void };
  createGate: { promise: Promise<void>; resolve(): void };
  failAppClose: boolean;
  failLoad: boolean;
  failViteClose: boolean;
  viteCloseCalls: number;
};

async function createFixture(): Promise<{ directory: string; state: FixtureState }> {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-react-dev-lifecycle-'));
  directories.push(directory);
  const viteDirectory = join(directory, 'node_modules', 'vite');
  mkdirSync(viteDirectory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(join(viteDirectory, 'package.json'), '{"name":"vite","type":"module","exports":"./index.mjs"}');
  const modulePath = join(viteDirectory, 'index.mjs');
  writeFileSync(modulePath, `
    export const state = {
      appCloseCalls: 0,
      appEntered: Promise.withResolvers(),
      appGate: Promise.withResolvers(),
      appStartCalls: 0,
      closeEntered: Promise.withResolvers(),
      closeGate: { promise: Promise.resolve(), resolve() {} },
      configLoader: undefined,
      createEntered: Promise.withResolvers(),
      createGate: Promise.withResolvers(),
      failAppClose: false,
      failLoad: false,
      failViteClose: false,
      viteCloseCalls: 0,
    };
    export async function createServer(options) {
      state.configLoader = options.configLoader;
      state.createEntered.resolve();
      await state.createGate.promise;
      return {
        async ssrLoadModule() {
          if (state.failLoad) throw new Error('SSR loading failed');
          return {
            async startReactViteApp() {
              state.appStartCalls += 1;
              state.appEntered.resolve();
              await state.appGate.promise;
              return {
                async close() {
                  state.appCloseCalls += 1;
                  state.closeEntered.resolve();
                  await state.closeGate.promise;
                  if (state.failAppClose) throw new Error('application close failed');
                },
              };
            },
          };
        },
        async close() {
          state.viteCloseCalls += 1;
          if (state.failViteClose) throw new Error('Vite close failed');
        },
      };
    }
  `);
  const fixture: { state: FixtureState } = await import(pathToFileURL(modulePath).href);
  return { directory, state: fixture.state };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

it('closes Vite without starting the app when shutdown arrives during Vite creation', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const output = new PassThrough();
  const running = runReactViteDevApp(directory, { signalTarget: signals, stdout: output });

  await state.createEntered.promise;
  signals.emit('SIGTERM');
  state.createGate.resolve();

  await expect(running).resolves.toBe(0);
  expect(state.appStartCalls).toBe(0);
  expect(state.configLoader).toBe('runner');
  expect(state.viteCloseCalls).toBe(1);
  expect(output.read()).toBeNull();
  expect(signals.listenerCount('SIGTERM')).toBe(0);
}, 10_000);

it('closes both resources when shutdown arrives during application startup', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const output = new PassThrough();
  const running = runReactViteDevApp(directory, { signalTarget: signals, stdout: output });

  state.createGate.resolve();
  await state.appEntered.promise;
  signals.emit('SIGTERM');
  state.appGate.resolve();

  await expect(running).resolves.toBe(0);
  expect(state.appCloseCalls).toBe(1);
  expect(state.viteCloseCalls).toBe(1);
  expect(output.read()).toBeNull();
}, 10_000);

it('retains terminal signal protection until application and Vite teardown settles', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const ready = new Promise<void>((resolve) => {
    stdout.once('data', () => resolve());
  });
  let releaseClose: () => void = () => undefined;
  const closePromise = new Promise<void>((resolve) => { releaseClose = resolve; });
  state.closeGate = { promise: closePromise, resolve: () => releaseClose() };
  const running = runReactViteDevApp(directory, { signalTarget: signals, stdout });

  state.createGate.resolve();
  state.appGate.resolve();
  await ready;
  signals.emit('SIGINT');
  await state.closeEntered.promise;

  try {
    expect(signals.listenerCount('SIGINT')).toBeGreaterThan(0);
    expect(signals.listenerCount('SIGTERM')).toBeGreaterThan(0);
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
  } finally {
    state.closeGate.resolve();
  }

  await expect(running).resolves.toBe(0);
  expect(state.appCloseCalls).toBe(1);
  expect(state.viteCloseCalls).toBe(1);
  expect(signals.listenerCount('SIGINT')).toBe(0);
  expect(signals.listenerCount('SIGTERM')).toBe(0);
}, 10_000);

it('settles with failure after attempting both shutdown steps when each close rejects', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  state.failAppClose = true;
  state.failViteClose = true;
  const ready = new Promise<void>((resolve) => {
    stdout.once('data', (chunk) => {
      expect(String(chunk)).toContain('React dev app ready');
      resolve();
    });
  });
  const running = runReactViteDevApp(directory, { signalTarget: signals, stderr, stdout });

  state.createGate.resolve();
  state.appGate.resolve();
  await ready;
  signals.emit('SIGINT');

  await expect(running).resolves.toBe(1);
  expect(state.appCloseCalls).toBe(1);
  expect(state.viteCloseCalls).toBe(1);
  const errors = String(stderr.read());
  expect(errors).toContain('application close failed');
  expect(errors).toContain('Vite close failed');
  expect(signals.listenerCount('SIGINT')).toBe(0);
}, 10_000);

it('closes the created Vite server when SSR loading fails', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stderr = new PassThrough();
  state.failLoad = true;
  const running = runReactViteDevApp(directory, { signalTarget: signals, stderr });
  state.createGate.resolve();

  await expect(running).resolves.toBe(1);
  expect(state.appStartCalls).toBe(0);
  expect(state.viteCloseCalls).toBe(1);
  expect(String(stderr.read())).toContain('SSR loading failed');
  expect(signals.listenerCount('SIGTERM')).toBe(0);
}, 10_000);
