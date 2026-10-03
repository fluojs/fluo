import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NATIVE_TERMINAL_METHOD = 'chromium-netlog-cancellation-v1';

const identity = (source) => `${source.type}:${source.id}:${source.start_time}`;

export function reconcileNativeTerminals(requests, log, provenance, cdpLedger = []) {
  const types = log.constants?.logEventTypes;
  const phases = log.constants?.logEventPhase;
  const sourceType = log.constants?.logSourceType?.URL_REQUEST;
  if (!types || !phases || sourceType === undefined
    || !Number.isFinite(provenance.captureTimestamp)) return requests;
  const sources = new Map();
  for (const [index, event] of log.events.entries()) {
    if (event.source?.type !== sourceType || !Number.isSafeInteger(event.source.id)
      || !Number.isFinite(Number(event.source.start_time))) continue;
    const key = identity(event.source);
    const entries = sources.get(key) ?? [];
    entries.push({ ...event, index });
    sources.set(key, entries);
  }
  const chains = [...sources.values()].map((entries) => {
    const starts = entries.filter((entry) => entry.type === types.URL_REQUEST_START_JOB
      && entry.phase === phases.PHASE_BEGIN);
    return { entries, starts };
  });
  // Renderer dispatch and native requestTime can cross a millisecond boundary.
  // Use the exact network-service clock when its retained ExtraInfo is unique;
  // do not widen the matching window or choose the nearest repeated URL.
  const clocks = requests.map((request) => {
    const extras = cdpLedger.filter((entry) => entry.name === 'Network.requestWillBeSentExtraInfo'
      && entry.data?.requestId === request.requestId);
    if (extras.length > 1) return undefined;
    if (extras.length === 0) return { source: 'Network.requestWillBeSent', timestamp: request.startedTimestamp };
    const timestamp = extras[0].data.connectTiming?.requestTime;
    if (!Number.isFinite(timestamp) || !Number.isFinite(request.startedTimestamp)
      || timestamp < request.startedTimestamp) return undefined;
    return { source: 'Network.requestWillBeSentExtraInfo.connectTiming.requestTime',
      timestamp, observation: extras[0] };
  });
  const candidates = requests.map((request, index) => chains.filter(({ starts }) =>
    Number.isFinite(clocks[index]?.timestamp) && starts.some((start) =>
      start.params?.url === request.url && start.params?.method === request.method
      && (Number(start.source.start_time) === Math.floor(clocks[index].timestamp * 1000)
        || clocks[index].source !== 'Network.requestWillBeSent'
          && Number(start.time) === Math.floor(clocks[index].timestamp * 1000)))));
  return requests.map((request, index) => {
    if (request.kind !== 'request-pending' || candidates[index].length !== 1) return request;
    const chain = candidates[index][0];
    if (chain.starts.length !== 1 || candidates.filter((matches) => matches.includes(chain)).length !== 1) return request;
    const { entries, starts: [start] } = chain;
    const begins = entries.filter((entry) => entry.type === types.REQUEST_ALIVE
      && entry.phase === phases.PHASE_BEGIN);
    const cancellations = entries.filter((entry) => entry.type === types.CANCELLED
      && entry.phase === phases.PHASE_NONE);
    const ends = entries.filter((entry) => entry.type === types.REQUEST_ALIVE
      && entry.phase === phases.PHASE_END);
    const controllers = entries.filter((entry) => entry.type === types.HTTP_STREAM_JOB_CONTROLLER_BOUND
      && entry.phase === phases.PHASE_NONE && entry.params?.source_dependency);
    const bindings = controllers.length ? controllers
      : entries.filter((entry) => entry.type === types.HTTP_STREAM_REQUEST_BOUND_TO_JOB
      && entry.phase === phases.PHASE_NONE && entry.params?.source_dependency);
    if (begins.length !== 1 || cancellations.length !== 1 || ends.length !== 1 || bindings.length !== 1) return request;
    const [begin] = begins;
    const [cancellation] = cancellations;
    const [end] = ends;
    const [binding] = bindings;
    const dependency = binding.params.source_dependency;
    const reciprocals = log.events.map((event, eventIndex) => ({ ...event, index: eventIndex }))
      .filter((event) => event.type === (controllers.length
        ? types.HTTP_STREAM_JOB_CONTROLLER_BOUND : types.HTTP_STREAM_JOB_BOUND_TO_REQUEST)
        && event.phase === phases.PHASE_NONE && event.source?.id === dependency.id
        && event.source.type === dependency.type
        && event.params?.source_dependency?.id === start.source.id
        && event.params?.source_dependency?.type === start.source.type);
    if (reciprocals.length !== 1) return request;
    const [reciprocal] = reciprocals;
    const ordered = [begin, start, binding, reciprocal, cancellation, end];
    if (!Number.isFinite(Number(reciprocal.source.start_time))
      || Number(begin.time) < Number(start.source.start_time)
      || ordered.some((event, position) => !Number.isFinite(Number(event.time))
      || (position > 0 && (event.index < ordered[position - 1].index
        || Number(event.time) < Number(ordered[position - 1].time))))
      || Number(end.time) >= provenance.captureTimestamp * 1000) return request;
    const { unavailable: _pendingReason, ...observed } = request;
    return {
      ...observed, kind: 'request-failed', error: 'native NetLog CANCELLED', canceled: true,
      cdpObservation: request,
      nativeTerminal: { method: NATIVE_TERMINAL_METHOD, ...provenance, requestClock: clocks[index],
        source: start.source, begin, start, binding, reciprocal, cancellation, end },
    };
  });
}

