import { execFile, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { PROFILES, sampleEnvironmentHeadroom, summarizeEnvironmentHeadroom } from './measure.mjs';
import { stopOwnedProcess } from './process-group.mjs';
import { installInitialReadiness, waitForInitialReadiness } from './initial-readiness.mjs';
import { createNativeCapture, reconcileNativeTerminals } from './native-terminal.mjs';
import { readServerCpu } from './server-cpu.mjs';
import { assertMethodConfig, hashObject } from './fa-v2.mjs';

export { reconcileNativeTerminals } from './native-terminal.mjs';
export { readServerCpu } from './server-cpu.mjs';

const JOURNEYS = ['listing', 'detail', 'auth', 'create', 'update', 'delete', 'failure', 'jukebox'];
const execFileAsync = promisify(execFile);

export function resolveJourneyValue(value, createdPath) {
  if (!value.includes('$created')) return value;
  if (!createdPath) throw new TypeError('created product destination is not available');
  return value.replaceAll('$created', createdPath);
}

export function initialClientWork(cdpMetrics, paintEntries) {
  const task = cdpMetrics.find((entry) => entry.name === 'TaskDuration')?.value;
  const paint = paintEntries.find((entry) => entry.name === 'first-contentful-paint')?.startTime;
  return {
    ...(Number.isFinite(task) && task >= 0 ? { hydrationMainThreadMs: task * 1000 } : {}),
    ...(Number.isFinite(paint) && paint >= 0 ? { shellArrivalMs: paint } : {}),
  };
}

export function summarizeAssets(requests) {
  const metrics = {};
  const unavailable = {};
  for (const [name, type, size] of [
    ['transferredJsBytes', 'script', 'bodyBytes'], ['compressedJsBytes', 'script', 'compressedBodyBytes'],
    ['transferredCssBytes', 'stylesheet', 'bodyBytes'], ['compressedCssBytes', 'stylesheet', 'compressedBodyBytes'],
  ]) {
    const assets = requests.filter((request) => request.resourceType === type);
    if (assets.every((request) => Number.isFinite(request[size]) && request[size] >= 0)) {
      metrics[name] = assets.reduce((sum, request) => sum + request[size], 0);
    } else {
      unavailable[name] = 'incomplete browser resource sizes';
    }
  }
  return { metrics, unavailable };
}

export function summarizeInteractions(interactions) {
  const metrics = {};
  const unavailable = {};
  for (const [name, field, quantile] of [
    ['interactionPendingP50Ms', 'pendingAt', 0.5], ['interactionPendingP95Ms', 'pendingAt', 0.95],
    ['interactionApprovedP50Ms', 'approvedAt', 0.5], ['interactionApprovedP95Ms', 'approvedAt', 0.95],
  ]) {
    const values = interactions.map((entry) => entry?.[field]);
    if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
      unavailable[name] = 'navigation timing unavailable for every interaction';
    } else {
      metrics[name] = percentile(values, quantile);
    }
  }
  return { metrics, unavailable };
}

export function initialRequestCount(requests) {
  return requests.length;
}

export async function waitForCapturedRequests(network, networkChanges, signal) {
  const requestIds = [...network.keys()];
  return new Promise((accept) => {
    const check = () => {
      const pendingRequestIds = requestIds.filter((id) => network.has(id));
      if (pendingRequestIds.length && !signal.aborted) return;
      networkChanges.off('settled', check);
      signal.removeEventListener('abort', check);
      accept({ requestIds, pendingRequestIds });
    };
    networkChanges.on('settled', check);
    signal.addEventListener('abort', check, { once: true });
    check();
  });
}

export function summarizeErrorRate(requests) {
  const settled = requests.filter((request) => request.kind !== 'request-pending');
  return settled.length ? settled.filter((request) =>
    request.error || request.status >= 400).length / settled.length : null;
}

export function summarizeRscBytes(requests) {
  const rsc = requests.filter((request) => /^text\/x-component(?:;|$)/iu.test(request.contentType ?? ''));
  return rsc.every((request) => Number.isFinite(request.compressedBodyBytes) && request.compressedBodyBytes >= 0)
    ? rsc.reduce((sum, request) => sum + request.compressedBodyBytes, 0) : null;
}

export function cacheSettings(mode) {
  if (mode !== 'native' && mode !== 'matched-cache') throw new RangeError(`unknown cache mode: ${mode}`);
  return { cacheDisabled: mode === 'matched-cache' };
}

