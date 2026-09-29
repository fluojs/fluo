import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
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
  appUpgradeServer?: FixtureState['websocketServer'];
  closeEntered: { promise: Promise<void>; resolve(): void };
  closeGate: { promise: Promise<void>; resolve(): void };
  configLoader?: string;
  hmr?: boolean;
  websocketServer?: Server;
  watcher?: EventEmitter;
  watchIgnored?: string[];
  createEntered: { promise: Promise<void>; resolve(): void };
  createGate: { promise: Promise<void>; resolve(): void };
  failAppClose: boolean;
  failLoad: boolean;
  failViteClose: boolean;
  graphEntered: { promise: Promise<void>; resolve(): void };
  graphGate: { promise: Promise<void>; resolve(): void };
  providerCloseCalls: number;
  realHttp: boolean;
  requestAborted: { promise: Promise<void>; resolve(): void };
  requestEntered: { promise: Promise<void>; resolve(): void };
  requestGate: { promise: Promise<void>; resolve(): void };
  requestSignal?: AbortSignal;
  scopeClosed: { promise: Promise<void>; resolve(): void };
  scopeCloseCalls: number;
  sent: Array<{ type: string; event?: string; data?: { status: string; generation: number } }>;
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
    import { EventEmitter } from 'node:events';
    import { createServer as createHttpServer } from 'node:http';
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
      graphEntered: Promise.withResolvers(),
      graphGate: { promise: Promise.resolve(), resolve() {} },
      providerCloseCalls: 0,
      realHttp: false,
      requestAborted: Promise.withResolvers(),
      requestEntered: Promise.withResolvers(),
      requestGate: Promise.withResolvers(),
      scopeClosed: Promise.withResolvers(),
      scopeCloseCalls: 0,
      sent: [],
      viteCloseCalls: 0,
      watcher: new EventEmitter(),
    };
    export async function createServer(options) {
      state.configLoader = options.configLoader;
      state.hmr = options.server.hmr;
      state.watchIgnored = options.server.watch?.ignored;
      state.websocketServer = options.server.ws?.server;
      state.websocketServer?.on('upgrade', () => undefined);
      state.createEntered.resolve();
      await state.createGate.promise;
      return {
        async transformRequest() { return null; },
        async waitForRequestsIdle() {},
        moduleGraph: {
          async getModuleByUrl() {
            state.graphEntered.resolve();
            await state.graphGate.promise;
            return null;
          },
          getModulesByFile() { return undefined; },
          invalidateModule() {},
        },
        ws: { send(message) { state.sent.push(message); } },
        watcher: state.watcher,
        async ssrLoadModule() {
          if (state.failLoad) throw new Error('SSR loading failed');
          return {
            async startReactViteApp(_vite, upgradeServer) {
              state.appStartCalls += 1;
              state.appUpgradeServer = upgradeServer;
              state.appEntered.resolve();
              await state.appGate.promise;
              const server = state.realHttp ? createHttpServer(async (_request, response) => {
                if (state.appStartCalls === 1) {
                  const requestSignal = new AbortController();
                  state.requestSignal = requestSignal.signal;
                  response.once('close', () => {
                    if (!response.writableEnded) requestSignal.abort();
                  });
                  requestSignal.signal.addEventListener('abort', () => {
                    state.requestAborted.resolve();
                    state.requestGate.resolve();
                  }, { once: true });
                  state.requestEntered.resolve();
                  try {
                    await state.requestGate.promise;
                  } finally {
                    state.scopeCloseCalls += 1;
                    state.scopeClosed.resolve();
                  }
                }
                if (!response.destroyed) response.end('generation:' + state.appStartCalls);
              }) : undefined;
              if (server) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
              return {
                url: server ? 'http://127.0.0.1:' + server.address().port : 'http://127.0.0.1:1',
                async close() {
                  state.appCloseCalls += 1;
                  state.closeEntered.resolve();
                  if (server) {
                    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
                    state.providerCloseCalls += 1;
                  }
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

it('binds the Vite HMR channel to an application-owned upgrade source', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const messageListeners = process.listenerCount('message');
  const ready = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout });
  state.createGate.resolve();
  state.appGate.resolve();

  await ready;
  expect(state.hmr).not.toBe(false);
  expect(state.watchIgnored).toContain(join(directory, 'vite.server.config.ts'));
  expect(state.websocketServer?.listenerCount('upgrade')).toBeGreaterThan(0);
  expect(state.appUpgradeServer).toBe(state.websocketServer);
  const changes: string[] = [];
  state.watcher?.on('change', (file: string) => changes.push(file));
  const reconcile = process.listeners('message')[messageListeners];
  if (!reconcile) throw new Error('Expected the React development reconciliation listener.');
  reconcile({ type: 'fluo:react-vite-hmr-reconcile', file: join(directory, 'src', 'page.tsx') }, undefined);
  expect(changes).toEqual([join(directory, 'src', 'page.tsx')]);
  signals.emit('SIGTERM');
  await expect(running).resolves.toBe(0);
  expect(process.listenerCount('message')).toBe(messageListeners);
}, 10_000);

it('closes Vite without starting the app when shutdown arrives during Vite creation', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const output = new PassThrough();
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout: output });

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
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout: output });

  state.createGate.resolve();
  await state.appEntered.promise;
  expect(state.websocketServer?.listening).toBe(false);
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
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout });

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
  const errors: string[] = [];
  const stderr = {
    write(chunk: string | Uint8Array) {
      errors.push(String(chunk));
      return true;
    },
  };
  state.failAppClose = true;
  state.failViteClose = true;
  const ready = new Promise<void>((resolve) => {
    stdout.once('data', (chunk) => {
      expect(String(chunk)).toContain('React dev app ready');
      resolve();
    });
  });
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stderr, stdout });

  state.createGate.resolve();
  state.appGate.resolve();
  await ready;
  signals.emit('SIGINT');

  await expect(running).resolves.toBe(1);
  expect(state.appCloseCalls).toBe(1);
  expect(state.viteCloseCalls).toBe(1);
  expect(errors.join('')).toContain('application close failed');
  expect(errors.join('')).toContain('Vite close failed');
  expect(signals.listenerCount('SIGINT')).toBe(0);
}, 10_000);

