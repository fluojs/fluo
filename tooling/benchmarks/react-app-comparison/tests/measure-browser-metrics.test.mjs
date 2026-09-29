import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { cacheSettings, createBrowserDriver, editSourceFile, initialClientWork, initialRequestCount, summarizeAssets, summarizeInteractions, summarizeRscBytes, waitForEditMarker, waitForFailureText } from '../src/measure-browser.mjs';

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

test('browser request failures remain in error rate after successful throughput requests', { timeout: 20_000 }, async () => {
  const server = createServer((request, response) => {
    if (request.url === '/drop') { request.socket.destroy(); return; }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><h1>Listing</h1><img src="/drop">');
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
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(request.url === '/jukebox/qr'
      ? '<!doctype html><div data-approved-view="qr">QR destination</div>'
      : '<!doctype html><div data-benchmark-hydrated="true"><a href="/jukebox/qr">QR</a></div>');
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