export async function waitForFailureText(page) {
  return page.locator('body').evaluate((body) => new Promise((resolveText, rejectText) => {
    const visible = () => {
      const text = body.innerText.trim();
      if (!/\b404\b|not found/iu.test(text)) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolveText(text);
    };
    const observer = new MutationObserver(visible);
    const timeout = setTimeout(() => {
      observer.disconnect();
      rejectText(new Error('failure: no browser-visible 404 response'));
    }, 10_000);
    observer.observe(body, { childList: true, characterData: true, subtree: true });
    visible();
  }));
}

export async function waitForEditMarker(page, edit) {
  await page.evaluate(({ selector, expectedText, expectedStyle }) => new Promise((resolveVisible, rejectVisible) => {
    const expected = expectedStyle?.value ?? expectedText;
    const visible = () => {
      const element = document.querySelector(selector);
      const value = element && (expectedStyle
        ? getComputedStyle(element).getPropertyValue(expectedStyle.property) : element.textContent);
      if (!value?.includes(expected)) return;
      observer.disconnect();
      document.removeEventListener('load', visible, true);
      clearTimeout(timeout);
      resolveVisible();
    };
    const observer = new MutationObserver(visible);
    const timeout = setTimeout(() => {
      observer.disconnect();
      document.removeEventListener('load', visible, true);
      rejectVisible(new Error('edit-to-visible event timeout'));
    }, 60_000);
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener('load', visible, true);
    visible();
  }), edit);
}

export async function editSourceFile(edit, cwd) {
  const path = resolve(cwd, edit.file);
  if (!path.startsWith(`${resolve(cwd)}/`)) throw new TypeError(`edit outside application: ${edit.file}`);
  const original = await readFile(path, 'utf8');
  if (!edit.from || !edit.to || original.split(edit.from).length !== 2) {
    throw new Error(`missing or ambiguous edit stimulus: ${edit.file}`);
  }
  await writeFile(path, original.replace(edit.from, edit.to));
  return () => writeFile(path, original);
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(quantile * sorted.length) - 1];
}