it('retains Vite supervision after SSR loading fails until terminal shutdown', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stderr = new PassThrough();
  state.failLoad = true;
  const failed = new Promise<string>((resolve) => {
    stderr.once('data', (chunk) => resolve(String(chunk)));
  });
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stderr });
  state.createGate.resolve();

  const failure = await failed;
  expect(state.viteCloseCalls).toBe(0);
  signals.emit('SIGTERM');
  await expect(running).resolves.toBe(0);
  expect(state.appStartCalls).toBe(0);
  expect(state.viteCloseCalls).toBe(1);
  expect(failure).toContain('SSR loading failed');
  expect(signals.listenerCount('SIGTERM')).toBe(0);
}, 10_000);

it('serializes edits during drain without publishing stale readiness', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const initialReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const messageListeners = process.listenerCount('message');
  const epochs: string[] = [];
  const running = runReactViteDevApp(directory, {
    onEpochChange: (epoch: string) => { epochs.push(epoch); },
    port: 0,
    signalTarget: signals,
    stdout,
  });
  state.createGate.resolve();
  state.appGate.resolve();
  await initialReady;

  let entered: () => void = () => undefined;
  let releaseClose: () => void = () => undefined;
  state.closeEntered = { promise: new Promise<void>((resolve) => { entered = resolve; }), resolve: () => entered() };
  state.closeGate = { promise: new Promise<void>((resolve) => { releaseClose = resolve; }), resolve: () => releaseClose() };
  const restart = process.listeners('message')[messageListeners];
  if (!restart) throw new Error('Expected the development restart listener.');
  const ready = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false, epoch: 'first' }, undefined);
  expect(state.sent.at(-1)?.data?.status).toBe('restarting');
  await state.closeEntered.promise;
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'app.ts')], reload: false, epoch: 'second' }, undefined);
  state.closeGate.resolve();
  await ready;

  expect(state.appCloseCalls).toBe(1);
  expect(state.appStartCalls).toBe(2);
  expect(state.viteCloseCalls).toBe(0);
  expect(state.sent.filter((event) => event.data?.status === 'ready').map((event) => event.data?.generation)).toEqual([0, 2]);
  signals.emit('SIGTERM');
  await expect(running).resolves.toBe(0);
  expect(state.appCloseCalls).toBe(2);
  expect(state.viteCloseCalls).toBe(1);
  expect(process.listenerCount('message')).toBe(messageListeners);
  expect(epochs).toEqual(['first', 'second']);
}, 10_000);

