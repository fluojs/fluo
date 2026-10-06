import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { cacheSettings, createBrowserDriver, editSourceFile, initialClientWork, initialRequestCount, summarizeAssets, summarizeErrorRate, summarizeInteractions, summarizeRscBytes, waitForCapturedRequests, waitForEditMarker, waitForFailureText } from '../src/measure-browser.mjs';
import { installInitialReadiness, waitForInitialReadiness } from '../src/initial-readiness.mjs';
import { collectDevMeasurements, summarizeEnvironmentHeadroom, verifyTraceFiles } from '../src/measure.mjs';

const appRequire = createRequire(new URL('../apps/fluo/package.json', import.meta.url));
const { build } = await import(appRequire.resolve('vite'));
const fixtureBuild = await build({
  configFile: false, logLevel: 'silent',
  plugins: [{
    name: 'real-react-readiness-fixture',
    resolveId(id) {
      if (id.endsWith('virtual:readiness-test')) return '\0readiness-test';
      if (id === 'react' || id === 'react-dom/client') return appRequire.resolve(id);
    },
    load(id) {
      if (id !== '\0readiness-test') return;
      return `
        import { createElement, Suspense, lazy, useEffect, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        const Never = lazy(() => new Promise(() => {}));
        const Gated = lazy(() => new Promise((accept) => {
          window.__releaseInitial = () => accept({ default: Ready });
        }));
        function Ready() {
          const [ready, setReady] = useState(false);
          useEffect(() => { setReady(true); window.__fixturePassive?.(); }, []);
          return createElement('span', { 'data-initial-effect': String(ready) }, 'Ready');
        }
        const node = document.createElement('div');
        document.body.append(node);
        createRoot(node).render(window.__holdWarm || ['/suspended', '/gated'].includes(location.pathname)
          ? createElement(Suspense, { fallback: createElement(Ready) },
            createElement(location.pathname === '/gated' ? Gated : Never))
          : createElement(Ready));
      `;
    },
  }],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { write: false, lib: { entry: 'virtual:readiness-test', name: 'ReadinessFixture', formats: ['iife'] } },
});
const fixtureScript = (Array.isArray(fixtureBuild) ? fixtureBuild[0] : fixtureBuild)
  .output.find((entry) => entry.type === 'chunk').code;
const fixtureHtml = (body) => `${body}<script src="/real-react.js"></script>`;
function fixtureResponse(request, response) {
  if (request.url !== '/real-react.js') return false;
  response.writeHead(200, { 'content-type': 'text/javascript' });
  response.end(fixtureScript);
  return true;
}