export async function createNativeCapture(chromium, directory, lifetimeOptions) {
  await mkdir(directory ?? tmpdir(), { recursive: true });
  const captureRoot = await mkdtemp(join(directory ?? tmpdir(), 'native-terminal-'));
  const rawTrace = join(captureRoot, 'network.json');
  const cdpTrace = join(captureRoot, 'cdp.json');
  const server = await chromium.launchServer({
    headless: true, timeout: 10_000,
    args: [`--log-net-log=${rawTrace}`, '--net-log-capture-mode=Everything'],
  });
  const child = server.process();
  const ledger = [];
  const lifecycle = [];
  let processError;
  let exitResolve;
  const exited = new Promise((accept) => { exitResolve = accept; });
  const onExit = (code, signal) => {
    lifecycle.push({ event: 'exit', code, signal });
    exitResolve();
  };
  const onError = (error) => {
    processError = error;
    lifecycle.push({ event: 'error', error: String(error) });
    exitResolve();
  };
  const onDisconnected = () => { lifecycle.push({ event: 'disconnected' }); };
  child.on('exit', onExit);
  child.on('error', onError);
  if (child.exitCode !== null || child.signalCode !== null) onExit(child.exitCode, child.signalCode);
  let browser;
  let closing;
  let lifetime;
  let lifetimeEvidence;
  let captureTimestamp;
  const close = () => {
    closing ??= (async () => {
      let timer;
      let closeError;
      let forcedKill = false;
      try {
        // Drain buffered hooks while the renderer is still alive, after the
        // driver's throughput and ps samples, using only the original cutoff.
        if (lifetime) lifetimeEvidence = await lifetime.drain(captureTimestamp, ledger);
        if (lifetime) await lifetime.beginClose();
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('native capture graceful-close deadline')), 10_000);
        });
        await Promise.race([(async () => { await server.close(); await exited; })(), deadline]);
      } catch (error) {
        closeError = error;
        if (child.exitCode === null && child.signalCode === null) {
          forcedKill = true;
          try {
            await server.kill();
            let killTimer;
            try {
              await Promise.race([exited, new Promise((_, reject) => {
                killTimer = setTimeout(() => reject(new Error('native browser kill-exit deadline')), 5_000);
              })]);
            } finally { clearTimeout(killTimer); }
          } catch (killError) { lifecycle.push({ event: 'kill-error', error: String(killError) }); }
        }
      } finally {
        clearTimeout(timer);
        try { await browser?.close(); } catch (error) { closeError ??= error; }
        if (lifetime) {
          try {
            await lifetime.close({ pid: child.pid, exitCode: child.exitCode,
              signal: child.signalCode, forcedKill });
            lifetimeEvidence = await lifetime.drain(captureTimestamp, ledger);
          } catch (error) { closeError ??= error; }
        }
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        browser?.removeListener('disconnected', onDisconnected);
        const cleanup = { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
          closed: child.exitCode !== null || child.signalCode !== null };
        await writeFile(cdpTrace, `${JSON.stringify({ method: NATIVE_TERMINAL_METHOD, ledger,
          cleanup, lifecycle, ownedLifecycle: lifetimeEvidence?.observation.lifecycle ?? [] }, null, 2)}\n`);
      }
      const abnormal = lifetimeEvidence?.observation.lifecycle.find((entry) =>
        entry.event === 'owned-exit' && entry.exitCodeRaw !== null && entry.exitCodeRaw !== 0
        && !lifetime.isObservedShutdownExit(entry, lifetimeEvidence.observation));
      if (processError) closeError ??= processError;
      if (!forcedKill && (child.signalCode !== null || child.exitCode !== null && child.exitCode !== 0)) {
        closeError = new Error(`native browser abnormal exit: ${child.exitCode}/${child.signalCode}`);
      } else if (abnormal) {
        closeError ??= new Error(`native owned process abnormal exit: ${abnormal.pid}/${abnormal.exitCodeRaw}`);
      }
      if (closeError) throw closeError;
      if (child.exitCode === null && child.signalCode === null) throw new Error('native browser process still live');
    })();
    return closing;
  };
  try {
    browser = await chromium.connect(server.wsEndpoint(), { timeout: 10_000 });
    browser.on('disconnected', onDisconnected);
    if (lifetimeOptions?.enabled) {
      const { createNativeLifetimeObserver } = await import('./native-lifetime.mjs');
      lifetime = await createNativeLifetimeObserver({ ...lifetimeOptions, directory: captureRoot });
    }
  } catch (error) {
    await close().catch((cleanupError) => { error.cause ??= cleanupError; });
    throw error;
  }
  return {
    browser, ledger, close,
    get lifetimeIdentity() { return lifetime?.identity; },
    async prepareLifetime(cdp) { await lifetime?.prepare(browser, child.pid, cdp); },
    async captureClock(readMetrics) {
      return lifetime ? lifetime.captureClock(readMetrics) : readMetrics();
    },
    async read(timestamp) {
      captureTimestamp = timestamp;
      await close();
      const raw = await readFile(rawTrace);
      const log = JSON.parse(raw);
      if (!Array.isArray(log.events) || !log.events.length || !log.constants) {
        throw new Error('incomplete native NetLog');
      }
      return { log, lifetime: lifetimeEvidence, provenance: {
        method: NATIVE_TERMINAL_METHOD, rawTrace,
        sha256: createHash('sha256').update(raw).digest('hex'),
        cdpTrace, cdpSha256: createHash('sha256').update(await readFile(cdpTrace)).digest('hex'),
        captureTimestamp, browserVersion: browser.version(),
        clock: 'Chromium TimeTicks: NetLog integer milliseconds, CDP MonotonicTime seconds; exact unique native requestTime tick, or renderer tick without ExtraInfo',
        logging: 'passive startup NetLog Everything; disk/CPU/memory overhead included, not measured separately',
        cleanup: { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, closed: true },
      } };
    },
  };
}