it('retries a failed server bootstrap after the next corrective edit', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const initialReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const messageListeners = process.listenerCount('message');
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout, stderr });
  state.createGate.resolve();
  state.appGate.resolve();
  await initialReady;
  const restart = process.listeners('message')[messageListeners];
  if (!restart) throw new Error('Expected the development restart listener.');

  state.failLoad = true;
  const failed = new Promise<string>((resolve) => { stderr.once('data', (chunk) => resolve(String(chunk))); });
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false }, undefined);
  expect(state.sent.at(-1)?.data?.status).toBe('restarting');
  expect(await failed).toContain('not ready');
  expect(state.viteCloseCalls).toBe(0);
  state.failLoad = false;
  const recovered = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false }, undefined);
  await recovered;
  expect(state.sent.filter((event) => event.data?.status === 'ready').map((event) => event.data?.generation)).toEqual([0, 2]);
  signals.emit('SIGTERM');
  await expect(running).resolves.toBe(0);
}, 10_000);

it('drains an admitted HTTP request and closes its provider before exposing new handlers', async () => {
  const { directory, state } = await createFixture();
  state.realHttp = true;
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const initialReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const messageListeners = process.listenerCount('message');
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout });
  state.createGate.resolve();
  state.appGate.resolve();
  await initialReady;
  const address = state.websocketServer?.address();
  if (!address || typeof address === 'string') throw new Error('Expected the public development listener.');
  const url = `http://127.0.0.1:${address.port}/`;
  const admitted = fetch(url);
  await state.requestEntered.promise;

  const restart = process.listeners('message')[messageListeners];
  if (!restart) throw new Error('Expected the development restart listener.');
  const closeEntered = state.closeEntered.promise;
  const nextReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false }, undefined);
  await closeEntered;
  expect((await fetch(url)).status).toBe(503);
  expect(state.providerCloseCalls).toBe(0);
  state.requestGate.resolve();
  expect(await (await admitted).text()).toBe('generation:1');
  await nextReady;
  expect(state.providerCloseCalls).toBe(1);
  expect(await (await fetch(url)).text()).toBe('generation:2');

  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  state.closeEntered = { promise: new Promise<void>((resolve) => { entered = resolve; }), resolve: () => entered() };
  state.closeGate = { promise: new Promise<void>((resolve) => { release = resolve; }), resolve: () => release() };
  signals.emit('SIGTERM');
  await state.closeEntered.promise;
  expect((await fetch(url)).status).toBe(503);
  state.closeGate.resolve();
  await expect(running).resolves.toBe(0);
  expect(state.providerCloseCalls).toBe(2);
}, 10_000);