test('correctness check: failed HTTP status -> retains navigation progress before context cleanup', { timeout: 15_000 }, async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'text/html' });
    response.end('<!doctype html><h1>Unavailable</h1>');
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const url = `http://127.0.0.1:${server.address().port}/`;
  const driver = await createBrowserDriver({
    journeys: Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
      .map((name) => [name, { path: '/', status: 200 }])),
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    const result = await driver.check({ framework: 'tanstack-start', runId: 'http-failure',
      device: 'desktop', mode: 'native', url });

    assert.equal(result.pass, false);
    const diagnostics = result.steps[0].diagnostics;
    const request = diagnostics.events.find((entry) => entry.name === 'Network.requestWillBeSent');
    const response = diagnostics.events.find((entry) => entry.name === 'Network.responseReceived');
    assert.equal(request.url, url);
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.status, 503);
    assert.ok(diagnostics.events.some((entry) => entry.name === 'page.domcontentloaded'));
    assert.ok(diagnostics.events.every((entry) => entry.observedAtMs >= diagnostics.startedAtMs
      && entry.observedAtMs <= diagnostics.failedAtMs));
    assert.equal(diagnostics.events.some((entry) => entry.name === 'page.close'), false);
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('correctness check: transport abort -> retains loading failure without invented response', { timeout: 15_000 }, async () => {
  const server = createServer((request) => request.socket.destroy());
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const url = `http://127.0.0.1:${server.address().port}/`;
  const driver = await createBrowserDriver({
    journeys: Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
      .map((name) => [name, { path: '/', status: 200 }])),
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    const result = await driver.check({ framework: 'tanstack-start', runId: 'transport-failure',
      device: 'desktop', mode: 'native', url });

    assert.equal(result.pass, false);
    const events = result.steps[0].diagnostics.events;
    const failed = events.find((entry) => entry.name === 'Network.loadingFailed');
    assert.ok(events.some((entry) => entry.name === 'Network.requestWillBeSent'
      && entry.requestId === failed.requestId));
    assert.equal(typeof failed.errorText, 'string');
    assert.equal(events.some((entry) => entry.name === 'Network.responseReceived'), false);
    assert.equal(events.some((entry) => entry.name === 'page.close'), false);
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('collector cannot sample cold metrics or start warm with unresolved real React Suspense', { timeout: 25_000 }, async () => {
  let documents = 0;
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    documents++;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml('<!doctype html><h1>SSR shell, not complete React</h1>'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const journeys = Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
    .map((name) => [name, { path: '/suspended' }]));
  const driver = await createBrowserDriver({
    journeys, provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    await assert.rejects(driver.measure({
      framework: 'fluo', runId: 'unresolved-suspense', device: 'desktop', mode: 'native',
      url: `http://127.0.0.1:${server.address().port}/`,
    }), /initial React completion/u);
    assert.equal(documents, 1, 'a visible SSR shell must not trigger warm navigation');
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('collector cannot leave an unresolved warm React document for the next workload', { timeout: 25_000 }, async () => {
  let documents = 0;
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    documents++;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml(`<!doctype html><h1>Warm fixture</h1><script>window.__holdWarm=${documents === 2}</script>`));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  let driver;
  try {
    driver = await createBrowserDriver({
      journeys: Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
        .map((name) => [name, { path: '/ready' }])),
      provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
    });
    await assert.rejects(driver.measure({
      framework: 'fluo', runId: 'unresolved-warm', device: 'desktop', mode: 'native',
      url: `http://127.0.0.1:${server.address().port}/`,
    }), /initial React completion/u);
    assert.equal(documents, 2);
  } finally {
    await driver?.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('first real root commit and fallback passive effect cannot complete pending Suspense', { timeout: 15_000 }, async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml('<!doctype html><h1>SSR shell</h1>'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  try {
    const page = await browser.newPage();
    let acceptPassive;
    const passive = new Promise((accept) => { acceptPassive = accept; });
    await page.exposeBinding('__fixturePassive', () => acceptPassive());
    await installInitialReadiness(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/gated`);
    await passive;
    assert.equal(await page.evaluate(() => window.__benchmarkInitialReadiness.completedAt), null);
    await page.evaluate(() => window.__releaseInitial());
    const readiness = await waitForInitialReadiness(page);
    assert.equal(readiness.events.at(-1).suspensePending, 0);
    assert.equal(readiness.events.at(-1).passivePending, false);
    assert.equal(await page.locator('[data-initial-effect]').getAttribute('data-initial-effect'), 'true');
    assert.ok(readiness.events.some((entry) => entry.suspensePending > 0));
  } finally {
    await browser.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('waits for a late development stylesheet before accepting its computed marker', { timeout: 10_000 }, async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><head></head><body>Ready</body></html>');
    const visible = waitForEditMarker(page, {
      selector: 'html', expectedStyle: { property: '--benchmark-edit', value: 'changed' },
    });
    await page.addStyleTag({ content: 'html { --benchmark-edit: changed; }' });
    await visible;
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--benchmark-edit')), 'changed');
  } finally {
    await browser.close();
  }
});

test('RSC payload wire cost remains distinct from hydrated script transfer', () => {
  const responses = [
    { contentType: 'text/x-component; charset=utf-8', compressedBodyBytes: 42 },
    { contentType: 'text/javascript', compressedBodyBytes: 100 },
    { contentType: 'text/x-component', compressedBodyBytes: 8 },
  ];
  assert.equal(summarizeRscBytes(responses), 50);
  assert.equal(summarizeRscBytes([{ contentType: 'text/x-component' }]), null);
});

test('repeated measured edits each change source and restore the exact original bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'react-dev-edit-'));
  const path = join(directory, 'component.tsx');
  try {
    await writeFile(path, '<h1>Before</h1>\n');
    const restore = await editSourceFile({ file: 'component.tsx', from: 'Before', to: 'After' }, directory);
    assert.equal(await readFile(path, 'utf8'), '<h1>After</h1>\n');
    await restore();
    assert.equal(await readFile(path, 'utf8'), '<h1>Before</h1>\n');
    const second = await editSourceFile({ file: 'component.tsx', from: 'Before', to: 'Again' }, directory);
    assert.equal(await readFile(path, 'utf8'), '<h1>Again</h1>\n');
    await second();
    assert.equal(await readFile(path, 'utf8'), '<h1>Before</h1>\n');
    await assert.rejects(editSourceFile({ file: 'component.tsx', from: 'Missing', to: 'After' }, directory), /stimulus/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a dev command exiting before readiness fails without waiting for a second exit', { timeout: 10_000 }, async () => {
  // Given: a real child process that exits before it can report readiness.
  const config = {
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
    dev: { fluo: {
      start: [process.execPath, '-e', 'process.exit(4)'],
      url: 'http://127.0.0.1:1/',
      readyPattern: 'NEVER_READY',
      edits: {},
    } },
  };
  const driver = await createBrowserDriver(config, { devMode: true });
  try {
    // When: readiness observes the actual exit event.
    const result = await driver.check({ framework: 'fluo', runId: 'failed-ready', device: 'desktop', mode: 'native' });
    // Then: the failed child is reaped and cannot hang the representative run.
    assert.equal(result.pass, false);
    assert.match(result.steps[0].error, /dev server exited: 4/u);
  } finally {
    await driver.close();
  }
});

test('a usable dev page is ready without requiring an unrelated websocket event', { timeout: 25_000 }, async () => {
  // Given: an HTTP page with a visible heading and no WebSocket connection.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><h1>Usable dev page</h1>');
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = {
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
    dev: { next: {
      start: [process.execPath, '-e', 'console.log("READY"); require("node:http").createServer().listen(0)'],
      url: `http://127.0.0.1:${address.port}/`,
      readyPattern: 'READY',
      hmr: true,
      edits: {},
    } },
  };
  const driver = await createBrowserDriver(config, { devMode: true });
  try {
    // When: the browser loads the usable page without any HMR socket.
    const result = await driver.check({ framework: 'next', runId: 'http-ready', device: 'desktop', mode: 'native' });
    // Then: only the observable usable page gates cold-ready; edits still check visible changes.
    assert.equal(result.pass, true);
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('development collection: successful isolated driver intervals -> original headroom observations', { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dev-headroom-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const html = '<!doctype html><style>html { --benchmark-edit: before; }</style><h1 data-benchmark-hydrated="true">Before</h1><p>Server before</p>';
  await writeFile(join(directory, 'page.html'), html);
  const start = [process.execPath, '-e', `
    const { createServer } = require('node:http');
    const { readFileSync } = require('node:fs');
    createServer((request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(readFileSync('page.html'));
    }).listen(0, '127.0.0.1', function () {
      console.log('READY http://127.0.0.1:' + this.address().port);
    });
  `];
  // The ready URL is provided by an independently owned fixture server so each
  // measured child can bind an ephemeral port without sharing a dev process.
  const server = createServer(async (_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(await readFile(join(directory, 'page.html')));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const url = `http://127.0.0.1:${server.address().port}/`;
  const commands = {
    cwd: directory, start, url, readyPattern: 'READY',
    edits: {
      'react-edit': { file: 'page.html', from: 'Before', to: 'After', selector: 'h1',
        expectedText: 'After', explicitReload: true },
      'css-edit': { file: 'page.html', from: '--benchmark-edit: before', to: '--benchmark-edit: changed',
        selector: 'html', expectedStyle: { property: '--benchmark-edit', value: 'changed' }, relaunch: true },
      'server-edit': { file: 'page.html', from: 'Server before', to: 'Server after', selector: 'p',
        expectedText: 'Server after', relaunch: true },
    },
  };
  const config = {
    profile: 'desktop-native', mode: 'native', warmupRuns: 0, measurementRuns: 1,
    apps: Object.fromEntries(['fluo', 'next', 'react-router', 'tanstack-start'].map((name) => [name, url])),
    dev: Object.fromEntries(['fluo', 'next', 'react-router', 'tanstack-start'].map((name) => [name, commands])),
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  };
  const driver = await createBrowserDriver({ ...config, isolatedRepresentative: true }, { devMode: true });
  try {
    const receipt = await collectDevMeasurements(config, driver, join(directory, 'traces'));

    for (const run of receipt.runs) {
      const raw = JSON.parse(await readFile(run.trace));
      assert.equal(raw.correctness.pass, true);
      let previousEnd = -Infinity;
      for (const kind of ['cold-ready', 'react-edit', 'css-edit', 'server-edit']) {
        const timing = raw.timings[kind];
        assert.ok(timing.environmentHeadroom, `${kind} must retain its measured interval headroom`);
        const { before, after } = timing.environmentHeadroom;
        assert.deepEqual(timing.environmentHeadroom, summarizeEnvironmentHeadroom(before, after));
        assert.ok(before.monotonicMs <= after.monotonicMs - timing.durationMs);
        assert.ok(before.monotonicMs > previousEnd, 'each action retains its own interval');
        previousEnd = after.monotonicMs;
      }
    }
    assert.equal(await readFile(join(directory, 'page.html'), 'utf8'), html);
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('a streamed 404 waits for browser-visible failure after the navigation shell', { timeout: 10_000 }, async () => {
  // Given: the initial response paints navigation before streaming an error.
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<body><header>Catalog</header><main></main></body>');
    // When: subscribe to the document change before the visible failure arrives.
    const visible = waitForFailureText(page);
    await page.locator('main').evaluate((main) => { main.textContent = '404'; });
    // Then: the navigation shell alone cannot pass the failure check.
    assert.match(await visible, /404/u);
  } finally {
    await browser.close();
  }
});

for (const failure of ['navigation', 'frozen-navigation', 'cleanup-only']) {
test(`measurement ${failure} failure preserves error identity and acyclic cause`, { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'native-primary-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { chromium } = await import('@playwright/test');
  const primary = new Error('navigation failed before capture');
  if (failure === 'frozen-navigation') Object.freeze(primary);
  const cleanup = new Error('native close failed');
  let reportedCleanup;
  t.mock.method(console, 'error', (_message, error) => { reportedCleanup = error; });
  const launch = chromium.launchServer;
  const connect = chromium.connect;
  let browserExited = false;
  t.mock.method(chromium, 'launchServer', async (options) => {
    const server = await Reflect.apply(launch, chromium, [options]);
    const close = server.close;
    t.mock.method(server, 'close', async () => {
      await Reflect.apply(close, server, []);
      browserExited = true;
      throw cleanup;
    });
    return server;
  });
  t.mock.method(chromium, 'connect', async (...args) => {
    const browser = await Reflect.apply(connect, chromium, args);
    const newContext = browser.newContext;
    t.mock.method(browser, 'newContext', async (...contextArgs) => {
      const context = await Reflect.apply(newContext, browser, contextArgs);
      const newPage = context.newPage;
      t.mock.method(context, 'newPage', async () => {
        const page = await Reflect.apply(newPage, context, []);
        if (failure !== 'cleanup-only') t.mock.method(page, 'goto', async () => { throw primary; });
        return page;
      });
      return context;
    });
    return browser;
  });
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml('<!doctype html><h1>Listing</h1>'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const driver = await createBrowserDriver({
    journeys: Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
      .map((name) => [name, { path: '/' }])),
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    await assert.rejects(driver.measure({
      framework: 'fluo', runId: 'primary-failure', device: 'desktop', mode: 'native',
      nativeTraceDirectory: directory, url: `http://127.0.0.1:${server.address().port}/`,
    }), (error) => failure === 'navigation'
      ? error === primary && error.cause === cleanup
      : failure === 'frozen-navigation' ? error === primary && error.cause === undefined
        : error === cleanup && error.cause !== error);
    assert.equal(browserExited, true);
    assert.equal(reportedCleanup, failure === 'frozen-navigation' ? cleanup : undefined);
    assert.doesNotThrow(() => JSON.stringify(cleanup));
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});
}

for (const enabled of [false, true]) {
test(`native capture stays alive through unchanged throughput sampling with lifetime enabled=${enabled}`, { timeout: 20_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'native-driver-adoption-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { chromium } = await import('@playwright/test');
  const launch = chromium.launchServer;
  let captureClosed = false;
  t.mock.method(chromium, 'launchServer', async (options) => {
    const server = await Reflect.apply(launch, chromium, [options]);
    const close = server.close;
    t.mock.method(server, 'close', async () => {
      captureClosed = true;
      await Reflect.apply(close, server, []);
    });
    return server;
  });
  const observedAtThroughput = [];
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    if (request.url === '/throughput') {
      observedAtThroughput.push(captureClosed);
      response.end('sample');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml('<!doctype html><h1>Listing</h1>'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  let driver;
  let spawned = false;
  try {
    driver = await createBrowserDriver({
      journeys: Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
        .map((name) => [name, { path: '/' }])),
      throughput: { fluo: { path: '/throughput', requests: 2, concurrency: 1 } },
      nativeLifetime: { enabled, python: '/absent/native-python',
        spawn() { spawned = true; throw new Error('fixture runtime unavailable'); } },
      provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
    });
    const item = { framework: 'fluo', runId: 'native-lifetime', device: 'desktop',
      profile: 'desktop-native', mode: 'native', nativeTraceDirectory: directory,
      url: `http://127.0.0.1:${server.address().port}/` };
    const observation = await driver.measure(item);
    assert.deepEqual(observedAtThroughput, [false, false]);
    assert.equal(captureClosed, true);
    assert.equal(observation.requests.filter((request) => request.resourceType === 'throughput').length, 2);
    assert.equal(observation.metrics.errorRate, summarizeErrorRate(observation.requests));
    assert.equal(observation.timings.finalRequestCapture.captureTimestamp,
      observation.artifacts.nativeTerminalObserver.captureTimestamp);
    if (enabled) {
      assert.ok(observation.qualityFailures.includes('native lifetime: external runtime identity mismatch'));
      assert.equal(observation.artifacts.nativeLifetimeObserver.captureTimestamp,
        observation.artifacts.nativeTerminalObserver.captureTimestamp);
      const trace = join(directory, 'trace.json');
      await writeFile(trace, JSON.stringify({ schemaVersion: 1, ...item, ...observation,
        provenance: {}, environment: {}, profileSettings: {}, correctness: { pass: true } }));
      await verifyTraceFiles([{ trace }], directory);
    } else {
      assert.equal(spawned, false);
      assert.equal(Object.hasOwn(observation.artifacts, 'nativeLifetimeObserver'), false);
    }
  } finally {
    await driver?.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});
}

test('matched-cache disables browser reuse without changing native policy', () => {
  assert.deepEqual(cacheSettings('matched-cache'), { cacheDisabled: true });
  assert.deepEqual(cacheSettings('native'), { cacheDisabled: false });
  assert.throws(() => cacheSettings('unknown'), /cache mode/u);
});

test('reports actual initial-browser main-thread work and first shell paint', () => {
  // Given: CDP task duration in seconds and browser paint timing in milliseconds.
  const cdp = [{ name: 'TaskDuration', value: 0.12 }];
  const paint = [{ name: 'first-contentful-paint', startTime: 425 }];
  // When: the client-work metric is derived from observable browser counters.
  const metrics = initialClientWork(cdp, paint);
  // Then: it reports milliseconds without claiming that all work is hydration.
  assert.deepEqual(metrics, { hydrationMainThreadMs: 120, shellArrivalMs: 425 });
  assert.deepEqual(initialClientWork([], []), {});
});

test('counts initial document requests independently from subsequent journey requests', () => {
  // Given: a listing loads a document and stylesheet before the CRUD/jukebox sequence.
  const requests = [{ resourceType: 'document' }, { resourceType: 'stylesheet' }];
  // When: later interactions add another 77 requests to the raw inventory.
  const initialCount = initialRequestCount(requests);
  requests.push(...Array.from({ length: 77 }, () => ({ resourceType: 'fetch' })));
  // Then: the initial asset budget still measures the same surface as PR smoke.
  assert.equal(initialCount, 2);
  assert.equal(requests.length, 79);
});

test('a pending prefetch is inconclusive, not a completed request or a failed request', () => {
  assert.equal(summarizeErrorRate([
    { status: 200 }, { kind: 'request-pending', status: null },
    { kind: 'request-failed', error: 'net::ERR_ABORTED' },
  ]), 0.5);
  assert.equal(summarizeErrorRate([{ kind: 'request-pending', status: null }]), null);
});

test('capture retains the actual terminal outcome of each already-started finite response', async () => {
  const network = new Map([['success', {}], ['failure', {}]]);
  const changes = new EventEmitter();
  const controller = new AbortController();
  const capture = waitForCapturedRequests(network, changes, controller.signal);
  const requests = [];
  requests.push({ status: 200 });
  network.delete('success');
  changes.emit('settled');
  network.set('later-producer', {});
  requests.push({ kind: 'request-failed', error: 'net::ERR_ABORTED' });
  network.delete('failure');
  changes.emit('settled');
  const result = await capture;
  assert.deepEqual(result.requestIds, ['success', 'failure']);
  assert.deepEqual(result.pendingRequestIds, []);
  assert.equal(summarizeErrorRate(requests), 0.5);
  // A captured-ID drain is not native producer closure or permission to drop new work.
  assert.equal(network.has('later-producer'), true);
  assert.equal(changes.listenerCount('settled'), 0);
});

test('capture deadline preserves an unresolved request rather than inventing its terminal state', async () => {
  const network = new Map([['unresolved', {}]]);
  const changes = new EventEmitter();
  const controller = new AbortController();
  const capture = waitForCapturedRequests(network, changes, controller.signal);
  controller.abort();
  assert.deepEqual((await capture).pendingRequestIds, ['unresolved']);
  assert.equal(network.has('unresolved'), true);
  assert.equal(changes.listenerCount('settled'), 0);
});

test('records real decoded and compressed asset bytes from browser network events', { timeout: 20_000 }, async () => {
  const javascript = Buffer.from('window.benchmarkAsset = "decoded browser response";');
  const encoded = gzipSync(javascript);
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    if (request.url === '/asset.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript', 'content-encoding': 'gzip', 'content-length': encoded.length,
      });
      response.end(encoded);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml('<!doctype html><h1>Listing</h1><script src="/asset.js"></script>'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const journeys = Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
    .map((name) => [name, { path: '/' }]));
  const driver = await createBrowserDriver({
    journeys, provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    const observation = await driver.measure({
      framework: 'fluo', runId: 'encoded-asset', device: 'desktop', mode: 'native',
      url: `http://127.0.0.1:${address.port}/`,
    });
    const script = observation.requests.find((request) => request.url.endsWith('/asset.js') && request.phase === 'cold');
    assert.equal(script?.status, 200);
    assert.equal(script.bodyBytes, javascript.length);
    assert.equal(script.compressedBodyBytes, encoded.length);
    const initialScripts = observation.timings.initialBoundary.requests.filter((entry) => entry.resourceType === 'script');
    assert.equal(observation.metrics.transferredJsBytes, initialScripts.reduce((sum, entry) => sum + entry.bodyBytes, 0));
    assert.equal(observation.metrics.compressedJsBytes, initialScripts.reduce((sum, entry) => sum + entry.compressedBodyBytes, 0));
    assert.equal(observation.timings.initialBoundary.readiness.method, 'react-initial-completion-v1');
    assert.ok(observation.timings.initialBoundary.readiness.completedAt <= observation.timings.initialBoundary.sampledAt);
    assert.ok(observation.timings.initialBoundary.readiness.events.some((entry) => entry.event === 'post-passive'));
    assert.deepEqual(observation.qualityFailures, []);
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('browser request failures remain in error rate after successful throughput requests', { timeout: 20_000 }, async () => {
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    if (request.url === '/drop') { request.socket.destroy(); return; }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml('<!doctype html><h1>Listing</h1><img src="/drop">'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const journeys = Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
    .map((name) => [name, { path: '/' }]));
  const driver = await createBrowserDriver({
    journeys, throughput: { fluo: { requests: 2, concurrency: 1, path: '/' } },
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    const observation = await driver.measure({ framework: 'fluo', runId: 'request-failure',
      device: 'desktop', mode: 'native', url });
    assert.ok(observation.requests.some((request) => request.error && request.url.endsWith('/drop')));
    assert.ok(observation.metrics.errorRate > 0);
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('full document navigation retains an inconclusive interaction instead of a false approval', { timeout: 20_000 }, async () => {
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml(request.url === '/jukebox/qr'
      ? '<!doctype html><div data-approved-view="qr">QR destination</div>'
      : '<!doctype html><div data-benchmark-hydrated="true"><a href="/jukebox/qr">QR</a></div>'));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const journeys = Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
    .map((name) => [name, { path: '/' }]));
  const driver = await createBrowserDriver({
    journeys, interactions: [{
      path: '/jukebox/songs', trigger: 'a[href="/jukebox/qr"]',
      pending: '[data-navigation-pending]', approved: '[data-approved-view="qr"]',
    }],
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    const observation = await driver.measure({ framework: 'fluo', runId: 'document-replacement',
      device: 'desktop', mode: 'native', url: `http://127.0.0.1:${address.port}/` });
    assert.equal(Object.hasOwn(observation.metrics, 'interactionApprovedP50Ms'), false);
    assert.ok(observation.qualityFailures.some((failure) => failure.includes('document replaced')));
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('same-document pushState, replaceState, and hash navigation keep rendered approval', { timeout: 20_000 }, async () => {
  const server = createServer((request, response) => {
    if (fixtureResponse(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml(`<!doctype html><div data-benchmark-hydrated="true">
      <a href="/jukebox/qr" data-mode="pushState">Push</a>
      <a href="/jukebox/qr" data-mode="replaceState">Replace</a>
      <a href="#qr" data-mode="hash">Hash</a></div>
      <script>for (const link of document.querySelectorAll('a')) link.addEventListener('click', (event) => {
        event.preventDefault();
        if (link.dataset.mode === 'hash') location.hash = 'qr';
        else history[link.dataset.mode]({}, '', '/jukebox/qr');
        document.body.insertAdjacentHTML('beforeend', '<div data-approved-view="qr">Rendered QR</div>');
      });</script>`));
  });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const journeys = Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
    .map((name) => [name, { path: '/' }]));
  const driver = await createBrowserDriver({
    journeys,
    interactions: ['pushState', 'replaceState', 'hash'].map((mode) => ({
      path: '/jukebox/songs', trigger: `a[data-mode="${mode}"]`,
      pending: '[data-navigation-pending]', approved: '[data-approved-view="qr"]',
    })),
    provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
  });
  try {
    const observation = await driver.measure({ framework: 'fluo', runId: 'same-document',
      device: 'desktop', mode: 'native', url: `http://127.0.0.1:${address.port}/` });
    assert.ok(Number.isFinite(observation.metrics.interactionApprovedP50Ms));
    assert.ok(observation.timings.interactions.every((interaction) => Number.isFinite(interaction.approvedAt)));
    assert.ok(!observation.qualityFailures.some((failure) => failure.includes('document replaced')));
  } finally {
    await driver.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('marks a document-replacing interaction unavailable rather than throwing or pooling partial samples', () => {
  // Given: one framework replaced the document before the browser-side observer could resolve.
  const result = summarizeInteractions([
    { pendingAt: 10, approvedAt: 20 },
    { pendingAt: null, approvedAt: null, unavailable: 'document replaced' },
  ]);
  // When/Then: neither percentile can be reported from only the surviving event.
  assert.equal(Object.hasOwn(result.metrics, 'interactionPendingP95Ms'), false);
  assert.equal(Object.hasOwn(result.metrics, 'interactionApprovedP95Ms'), false);
  assert.equal(result.unavailable.interactionApprovedP95Ms, 'navigation timing unavailable for every interaction');
});

test('marks cached negative transfer sizes unavailable instead of inventing CSS bytes', () => {
  // Given: Playwright reports a negative transfer delta for one cached stylesheet.
  const requests = [
    { resourceType: 'script', bodyBytes: 120, compressedBodyBytes: 60 },
    { resourceType: 'stylesheet', bodyBytes: -1, compressedBodyBytes: -6 },
  ];
  // When: asset inventory is summarized before evaluating numeric budgets.
  const result = summarizeAssets(requests);
  // Then: valid script bytes remain usable; invalid CSS cannot become a negative metric.
  assert.equal(result.metrics.transferredJsBytes, 120);
  assert.equal(result.metrics.compressedJsBytes, 60);
  assert.equal(Object.hasOwn(result.metrics, 'transferredCssBytes'), false);
  assert.equal(result.unavailable.transferredCssBytes, 'incomplete browser resource sizes');
  assert.equal(result.unavailable.compressedCssBytes, 'incomplete browser resource sizes');
});
