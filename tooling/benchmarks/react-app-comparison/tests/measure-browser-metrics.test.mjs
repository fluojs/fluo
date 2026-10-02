import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import { cacheSettings, createBrowserDriver, editSourceFile, initialClientWork, initialRequestCount, observeDevReadiness, summarizeAssets, summarizeErrorRate, summarizeInteractions, summarizeRscBytes, waitForCapturedRequests, waitForEditMarker, waitForFailureText } from '../src/measure-browser.mjs';
import { installInitialReadiness, waitForInitialReadiness } from '../src/initial-readiness.mjs';

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

for (const protocol of ['vite', 'next-webpack']) {
test(`${protocol} readiness authenticates the upgrade and exact structured frame`, async () => {
  const cdp = new EventEmitter();
  const path = protocol === 'vite' ? '/' : '/_next/hmr';
  const wait = observeDevReadiness(cdp, { protocol, path }, 'http://localhost:1234/');
  const message = protocol === 'vite' ? { type: 'connected' }
    : { type: 'sync', hash: 'compiled-hash', errors: [], warnings: [] };
  const socket = (requestId, url, subprotocol) => {
    cdp.emit('Network.webSocketCreated', { requestId, url });
    cdp.emit('Network.webSocketHandshakeResponseReceived', {
      requestId, response: { status: 101, headers: subprotocol ? { 'Sec-WebSocket-Protocol': subprotocol } : {} },
    });
  };
  const frame = (requestId, payloadData) => cdp.emit('Network.webSocketFrameReceived', {
    requestId, timestamp: 42, response: { opcode: 1, payloadData },
  });
  // Preserve the actual CDP lifecycle. Neither a different origin/path nor a
  // wrong negotiated subprotocol may complete the wait, even with valid JSON.
  socket('other-origin', `ws://localhost:5678${path}?id=page`, protocol === 'vite' ? 'vite-hmr' : null);
  socket('other-path', 'ws://localhost:1234/chat?id=page', protocol === 'vite' ? 'vite-hmr' : null);
  socket('wrong-protocol', `ws://localhost:1234${path}?id=page`, 'chat');
  for (const id of ['other-origin', 'other-path', 'wrong-protocol']) frame(id, JSON.stringify(message));
  socket('hmr', `ws://localhost:1234${path}?id=page`, protocol === 'vite' ? 'vite-hmr' : null);
  frame('hmr', '[HMR] connected');
  frame('hmr', JSON.stringify({ type: 'unrelated', text: 'connected' }));
  assert.equal(cdp.listenerCount('Network.webSocketFrameReceived'), 1);
  frame('hmr', JSON.stringify(message));
  const observed = await wait.promise;
  assert.equal(observed.requestId, 'hmr');
  assert.deepEqual(observed.message, message);
  assert.equal(observed.cdpTimestamp, 42);
  assert.equal(cdp.eventNames().length, 0);
});
}

test('HMR readiness cancellation removes every subscription', async () => {
  const cdp = new EventEmitter();
  const wait = observeDevReadiness(cdp, { protocol: 'vite', path: '/' }, 'http://localhost:1234/');
  const rejected = assert.rejects(wait.promise, /cancelled/u);
  wait.cancel();
  await rejected;
  assert.equal(cdp.eventNames().length, 0);
});

test('readiness observes the installed Vite client in a real browser', { timeout: 20_000 }, async () => {
  const { createServer: createViteServer } = await import(appRequire.resolve('vite'));
  const { chromium } = await import('@playwright/test');
  const server = await createViteServer({ configFile: false, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const url = server.resolvedUrls.local[0];
    const wait = observeDevReadiness(cdp, { protocol: 'vite', path: '/' }, url);
    try {
      // The real installed /@vite/client initiates and processes the HMR socket.
      await page.goto(new URL('/@vite/client', url).href);
      await page.evaluate(() => import(location.href));
      const observed = await wait.promise;
      assert.equal(observed.message.type, 'connected');
      assert.equal(observed.protocol, 'vite');
      assert.ok(observed.elapsedMs >= 0);
    } finally { wait.cancel(); }
  } finally {
    await browser?.close();
    await server.close();
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

for (const readinessOutput of ['READY', '\u001b[32mRE\u001b[1mAD\u001b[0mY']) {
test(`a usable dev page recognizes ${JSON.stringify(readinessOutput)} without a websocket event`, { timeout: 70_000 }, async () => {
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
      start: [process.execPath, '-e', `console.log(${JSON.stringify(readinessOutput)}); require("node:http").createServer().listen(0)`],
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
}

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

test('native capture stays alive through unchanged throughput sampling', { timeout: 20_000 }, async (t) => {
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
  try {
    driver = await createBrowserDriver({
      journeys: Object.fromEntries(['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox']
        .map((name) => [name, { path: '/' }])),
      throughput: { fluo: { path: '/throughput', requests: 2, concurrency: 1 } },
      provenance: { browser: 'Chromium', runtime: process.version, lockfile: {}, builds: {}, dataset: 'fixture' },
    });
    await driver.measure({ framework: 'fluo', runId: 'native-lifetime', device: 'desktop',
      mode: 'native', url: `http://127.0.0.1:${server.address().port}/` });
    assert.deepEqual(observedAtThroughput, [false, false]);
    assert.equal(captureClosed, true);
  } finally {
    await driver?.close();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

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
