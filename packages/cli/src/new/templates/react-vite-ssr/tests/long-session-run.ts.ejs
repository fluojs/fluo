import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { acknowledge, faultAt, faults, faultedQR, go, navigation, saveRow, search } from './long-session-helpers';
import { installObserver } from './long-session-observer';
import { browserRSS, resources } from './long-session-metrics';

const example = resolve(import.meta.dirname, '..');
const repo = process.env.FLUO_RELIABILITY_REPO ?? resolve(example, '../..');

/** One real-document workload shared by deterministic correctness and timed soak. */
export async function runLongSession(page: Page, info: TestInfo, durationMs = 0): Promise<void> {
  const seed = Number(process.env.FLUO_RELIABILITY_SEED ?? 3886);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Seed must be a nonnegative safe integer');
  const minimum = Number(process.env.FLUO_RELIABILITY_ACTIONS ?? 1000);
  if (!Number.isSafeInteger(minimum) || minimum < 1000) throw new Error('At least 1000 actions are required');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repo, encoding: 'utf8' }).trim();
  if (dirty !== '') throw new Error('Exact-head runtime evidence requires a clean committed checkout');
  const output = info.outputPath(`reliability-${crypto.randomUUID()}`);
  mkdirSync(output, { recursive: true });
  const trace = resolve(output, 'events.jsonl');
  const started = performance.now();
  let index = 0;
  let sequence = 0;
  let firstFailure: unknown = null;
  let posts = 0;
  let saves = 0;
  const requests = new Set<import('@playwright/test').Request>();
  const event = (phase: string, detail: unknown) => appendFileSync(trace, `${JSON.stringify({
    phase, seed, index, elapsedMs: performance.now() - started, detail,
  })}\n`);
  const requestStarted = (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/__')) requests.add(request);
    if (request.method() === 'POST' && path.startsWith('/catalog/background/queue/')) posts++;
  };
  const idle = new Set<() => void>();
  const requestFinished = (request: import('@playwright/test').Request) => {
    requests.delete(request);
    if (requests.size === 0) for (const signal of idle) signal();
  };
  const error = (failure: Error) => { firstFailure ??= { index, message: failure.message }; event('pageerror', failure.message); };
  const cdp = info.project.use.browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  let baseline: Awaited<ReturnType<typeof resources>> | undefined;
  const operation = async () => {
    const id = await acknowledge(page, ++sequence);
    event('resource-ack', { id, sequence, acknowledgement: `${id}:${sequence}:ack` });
  };
  const act = async (name: string, action: () => Promise<unknown>) => {
    event('action-start', name);
    await action();
    event('action-settled', name);
    index++;
    await operation();
    expect(firstFailure).toBeNull();
  };
  const checkpoint = async (cycle: number) => {
    if (requests.size !== 0) await new Promise<void>((resolveIdle, reject) => {
      const finish = () => { clearTimeout(deadline); idle.delete(finish); resolveIdle(); };
      const deadline = setTimeout(() => {
        idle.delete(finish); reject(new Error('Tracked HTTP requests did not finish'));
      }, 10_000);
      idle.add(finish);
    });
    // UI approval/form settlement precedes this request-scope cleanup subscription.
    const serverResponse = await page.request.get('/__reliability/checkpoint', { timeout: 10_000 });
    expect(serverResponse.ok()).toBe(true);
    const server: unknown = await serverResponse.json();
    const live = await resources(page);
    const heap = cdp === null ? { supported: false, bytes: null, reason: 'No CDP heap API in this engine' }
      : { supported: true, raw: await cdp.send('Runtime.getHeapUsage') };
    event('measurement', { cycle, warmup: cycle < faults.length, live, server, heap,
      browserRSS: await browserRSS(), harness: { pid: process.pid, ...process.memoryUsage(),
        retainedTraceEntries: 0, activeRequestReferences: requests.size },
      gc: 'not-forced', noise: 'raw trend only; no heap/RSS correctness threshold' });
    expect(server).toMatchObject({ requestScopes: 0, cleanupSubscriptions: 0 });
    expect(requests.size).toBe(0);
    expect(live).toMatchObject({ ports: 2, actualInstanceRetained: true, cleanups: 0,
      mounts: 1, unhandled: 0, harnessObservers: 0, pendingInteractions: 0, pendingNavigation: false });
    expect(posts).toBe(saves);
    if (cycle === faults.length - 1) baseline = live;
    if (baseline !== undefined) {
      expect(live.document).toBe(baseline.document);
      expect(live.id).toBe(baseline.id);
      expect(live.globalListeners).toBe(baseline.globalListeners);
      expect(live.sockets).toBe(baseline.sockets);
      expect(live.interactionOwners).toBe(baseline.interactionOwners);
    }
  };
  await installObserver(page);
  if (process.env.FLUO_RELIABILITY_STARTER === '1') await page.addInitScript(() => Reflect.set(window, '__longStarter', true));
  page.on('request', requestStarted);
  page.on('requestfinished', requestFinished);
  page.on('requestfailed', requestFinished);
  page.on('pageerror', error);
  event('start', { head, engine: info.project.name, browserVersion: page.context().browser()?.version(),
    minimum, durationMs, schedule: faults, physicalDevice: 'external-unverified' });
  try {
    await page.goto('/catalog/login', { waitUntil: 'domcontentloaded' });
    await page.goto('/catalog/background', { waitUntil: 'domcontentloaded' });
    await operation();
    const workloadStarted = performance.now();
    // Duration is itself under test. No correctness sleep, polling delay or networkidle.
    for (let cycle = 0; index < minimum + faults.length * 10 || performance.now() - workloadStarted < durationMs; cycle++) {
      const fault = faultAt(seed, cycle);
      event('fault-schedule', { cycle, fault, actionIndex: index });
      await act('QR/fault/recovery', () => faultedQR(page, fault, operation));
      await act('songs', () => go(page, '/admin/songs'));
      await act('history/back/QR', () => navigation(page, '/admin/qr', () => page.goBack({ waitUntil: 'commit' })));
      await act('history/forward/songs', () => navigation(page, '/admin/songs', () => page.goForward({ waitUntil: 'commit' })));
      await act('song page', () => go(page, '/catalog/background'));
      const colors = ['Blue', 'Green', 'Gold'] as const;
      const query = colors[(seed + cycle) % colors.length];
      const widget = colors[(seed + cycle + 1) % colors.length];
      if (query === undefined || widget === undefined) throw new Error('Missing seeded query');
      await act('search', () => search(page, 'song-search', query));
      await act('independent shell widget', () => search(page, 'song-widget', widget));
      await act('real row save', async () => { saves++; await saveRow(page, query.toLowerCase()); });
      await act('departing page/QR', () => go(page, '/admin/qr'));
      await act('return song page', () => go(page, '/catalog/background'));
      await checkpoint(cycle);
    }
    const elapsedMs = performance.now() - workloadStarted;
    expect(index - faults.length * 10).toBeGreaterThanOrEqual(1000);
    expect(elapsedMs).toBeGreaterThanOrEqual(durationMs);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(head);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('');
    event('workload-complete', { index, elapsedMs, posts, saves });
    writeFileSync(resolve(output, 'receipt.json'), `${JSON.stringify({
      version: 1, issue: 3886, head, seed, engine: info.project.name,
      kind: durationMs === 0 ? 'correctness' : 'soak', actionCount: index,
      measuredActionCount: index - faults.length * 10, elapsedMs,
      surface: process.env.FLUO_RELIABILITY_STARTER === '1'
        ? `packaged-${process.env.FLUO_REACT_STARTER_SERVER_COMMAND === 'dev' ? 'dev' : 'production'}`
        : 'official-example-production',
      status: 'passed', eventTrace: 'events.jsonl', firstFailure, physicalDevices: 'external-unverified',
      scope: 'official production example; ownership/cache/native/starter companion receipts also required',
    }, null, 2)}\n`);
  } catch (failure) {
    firstFailure ??= { index, message: failure instanceof Error ? failure.message : String(failure) };
    event('first-failure', firstFailure);
    writeFileSync(resolve(output, 'receipt.json'), `${JSON.stringify({
      version: 1, issue: 3886, head, seed, engine: info.project.name,
      kind: durationMs === 0 ? 'correctness' : 'soak', actionCount: index,
      elapsedMs: performance.now() - started, status: 'failed', firstFailure, eventTrace: 'events.jsonl',
    }, null, 2)}\n`);
    throw failure;
  } finally {
    await cdp?.detach();
    page.off('request', requestStarted); page.off('requestfinished', requestFinished);
    page.off('requestfailed', requestFinished); page.off('pageerror', error);
    await info.attach('reliability-receipt', { path: resolve(output, 'receipt.json'), contentType: 'application/json' });
    await info.attach('reliability-events', { path: trace, contentType: 'application/x-ndjson' });
  }
}