export async function createBrowserDriver(config, { devMode = false } = {}) {
  if (config.methodVersion !== undefined) assertMethodConfig(config);
  if (!devMode && (!config.journeys || JOURNEYS.some((name) => !config.journeys[name]))) {
    throw new Error(`browser correctness requires configured journeys: ${JOURNEYS.join(', ')}`);
  }
  if (!config.provenance?.browser || !config.provenance?.runtime || !config.provenance?.lockfile
    || !config.provenance?.builds || !config.provenance?.dataset) {
    throw new Error('browser/runtime/lockfile/builds/dataset provenance required');
  }
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const contexts = new Map();
  const devServers = new Map();
  const editsToRestore = new Map();

  async function stopDevServer(server) {
    await stopOwnedProcess(server);
  }

  async function createPage(item, owner = browser) {
    const context = await owner.newContext({ viewport: PROFILES[item.device].viewport });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const profile = PROFILES[item.device];
    await cdp.send('Network.enable');
    const cache = cacheSettings(item.mode);
    await cdp.send('Network.setCacheDisabled', cache);
    await cdp.send('Performance.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: profile.latencyMs,
      downloadThroughput: profile.downloadBytesPerSecond,
      uploadThroughput: profile.uploadBytesPerSecond,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
    await page.addInitScript(() => {
      window.__benchmarkLcp = null;
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) window.__benchmarkLcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    return { context, page, cdp };
  }

  async function closeDevelopment(key) {
    const owned = contexts.get(key);
    const server = devServers.get(key);
    contexts.delete(key);
    devServers.delete(key);
    if (server) await stopDevServer(server);
    await owned?.context.close();
    for (const restore of editsToRestore.get(key) ?? []) await restore();
    editsToRestore.delete(key);
  }

  return {
    browserVersion: browser.version(),
    async closeDev(item) {
      await closeDevelopment(item.runId + item.framework);
    },
    async restartDev(item) {
      await closeDevelopment(item.runId + item.framework);
      return this.check(item);
    },
    async check(item) {
      if (devMode) {
        const commands = config.dev[item.framework];
        if (!Array.isArray(commands?.start) || commands.start.length === 0 || !commands.readyPattern || !commands.edits) {
          return { pass: false, steps: [{ name: 'dev-config', pass: false }] };
        }
        const cwd = commands.cwd ?? resolve(import.meta.dirname, `../apps/${item.framework}`);
        const headroomBefore = config.isolatedRepresentative ? sampleEnvironmentHeadroom() : null;
        const started = performance.now();
        const server = spawn(commands.start[0], commands.start.slice(1), {
          cwd, env: { ...process.env, ...commands.env }, stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
        let log = '';
        const ready = new Promise((accept, reject) => {
          const timeout = setTimeout(() => reject(new Error('dev-ready timeout')), 60_000);
          const onData = (chunk) => {
            log += chunk.toString();
            if (log.includes(commands.readyPattern)) { clearTimeout(timeout); accept(); }
          };
          server.stdout.on('data', onData);
          server.stderr.on('data', onData);
          server.once('error', (error) => { clearTimeout(timeout); reject(error); });
          server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`dev server exited: ${code}`)); });
        });
        let created;
        try {
          await ready;
          created = await createPage(item);
          const { context, page } = created;
          const response = await page.goto(commands.url ?? item.url, { waitUntil: 'domcontentloaded' });
          if (!response?.ok()) throw new Error(`dev page HTTP ${response?.status()}`);
          await page.locator('h1').first().waitFor({ state: 'visible', timeout: 60_000 });
          const readyMs = performance.now() - started;
          const environmentHeadroom = headroomBefore
            ? summarizeEnvironmentHeadroom(headroomBefore, sampleEnvironmentHeadroom()) : undefined;
          contexts.set(item.runId + item.framework, { context, page, readyMs, environmentHeadroom, serverLog: () => log });
          devServers.set(item.runId + item.framework, server);
          return { pass: true, steps: [{ name: 'dev-ready', pass: true, elapsedMs: readyMs, url: commands.url, log }] };
        } catch (error) {
          await stopDevServer(server);
          await created?.context.close();
          return { pass: false, steps: [{ name: 'dev-ready', pass: false, error: String(error), log }] };
        }
      }
      const { context, page } = await createPage(item);
      const steps = [];
      let createdPath = null;
      try {
        for (const name of JOURNEYS) {
          const journey = config.journeys[name];
          const path = resolveJourneyValue(journey.path, createdPath);
          const response = await page.goto(new URL(path, item.url).href, { waitUntil: 'domcontentloaded' });
          if (journey.status !== undefined && response?.status() !== journey.status) {
            throw new Error(`${name}: HTTP ${response?.status()} instead of ${journey.status}`);
          }
          for (const action of journey.actions ?? []) {
            if (action.fill) await page.locator(resolveJourneyValue(action.fill, createdPath)).fill(action.value);
            if (action.click) await page.locator(resolveJourneyValue(action.click, createdPath)).click();
          }
          if (name === 'failure') {
            await waitForFailureText(page);
          } else {
            await page.locator(resolveJourneyValue(journey.expect, createdPath)).waitFor({ state: 'visible', timeout: 10_000 });
          }
          if (name === 'create') createdPath = new URL(page.url()).pathname;
          steps.push({ name, pass: true });
        }
        await context.close();
        return { pass: true, steps };
      } catch (error) {
        steps.push({ name: JOURNEYS[steps.length], pass: false, error: String(error) });
        await context.close();
        return { pass: false, steps };
      }
    },
    async measure(item) {
      const native = await createNativeCapture(chromium, item.nativeTraceDirectory, config.nativeLifetime?.enabled
        ? { ...config.nativeLifetime, measurement: { runId: item.runId, framework: item.framework,
          profile: item.profile, mode: item.mode,
          ...(item.methodBinding ? { methodVersion: item.methodVersion, measurementPurpose: item.measurementPurpose,
            pairId: item.methodBinding.pairId, executionId: item.methodBinding.executionId,
            ...(item.methodVersion === 'FA-V3' ? { measurementKind: item.measurementKind,
              pairPhase: item.methodBinding.pairPhase, configSha256: item.methodBinding.configSha256,
              productSha256: item.methodBinding.productSha256 } : {}) } : {}) } } : undefined);
      let measurementFailed = false;
      let measurementError;
      try {
      const { context, page, cdp } = await createPage(item, native.browser);
      await native.prepareLifetime(cdp);
      const lifetimeIdentity = native.lifetimeIdentity;
      const nativeSubscriptions = [];
      for (const name of ['Network.requestWillBeSent', 'Network.requestWillBeSentExtraInfo',
        'Network.responseReceived', 'Network.responseReceivedExtraInfo', 'Network.dataReceived',
        'Network.loadingFinished', 'Network.loadingFailed', 'Page.frameNavigated', 'Page.frameDetached']) {
        const observe = (data) => native.ledger.push({ name, data, ...lifetimeIdentity });
        cdp.on(name, observe);
        nativeSubscriptions.push([name, observe]);
      }
      await cdp.send('Page.enable');
      await installInitialReadiness(page);
      const requests = [];
      const qualityFailures = [];
      const network = new Map();
      const networkChanges = new EventEmitter();
      let phase = 'cold';
      let collecting = true;
      const occurrences = new Map();
      cdp.on('Network.requestWillBeSent', ({ requestId, loaderId, frameId, initiator, timestamp, wallTime, request, type, redirectResponse }) => {
        if (!collecting) return;
        occurrences.set(requestId, (occurrences.get(requestId) ?? 0) + 1);
        if (redirectResponse) {
          const previous = network.get(requestId);
          requests.push({
            ...previous, status: redirectResponse.status, kind: 'redirect',
            transferBytes: redirectResponse.encodedDataLength,
            unavailable: 'redirect response body not exposed by CDP',
          });
        }
        network.set(requestId, {
          ...(lifetimeIdentity ? { ...lifetimeIdentity, occurrence: occurrences.get(requestId) } : {}),
          requestId, loaderId, frameId, initiator, startedTimestamp: timestamp, wallTime, method: request.method,
          url: request.url, resourceType: type?.toLowerCase() ?? 'other', phase,
          documentUrl: page.url(), pageClosed: page.isClosed(), status: null,
          compressedBodyBytes: 0,
        });
      });
      cdp.on('Network.responseReceived', ({ requestId, response, type }) => {
        const entry = network.get(requestId);
        if (!collecting || !entry) return;
        const headers = Object.fromEntries(Object.entries(response.headers)
          .map(([name, value]) => [name.toLowerCase(), value]));
        Object.assign(entry, {
          status: response.status, resourceType: type.toLowerCase(),
          contentEncoding: headers['content-encoding'] ?? null,
          contentType: headers['content-type'] ?? null,
          cacheControl: headers['cache-control'] ?? null,
        });
      });
      cdp.on('Network.dataReceived', ({ requestId, dataLength, encodedDataLength }) => {
        const entry = network.get(requestId);
        if (collecting && entry) {
          entry.compressedBodyBytes += encodedDataLength;
          entry.bodyBytes = (entry.bodyBytes ?? 0) + dataLength;
        }
      });
      cdp.on('Network.loadingFailed', ({ requestId, errorText, canceled, timestamp }) => {
        const entry = network.get(requestId);
        if (!collecting || !entry) return;
        requests.push({ ...entry, kind: 'request-failed', error: errorText, canceled,
          settledPhase: phase, settledTimestamp: timestamp });
        network.delete(requestId);
        networkChanges.emit('settled');
      });
      cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength, timestamp }) => {
        const entry = network.get(requestId);
        if (!collecting || !entry) return;
        Object.assign(entry, { settledPhase: phase, settledTimestamp: timestamp });
        if (entry.status === null || (entry.bodyBytes === undefined && ![204, 205, 304].includes(entry.status))) {
          const reason = entry.status === null ? 'HTTP response status unavailable'
            : 'decoded body bytes unavailable: no Network.dataReceived event';
          requests.push({
            ...entry, transferBytes: encodedDataLength, kind: 'response-capture-failed',
            error: reason,
          });
          qualityFailures.push(`response capture failed: ${entry.url}: ${reason}`);
        } else {
          requests.push({ ...entry, transferBytes: encodedDataLength, bodyBytes: entry.bodyBytes ?? 0 });
        }
        network.delete(requestId);
        networkChanges.emit('settled');
      });
      try {
        const headroomBefore = config.isolatedRepresentative ? sampleEnvironmentHeadroom() : null;
        const listing = new URL(config.journeys.listing.path, item.url).href;
        await page.goto(listing, { waitUntil: 'load' });
        const initialReadiness = await waitForInitialReadiness(page);
        // Subscribe before checking the identity inventory: no lost settlement event,
        // no network-idle heuristic and no waiting for unrelated speculative RSC.
        const waitForInitialResources = async (ownerPhase) => {
          await new Promise((accept, reject) => {
            const check = () => {
              if ([...network.values()].some((entry) => entry.phase === ownerPhase
                && ['document', 'script', 'stylesheet'].includes(entry.resourceType))) return;
              cleanup();
              accept();
            };
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error('initial React completion resource timeout'));
            }, 10_000);
            const cleanup = () => {
              clearTimeout(timeout);
              networkChanges.off('settled', check);
            };
            networkChanges.on('settled', check);
            check();
          });
          const failedInitialResources = requests.filter((entry) => entry.phase === ownerPhase
            && ['document', 'script', 'stylesheet'].includes(entry.resourceType) && entry.error);
          if (failedInitialResources.length) throw new Error('initial React completion resource failure');
        };
        await waitForInitialResources('cold');
        const cold = await page.evaluate(() => ({
          navigation: performance.getEntriesByType('navigation')[0]?.toJSON() ?? null,
          lcp: window.__benchmarkLcp,
          hydration: performance.getEntriesByName('hydration')[0]?.duration ?? null,
          shell: performance.getEntriesByName('shell-arrival')[0]?.startTime ?? null,
        }));
        const initialCdpMetrics = (await cdp.send('Performance.getMetrics')).metrics;
        const initialPaintEntries = await page.evaluate(() => performance.getEntriesByType('paint').map((entry) => ({
          name: entry.name, startTime: entry.startTime,
        })));
        const clientWork = initialClientWork(initialCdpMetrics, initialPaintEntries);
        const initialRequests = [
          ...requests.filter((request) => request.phase === 'cold'),
          ...[...network.values()].filter((request) => request.phase === 'cold')
            .map((request) => ({ ...request, kind: 'request-pending',
              unavailable: 'request still in flight at initial completion boundary' })),
        ];
        const initialBoundary = {
          readiness: initialReadiness,
          sampledAt: await page.evaluate(() => performance.now()),
          cdpMetrics: initialCdpMetrics,
          paintEntries: initialPaintEntries,
          requests: initialRequests,
          pendingAtWarmTrigger: [...network.values()].map((entry) => ({ ...entry })),
        };
        initialBoundary.warmTriggeredAt = await page.evaluate(() => performance.now());
        phase = 'warm';
        await page.goto(listing, { waitUntil: 'load' });
        const warmReadiness = await waitForInitialReadiness(page);
        await waitForInitialResources('warm');
        const warmBoundary = {
          readiness: warmReadiness,
          completedAt: await page.evaluate(() => performance.now()),
          pendingAtInteraction: [...network.values()].map((entry) => ({ ...entry })),
        };
        const warm = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.toJSON() ?? null);
        const interactions = [];
        phase = 'interaction';
        for (const action of config.interactions ?? []) {
          await page.goto(new URL(action.path, item.url).href, { waitUntil: 'load' });
          await page.locator('[data-benchmark-hydrated="true"]').waitFor({ state: 'visible', timeout: 10_000 });
          const documentToken = await page.evaluate(({ trigger, pending, approved }) => {
            window.__benchmarkDocumentToken = crypto.randomUUID();
            window.__benchmarkInteraction = new Promise((done) => {
              document.addEventListener('click', (event) => {
                if (!event.target.closest(trigger)) return;
                const start = performance.now();
                let pendingAt = null;
                const observer = new MutationObserver(() => {
                  if (pendingAt === null && document.querySelector(pending)) pendingAt = performance.now() - start;
                  const approvedAt = document.querySelector(approved) ? performance.now() - start : null;
                  if (approvedAt !== null) { observer.disconnect(); done({ pendingAt, approvedAt }); }
                });
                observer.observe(document, { subtree: true, childList: true, attributes: true });
              }, { capture: true, once: true });
            });
            return window.__benchmarkDocumentToken;
          }, action);
          await page.locator(action.trigger).click();
          const observation = await page.evaluate((token) => {
            if (window.__benchmarkDocumentToken !== token) {
              return { pendingAt: null, approvedAt: null, unavailable: 'document replaced the browser timing observer' };
            }
            return Promise.race([
              window.__benchmarkInteraction,
              new Promise((_, reject) => setTimeout(() => reject(new Error('approved view timeout')), 10_000)),
            ]);
          }, documentToken).catch((error) => ({
            pendingAt: null, approvedAt: null,
            unavailable: /execution context was destroyed/iu.test(String(error))
              ? 'document replaced the browser timing observer' : String(error),
          }));
          interactions.push(observation);
          if (observation.unavailable) qualityFailures.push(observation.unavailable);
        }
        // Keep approved DOM latency unchanged. Capture actual HTTP terminals before
        // closing the context; this finite ID inventory is not producer closure.
        const finalRequestCapture = await waitForCapturedRequests(network, networkChanges, AbortSignal.timeout(10_000));
        const captureMetrics = (await native.captureClock(() => cdp.send('Performance.getMetrics'))).metrics;
        const captureTimestamp = captureMetrics.find((metric) => metric.name === 'Timestamp')?.value;
        if (!Number.isFinite(captureTimestamp)) throw new Error('native terminal capture monotonic clock unavailable');
        collecting = false;
        for (const entry of network.values()) {
          requests.push({ ...entry, kind: 'request-pending',
            unavailable: 'request still in flight at capture boundary' });
        }
        network.clear();
        native.ledger.push({ name: 'capture-boundary', data: { captureTimestamp, finalRequestCapture,
          ...(item.methodBinding ? { methodBinding: item.methodBinding } : {}) } });
        for (const [name, observe] of nativeSubscriptions) cdp.off(name, observe);
        const metrics = {};
        const unavailable = {};
        if (cold.navigation) {
          metrics.coldTtfbMs = cold.navigation.responseStart - cold.navigation.requestStart;
          if (clientWork.shellArrivalMs !== undefined) metrics.shellArrivalMs = clientWork.shellArrivalMs;
        }
        if (warm) metrics.warmTtfbMs = warm.responseStart - warm.requestStart;
        if (cold.lcp !== null) metrics.lcpMs = cold.lcp;
        if (clientWork.hydrationMainThreadMs !== undefined) metrics.hydrationMainThreadMs = clientWork.hydrationMainThreadMs;
        const interactionSummary = summarizeInteractions(interactions);
        Object.assign(metrics, interactionSummary.metrics);
        Object.assign(unavailable, interactionSummary.unavailable);
        const assetSummary = summarizeAssets(initialRequests);
        Object.assign(metrics, assetSummary.metrics);
        Object.assign(unavailable, assetSummary.unavailable);
        metrics.requestCount = initialRequestCount(initialRequests);
        const throughput = config.throughput?.[item.framework];
        if (throughput) {
          if (!Number.isSafeInteger(throughput.requests) || throughput.requests < 1
            || !Number.isSafeInteger(throughput.concurrency) || throughput.concurrency < 1) {
            throw new RangeError('throughput requires positive requests and concurrency');
          }
          const sent = [];
          const started = performance.now();
          for (let batch = 0; batch < throughput.requests; batch += throughput.concurrency) {
            const count = Math.min(throughput.concurrency, throughput.requests - batch);
            sent.push(...await Promise.all(Array.from({ length: count }, async () => {
              try {
                const response = await fetch(new URL(throughput.path, item.url), { signal: AbortSignal.timeout(10_000) });
                await response.arrayBuffer();
                return { status: response.status };
              } catch (error) { return { error: String(error) }; }
            })));
          }
          const elapsedMs = performance.now() - started;
          metrics.throughputRequestsPerSecond = sent.length * 1000 / elapsedMs;
          requests.push(...sent.map((response) => ({ ...response, url: new URL(throughput.path, item.url).href, resourceType: 'throughput' })));
        }
        const serverPid = config.serverPids?.[item.framework];
        let serverCpu;
        let generator;
        {
          const { stdout } = await execFileAsync('ps', ['-p', String(process.pid), '-o', '%cpu=', '-o', 'rss=']);
          const [cpu, rss] = stdout.trim().split(/\s+/).map(Number);
          generator = { pid: process.pid, cpuPercent: cpu, rssBytes: rss * 1024 };
        }
        if (['FA-V2', 'FA-V3'].includes(config.methodVersion)) {
          serverCpu = await readServerCpu(serverPid);
          metrics.cpuPercent = serverCpu.cpuPercent;
          metrics.rssBytes = serverCpu.rssBytes;
        } else if (Number.isSafeInteger(serverPid) && serverPid > 0) {
          const { stdout } = await execFileAsync('ps', ['-p', String(serverPid), '-o', '%cpu=', '-o', 'rss=']);
          const [cpu, rss] = stdout.trim().split(/\s+/).map(Number);
          if (Number.isFinite(cpu) && Number.isFinite(rss)) {
            metrics.cpuPercent = cpu;
            metrics.rssBytes = rss * 1024;
          }
        }
        const environmentHeadroom = headroomBefore
          ? summarizeEnvironmentHeadroom(headroomBefore, sampleEnvironmentHeadroom()) : undefined;
        // Keep the original page lifetime through throughput and post-workload
        // CPU/RSS snapshots. Only the browser-request cutoff precedes them.
        const nativeEvidence = await native.read(captureTimestamp);
        let reconciled = reconcileNativeTerminals(requests, nativeEvidence.log, nativeEvidence.provenance, native.ledger);
        if (nativeEvidence.lifetime) {
          const { reconcileNativeLifetime } = await import('./native-lifetime.mjs');
          const result = reconcileNativeLifetime(reconciled, nativeEvidence.lifetime.observation, native.ledger);
          reconciled = result.requests;
          qualityFailures.push(...result.unavailable);
        }
        requests.splice(0, requests.length, ...reconciled);
        finalRequestCapture.cdpPendingRequestIds = finalRequestCapture.pendingRequestIds;
        finalRequestCapture.pendingRequestIds = requests.filter((entry) => entry.kind === 'request-pending')
          .map((entry) => entry.requestId);
        finalRequestCapture.nativeResolvedRequestIds = requests.filter((entry) => entry.nativeTerminal || entry.nativeLifetime)
          .map((entry) => entry.requestId);
        finalRequestCapture.captureTimestamp = captureTimestamp;
        for (const entry of requests.filter((request) => request.kind === 'request-pending')) {
          qualityFailures.push(`request pending at capture boundary: ${entry.url}`);
        }
        const errorRate = summarizeErrorRate(requests);
        if (errorRate !== null) metrics.errorRate = errorRate;
        return {
          metrics, unavailable, qualityFailures, requests, timings: { cold, warm, interactions, initialBoundary, warmBoundary, finalRequestCapture },
          artifacts: {
            nativeTerminalObserver: nativeEvidence.provenance,
            ...(nativeEvidence.lifetime ? { nativeLifetimeObserver: nativeEvidence.lifetime.provenance } : {}),
            cachePolicy: item.mode,
            browserCacheDisabled: cacheSettings(item.mode).cacheDisabled,
            framework: item.framework,
            throughput,
            serverPid,
            ...(serverCpu ? { serverCpu, serverCpuSha256: hashObject(serverCpu) } : {}),
            generator,
            ...(environmentHeadroom ? { environmentHeadroom } : {}),
            rscResponseWireBytes: summarizeRscBytes(requests),
            rscMethod: 'separate text/x-component responses only; inline RSC data stays in document bytes',
            fullJourneyRequestCount: requests.length,
            shellArrivalMethod: 'first-contentful-paint',
            clientWorkMethod: 'CDP Performance.TaskDuration through react-initial-completion-v1, not hydration alone',
          },
        };
      } finally {
        for (const [name, observe] of nativeSubscriptions) cdp.off(name, observe);
        cdp.removeAllListeners();
        networkChanges.removeAllListeners();
      }
      } catch (error) {
        measurementFailed = true;
        measurementError = error;
        throw error;
      } finally {
        try { await native.close(); } catch (cleanupError) {
          if (!measurementFailed) throw cleanupError;
          if (measurementError instanceof Error && measurementError !== cleanupError) {
            try { measurementError.cause ??= cleanupError; } catch {
              console.error('native cleanup failed after measurement failure', cleanupError);
            }
          }
        }
      }
    },
    async measureDev(item, _config, kind) {
      const key = item.runId + item.framework;
      const owned = contexts.get(key);
      const server = devServers.get(key);
      if (!owned || !server) throw new Error(`dev server missing: ${key}`);
      const commands = config.dev[item.framework];
      if (kind === 'cold-ready') {
        return { durationMs: owned.readyMs, event: 'dev-ready',
          ...(owned.environmentHeadroom ? { environmentHeadroom: owned.environmentHeadroom } : {}) };
      }
      const edit = commands.edits[kind];
      if (!(edit?.file || (Array.isArray(edit?.command) && edit.command.length > 0)) || !edit.selector
        || (!edit.expectedText && !edit.expectedStyle)) {
        throw new Error(`missing ${kind} edit stimulus and visibility marker`);
      }
      const { page } = owned;
      if (edit.path) await page.goto(new URL(edit.path, commands.url ?? item.url).href, { waitUntil: 'load' });
      if (item.framework === 'next' && kind === 'react-edit') {
        await page.locator('[data-benchmark-hydrated="true"]').waitFor({ state: 'attached', timeout: 60_000 });
      }
      const reload = edit.reload === true;
      const before = reload || edit.relaunch ? null : await page.locator(edit.selector).first().evaluate((element, expectedStyle) =>
        expectedStyle ? getComputedStyle(element).getPropertyValue(expectedStyle.property) : element.textContent,
      edit.expectedStyle);
      const headroomBefore = config.isolatedRepresentative ? sampleEnvironmentHeadroom() : null;
      const started = performance.now();
      const restarted = edit.restartPattern ? new Promise((accept, reject) => {
        const timeout = setTimeout(() => {
          server.stdout.off('data', observe);
          reject(new Error(`${kind} dev rebuild timeout`));
        }, 60_000);
        const observe = (chunk) => {
          if (!chunk.toString().includes(edit.restartPattern)) return;
          clearTimeout(timeout);
          server.stdout.off('data', observe);
          accept();
        };
        server.stdout.on('data', observe);
      }) : null;
      const visible = edit.explicitReload || edit.relaunch ? null : reload
        ? (restarted ? restarted.then(() => page.reload({ waitUntil: 'load' }))
          : page.waitForEvent('load', { timeout: 60_000 })).then(async () => {
          const element = page.locator(edit.selector);
          await element.waitFor({ state: 'visible', timeout: 60_000 });
          if (edit.expectedText) {
            await element.filter({ hasText: edit.expectedText }).waitFor({ state: 'visible', timeout: 60_000 });
            return;
          }
          const value = await element.evaluate((target, expectedStyle) => expectedStyle
            ? getComputedStyle(target).getPropertyValue(expectedStyle.property) : target.textContent, edit.expectedStyle);
          if (!value?.includes(edit.expectedStyle?.value ?? edit.expectedText)) {
            throw new Error(`${kind} marker not visible after reload`);
          }
        })
        : Promise.any([page.evaluate(({ selector, expectedText, expectedStyle, previous }) => new Promise((resolveVisible, rejectVisible) => {
          const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            const value = element && (expectedStyle
              ? getComputedStyle(element).getPropertyValue(expectedStyle.property) : element.textContent);
            const expected = expectedStyle ? expectedStyle.value : expectedText;
            if (value !== previous && value?.includes(expected)) {
              observer.disconnect();
              clearTimeout(timeout);
              resolveVisible();
            }
          });
          const timeout = setTimeout(() => {
            observer.disconnect();
            rejectVisible(new Error('edit-to-visible event timeout'));
          }, 60_000);
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        }), { selector: edit.selector, expectedText: edit.expectedText, expectedStyle: edit.expectedStyle, previous: before }),
        page.waitForEvent('load', { timeout: 60_000 }).then(async () => {
          const element = page.locator(edit.selector);
          if (edit.expectedText) {
            await element.filter({ hasText: edit.expectedText }).waitFor({ state: 'visible', timeout: 60_000 });
            return;
          }
          await element.waitFor({ state: 'visible', timeout: 60_000 });
          const value = await element.evaluate((target, style) =>
            getComputedStyle(target).getPropertyValue(style.property), edit.expectedStyle);
          if (!value.includes(edit.expectedStyle.value)) throw new Error(`${kind} style absent after reload`);
        })]);
      if (edit.file) {
        const restore = await editSourceFile(edit, commands.cwd ?? resolve(import.meta.dirname, `../apps/${item.framework}`));
        const restores = editsToRestore.get(key) ?? [];
        restores.push(restore);
        editsToRestore.set(key, restores);
      } else {
        const command = spawn(edit.command[0], edit.command.slice(1), { cwd: commands.cwd, stdio: 'ignore' });
        const [code] = await once(command, 'exit');
        if (code !== 0) throw new Error(`${kind} edit command exited ${code}`);
      }
      try {
        if (edit.relaunch) {
          await stopDevServer(server);
          await owned.context.close();
          contexts.delete(key);
          devServers.delete(key);
          const readiness = await this.check(item);
          if (!readiness.pass) throw new Error(`${kind} dev restart failed: ${JSON.stringify(readiness.steps)}`);
          const restartedPage = contexts.get(key).page;
          const marker = restartedPage.locator(edit.selector).first();
          await marker.waitFor({ state: 'visible', timeout: 60_000 });
          if (edit.expectedText) {
            await marker.filter({ hasText: edit.expectedText }).waitFor({ state: 'visible', timeout: 60_000 });
          } else {
            await waitForEditMarker(restartedPage, edit);
          }
        } else if (edit.explicitReload) {
          await page.reload({ waitUntil: 'load' });
          await page.locator(edit.selector).filter({ hasText: edit.expectedText }).waitFor({ state: 'visible', timeout: 60_000 });
        } else {
          await visible;
        }
      } catch (error) {
        const current = await page.locator(edit.selector).first().textContent().catch(() => null);
        const changes = owned.serverLog().split('\n').filter((line) =>
          /vite|error|catalog\.server|reload|GET /iu.test(line)).slice(-12).map((line) => line.slice(0, 300));
        throw new Error(`${kind} visibility failed; current=${JSON.stringify(current?.slice(0, 160))}; devLog=${changes.join(' | ')}`, { cause: error });
      }
      const result = {
        durationMs: performance.now() - started,
        event: `${kind}-visible`,
        method: edit.relaunch ? 'dev-server-relaunch' : edit.restartPattern
          ? 'restart-and-reload' : edit.explicitReload ? 'document-reload' : 'hot-update',
      };
      if (headroomBefore) {
        result.environmentHeadroom = summarizeEnvironmentHeadroom(headroomBefore, sampleEnvironmentHeadroom());
      }
      return result;
    },
    async close() {
      for (const key of new Set([...contexts.keys(), ...editsToRestore.keys()])) await closeDevelopment(key);
      await browser.close();
    },
  };
}