it('aborts an admitted upstream request and releases its scope when the downstream disconnects', async () => {
  const { directory, state } = await createFixture();
  state.realHttp = true;
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const initialReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const messageListeners = process.listenerCount('message');
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout });
  state.createGate.resolve();
  state.appGate.resolve();
  await initialReady;
  const address = state.websocketServer?.address();
  if (!address || typeof address === 'string') throw new Error('Expected the public development listener.');
  const url = `http://127.0.0.1:${address.port}/`;
  const controller = new AbortController();
  const admitted = fetch(url, { signal: controller.signal });
  try {
    await state.requestEntered.promise;
    const restart = process.listeners('message')[messageListeners];
    if (!restart) throw new Error('Expected the development restart listener.');
    const nextReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
    restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false }, undefined);
    await state.closeEntered.promise;
    expect((await fetch(url)).status).toBe(503);
    expect(state.providerCloseCalls).toBe(0);
    controller.abort();
    await expect(admitted).rejects.toThrow();
    await expect(Promise.race([
      state.requestAborted.promise.then(() => true),
      new Promise<boolean>((_, reject) => {
        AbortSignal.timeout(1_000).addEventListener('abort', () => reject(new Error('Upstream request was not aborted.')), { once: true });
      }),
    ])).resolves.toBe(true);
    expect(state.requestSignal?.aborted).toBe(true);
    await expect(Promise.race([
      state.scopeClosed.promise.then(() => true),
      new Promise<boolean>((_, reject) => {
        AbortSignal.timeout(1_000).addEventListener('abort', () => reject(new Error('Request scope was not closed.')), { once: true });
      }),
    ])).resolves.toBe(true);
    expect(state.scopeCloseCalls).toBe(1);
    await nextReady;
    expect(state.providerCloseCalls).toBe(1);
    expect(await (await fetch(url)).text()).toBe('generation:2');
  } finally {
    state.requestGate.resolve();
    signals.emit('SIGTERM');
    await running;
  }
}, 10_000);

it('does not publish readiness from a superseded bootstrap generation', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const initialReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const messageListeners = process.listenerCount('message');
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout });
  state.createGate.resolve();
  state.appGate.resolve();
  await initialReady;
  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  state.appEntered = { promise: new Promise<void>((resolve) => { entered = resolve; }), resolve: () => entered() };
  state.appGate = { promise: new Promise<void>((resolve) => { release = resolve; }), resolve: () => release() };
  const restart = process.listeners('message')[messageListeners];
  if (!restart) throw new Error('Expected the development restart listener.');
  const ready = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false }, undefined);
  await state.appEntered.promise;
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'app.ts')], reload: false }, undefined);
  state.appGate.resolve();
  await ready;

  expect(state.sent.filter((event) => event.data?.status === 'ready').map((event) => event.data?.generation)).toEqual([0, 2]);
  expect(state.appStartCalls).toBe(3);
  expect(state.appCloseCalls).toBe(2);
  signals.emit('SIGTERM');
  await expect(running).resolves.toBe(0);
}, 10_000);

it('rejects stale readiness while the SSR graph ownership lookup is pending', async () => {
  const { directory, state } = await createFixture();
  const signals = new EventEmitter();
  const stdout = new PassThrough();
  const initialReady = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  const messageListeners = process.listenerCount('message');
  const running = runReactViteDevApp(directory, { port: 0, signalTarget: signals, stdout });
  state.createGate.resolve();
  state.appGate.resolve();
  await initialReady;

  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  state.graphEntered = { promise: new Promise<void>((resolve) => { entered = resolve; }), resolve: () => entered() };
  state.graphGate = { promise: new Promise<void>((resolve) => { release = resolve; }), resolve: () => release() };
  const restart = process.listeners('message')[messageListeners];
  if (!restart) throw new Error('Expected the development restart listener.');
  const ready = new Promise<void>((resolve) => { stdout.once('data', () => resolve()); });
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'main.ts')], reload: false }, undefined);
  await state.graphEntered.promise;
  restart({ type: 'fluo:react-vite-server-restart', files: [join(directory, 'src', 'app.ts')], reload: false }, undefined);
  state.graphGate.resolve();
  await ready;
  expect(state.sent.filter((event) => event.data?.status === 'ready').map((event) => event.data?.generation)).toEqual([0, 2]);
  signals.emit('SIGTERM');
  await expect(running).resolves.toBe(0);
}, 10_000);
