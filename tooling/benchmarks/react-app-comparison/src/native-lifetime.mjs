import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const NATIVE_LIFETIME_METHOD = 'chromium-native-lifetime-v1';
export const NATIVE_LIFETIME_IDENTITY = Object.freeze({
  platform: 'linux', arch: 'arm64', browserVersion: '149.0.7827.0', revision: '1228',
  binarySha256: 'b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4',
  buildId: 'afcd146a627911fb30269f995d093903636ed886', abi: 'ELF64-LE-AArch64',
});
export const NATIVE_LIFETIME_RUNTIME = Object.freeze({
  pythonVersion: '3.11.2', pythonSha256: '304aa87a76ebb13fd22d253ac157f14980ff2cdb23e6274f3b045571405e07dc',
  fridaVersion: '17.21.0', fridaFiles: {
    '__init__.py': '9e0a5fe4cb0148194f23cf208d5a5479d76979032a1a401154b352250e699aae',
    'aio.py': '954124b4cb82abfb52b8d3b61a094ba39f75c52617d9f57f01c95faee4343f4e',
    '_frida.abi3.so': '24bda14795eb6f384511cd1a5ac1663d6030fb0c46ecc708b11358abbb652e40',
  },
});
export const NATIVE_LIFETIME_HOOKS = Object.freeze([
  { event: 'resource', offset: 0x6002210, symbol: '_ZN5blink8ResourceC2ERKNS_19ResourceRequestHeadENS_12ResourceTypeERKNS_21ResourceLoaderOptionsE' },
  { event: 'loader', offset: 0x400ea54, symbol: '_ZN5blink14ResourceLoaderC1EPNS_15ResourceFetcherEPNS_21ResourceLoadSchedulerEPNS_8ResourceEPNS_24ContextLifecycleNotifierENS_19ResourceRequestBodyEj' },
  { event: 'observer', offset: 0x854802c, symbol: '_ZN5blink28ResourceLoadObserverForFrame15WillSendRequestERKNS_15ResourceRequestERKNS_16ResourceResponseENS_12ResourceTypeERKNS_21ResourceLoaderOptionsENS_22RenderBlockingBehaviorEPKNS_8ResourceE' },
  { event: 'identifier', offset: 0x5ee0eac, symbol: '_ZN5blink18IdentifiersFactory9RequestIdEPNS_14DocumentLoaderEm' },
  { event: 'identifier', offset: 0x829a5c4, symbol: '_ZN5blink18IdentifiersFactory9RequestIdEPNS_16ExecutionContextEm' },
  { event: 'cancel', offset: 0x400f87c, symbol: '_ZN5blink14ResourceLoader6CancelEv' },
  { event: 'error', offset: 0x400ff50, symbol: '_ZN5blink14ResourceLoader11HandleErrorERKNS_13ResourceErrorE' },
]);
export const NATIVE_SHUTDOWN_HOOKS = Object.freeze([
  { event: 'normal', offset: 0x3b4bbf0, symbol: '_ZN7content8internal26ChildProcessLauncherHelper33ForceNormalProcessTerminationSyncENS1_7ProcessE' },
  { event: 'terminate', offset: 0x41704ec, symbol: '_ZNK4base7Process17TerminateInternalEib' },
]);
const digest = (raw) => createHash('sha256').update(raw).digest('hex');
export const NATIVE_LIFETIME_SCHEMA = digest(JSON.stringify({
  version: 1, identity: NATIVE_LIFETIME_IDENTITY, hooks: NATIVE_LIFETIME_HOOKS,
  shutdownHooks: NATIVE_SHUTDOWN_HOOKS,
  arguments: { resource: 0, loader: 0, loaderResource: 3, observerResource: 6, identifier: 1 },
  clock: 'CLOCK_MONOTONIC nanoseconds', returns: 'Frida onLeave normal',
}));
const ns = (value) => typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
const cutoffNs = (timestamp) => Number.isFinite(timestamp) && timestamp > 0
  ? BigInt(Math.floor(timestamp * 1e9)) : null;

export function isObservedShutdownExit(exit, observation) {
  if (exit.exitCodeRaw !== 15 || exit.missing !== false) return false;
  const lifecycle = observation.lifecycle ?? [];
  const closes = lifecycle.filter((e) => e.event === 'graceful-close');
  const results = lifecycle.filter((e) => e.event === 'browser-result');
  if (closes.length !== 1 || results.length !== 1) return false;
  const close = closes[0];
  const result = results[0];
  if (result.pid !== close.pid || result.exitCode !== 0 || result.signal !== null || result.forcedKill !== false
    || ns(close.ns) === null || cutoffNs(observation.captureTimestamp) === null
    || ns(close.ns) <= cutoffNs(observation.captureTimestamp) || ns(exit.ns) === null) return false;
  const attached = (pid, processBirth) => lifecycle.filter((e) => e.event === 'owned-attach'
    && e.pid === pid && e.processBirth === processBirth
    && e.binarySha256 === NATIVE_LIFETIME_IDENTITY.binarySha256).length === 1;
  if (!attached(close.pid, close.processBirth) || !attached(exit.pid, exit.processBirth)) return false;
  const events = lifecycle.filter((e) => e.event.startsWith('shutdown-'));
  if (!events.length || events[0].event !== 'shutdown-ready' || ns(events[0].ns) === null
    || ns(events[0].ns) >= ns(close.ns)
    || events.some((e, i) => e.pid !== close.pid || e.processBirth !== close.processBirth
      || e.runId !== observation.runId || e.seq !== i + 1 || ns(e.ns) === null
      || i > 0 && ns(e.ns) < ns(events[i - 1].ns))) return false;
  return events.some((signal) => {
    if (signal.event !== 'shutdown-signal-enter' || signal.signal !== 15
      || signal.target?.pid !== exit.pid
      || exit.processBirth.slice(0, exit.processBirth.lastIndexOf(':')) !== signal.target.processBirth
      || !['R', 'S', 'D', 'T', 't', 'I'].includes(signal.target.state)) return false;
    const unique = (event, call) => {
      const matches = events.filter((e) => e.event === event && e.call === call && e.thread === signal.thread);
      return matches.length === 1 ? matches[0] : undefined;
    };
    const returned = unique('shutdown-signal-return', signal.call);
    const terminate = unique('shutdown-terminate-enter', signal.parent);
    const terminated = unique('shutdown-terminate-return', signal.parent);
    const normal = terminate && unique('shutdown-normal-enter', terminate.parent);
    const normalized = terminate && unique('shutdown-normal-return', terminate.parent);
    if (!returned || !terminate || !terminated || !normal || !normalized
      || returned.result !== 0 || returned.signal !== 15 || returned.parent !== signal.parent
      || !isDeepStrictEqual(returned.target, signal.target)
      || terminate.exitCode !== 0 || terminate.wait !== 0 || terminated.result !== 1
      || terminated.parent !== terminate.parent || terminated.exitCode !== 0 || terminated.wait !== 0
      || normal.parent !== null || normalized.parent !== null) return false;
    const ordered = [normal, terminate, signal, returned, terminated, normalized];
    return ns(close.ns) < ns(normal.ns) && ns(returned.ns) < ns(exit.ns)
      && ordered.every((e, i) => i === 0 || e.seq > ordered[i - 1].seq && ns(e.ns) >= ns(ordered[i - 1].ns));
  });
}

// No nearest time, URL, teardown, pointer absence or GC inference is admissible.
// Any ambiguity affects the run verdict even when another request can reconcile.
export function reconcileNativeLifetime(requests, observation, ledger = []) {
  const unavailable = [];
  const fail = (reason) => ({ requests, unavailable: [`native lifetime: ${reason}`] });
  if (!observation || observation.schemaVersion !== 1 || observation.method !== NATIVE_LIFETIME_METHOD
    || observation.schema !== NATIVE_LIFETIME_SCHEMA || !observation.runId
    || !isDeepStrictEqual(observation.identity, NATIVE_LIFETIME_IDENTITY)) return fail('unsupported identity/schema');
  if (!observation.runtime || Object.entries(NATIVE_LIFETIME_RUNTIME)
    .some(([key, value]) => !isDeepStrictEqual(observation.runtime[key], value))) return fail('external runtime identity mismatch');
  if (observation.lifecycle?.some((entry) => entry.event === 'owned-exit'
    && entry.exitCodeRaw !== null && entry.exitCodeRaw !== 0
    && !isObservedShutdownExit(entry, observation))) return fail('owned process abnormal exit');
  const cutoff = cutoffNs(observation.captureTimestamp);
  const clock = observation.clock;
  const coverage = observation.coverage;
  if (coverage?.ready !== true || coverage.complete !== true || coverage.drained !== true || coverage.dropped !== 0
    || !Array.isArray(coverage.errors) || coverage.errors.length || !coverage.targetId || !coverage.sessionId
    || !Array.isArray(coverage.processes) || !coverage.processes.length
    || !Array.isArray(observation.events) || !observation.events.length
    || observation.cleanup?.closed !== true || observation.cleanup.detached !== true
    || observation.cleanup.exitCode !== 0 || observation.cleanup.signal !== null) return fail('incomplete coverage/drain/cleanup');
  if (cutoff === null || clock?.native !== 'CLOCK_MONOTONIC' || clock.unit !== 'nanoseconds'
    || clock.cdp !== 'Chromium TimeTicks seconds' || ns(clock.beforeNs) === null || ns(clock.afterNs) === null
    || ns(clock.beforeNs) > cutoff || ns(clock.afterNs) < cutoff) return fail('unverified capture clock');
  const processes = coverage.processes.filter((process) => process.role === 'renderer');
  if (!processes.length || processes.some((process) => !Number.isSafeInteger(process.pid) || process.pid < 1
    || typeof process.processBirth !== 'string' || !process.processBirth.startsWith(`${process.pid}:`)
    || process.authenticated !== true || process.hooks !== NATIVE_LIFETIME_HOOKS.length
    || process.binarySha256 !== NATIVE_LIFETIME_IDENTITY.binarySha256
    || process.buildId !== NATIVE_LIFETIME_IDENTITY.buildId
    || !isAbsolute(process.executedPath ?? '') || process.executedPath !== process.loadedPath
    || ns(process.readyNs) === null || ns(process.endNs) === null
    || ns(process.readyNs) >= cutoff || ns(process.endNs) < cutoff)
    || new Set(processes.map((process) => process.pid)).size !== processes.length
    || new Set(processes.map((process) => process.processBirth)).size !== processes.length) return fail('process identity/coverage conflict');
  const events = observation.events;
  const eventNames = ['hooks-ready', 'resource-birth', 'loader-birth', 'identifier',
    'cancel-enter', 'error-enter', 'error-return', 'cancel-return'];
  if (events.some((event) => !eventNames.includes(event.event))) return fail('unknown native event schema');
  for (const process of processes) {
    const entries = events.filter((event) => event.processBirth === process.processBirth);
    if (!entries.length || entries[0].event !== 'hooks-ready'
      || entries[0].hooks !== NATIVE_LIFETIME_HOOKS.length
      || entries.some((event, index) => event.pid !== process.pid || ns(event.ns) === null
        || event.runId !== observation.runId || event.seq !== index + 1
        || ns(event.ns) < ns(process.readyNs)
        || (index > 0 && ns(event.ns) < ns(entries[index - 1].ns)))) return fail('event sequence/process/clock conflict');
  }
  if (events.some((event) => !processes.some((process) => process.processBirth === event.processBirth))) {
    return fail('uncovered event process');
  }
  const resourceKey = (event) => `${event.processBirth}:${event.resource}:${event.resourceBirth}`;
  const loaderKey = (event) => `${event.processBirth}:${event.loader}:${event.loaderBirth}`;
  const resources = events.filter((event) => event.event === 'resource-birth');
  const loaders = events.filter((event) => event.event === 'loader-birth');
  const validBirth = (event, field) => /^0x[1-9a-f][0-9a-f]*$/u.test(event[field] ?? '')
    && Number.isSafeInteger(event[`${field}Birth`]) && event[`${field}Birth`] > 0;
  if (resources.some((event) => !validBirth(event, 'resource'))
    || loaders.some((event) => !validBirth(event, 'loader') || !validBirth(event, 'resource'))
    || new Set(resources.map(resourceKey)).size !== resources.length
    || new Set(loaders.map(loaderKey)).size !== loaders.length) return fail('invalid object birth identities');
  const ids = events.filter((event) => event.event === 'identifier');
  if (!ids.length || ids.some((event) => !validBirth(event, 'resource')
    || !/^[1-9][0-9]*$/u.test(event.identifier ?? '')
    || resources.filter((resource) => resourceKey(resource) === resourceKey(event)
      && resource.seq < event.seq).length !== 1)) return fail('missing/conflicting request identity coverage');
  const candidates = requests.map((request) => {
    const match = /^([1-9][0-9]*)\.([1-9][0-9]*)$/u.exec(request.requestId ?? '');
    if (!match) return [];
    return resources.filter((resource) => resource.pid === Number(match[1]) && ids.some((event) =>
      resourceKey(event) === resourceKey(resource) && event.identifier === match[2]));
  });
  const reconciled = requests.map((request, index) => {
    if (candidates[index].length === 0) return request;
    // A settled cache hit may legitimately reuse the same Resource with a new
    // inspector ID. Without any native Cancel evidence there is no terminal
    // to reconcile or contradict; pending consumers still require uniqueness.
    if (request.kind !== 'request-pending' && !candidates[index].some((resource) =>
      events.some((event) => event.event === 'cancel-enter' && resourceKey(event) === resourceKey(resource)))) return request;
    const conflict = (reason) => { unavailable.push(`native lifetime: ${request.requestId}: ${reason}`); return request; };
    if (candidates[index].length !== 1) return conflict('ambiguous Resource lifetime');
    const resource = candidates[index][0];
    const process = processes.find((entry) => entry.processBirth === resource.processBirth);
    const sent = ledger.filter((entry) => entry.name === 'Network.requestWillBeSent'
      && entry.data?.requestId === request.requestId);
    if (request.targetId !== coverage.targetId || request.sessionId !== coverage.sessionId
      || request.occurrence !== 1 || sent.length !== 1 || sent[0].targetId !== request.targetId
      || sent[0].sessionId !== request.sessionId || sent[0].data.redirectResponse
      || sent[0].data.frameId !== request.frameId || sent[0].data.loaderId !== request.loaderId
      || sent[0].data.timestamp !== request.startedTimestamp || !Number.isFinite(request.startedTimestamp)
      || ns(process.readyNs) >= cutoffNs(request.startedTimestamp)
      || candidates.filter((matches) => matches.includes(resource)).length !== 1) return conflict('CDP occurrence/session/process ambiguity');
    const identifiers = ids.filter((event) => resourceKey(event) === resourceKey(resource));
    if (identifiers.some((event) => event.identifier !== request.requestId.split('.')[1]
      || event.seq <= resource.seq || !Number.isSafeInteger(event.observerCall))) return conflict('identifier conflict');
    const bindings = loaders.filter((event) => resourceKey(event) === resourceKey(resource));
    if (bindings.length !== 1 || bindings[0].seq <= resource.seq) return conflict('ambiguous Loader lifetime');
    const loader = bindings[0];
    const chain = events.filter((event) => loaderKey(event) === loaderKey(loader)
      && ['cancel-enter', 'error-enter', 'error-return', 'cancel-return'].includes(event.event));
    if (!chain.length) return request;
    const terminals = [];
    for (const cancel of chain.filter((event) => event.event === 'cancel-enter')) {
      const errors = chain.filter((event) => event.event === 'error-enter' && event.parent === cancel.call
        && event.thread === cancel.thread);
      const returns = chain.filter((event) => event.event === 'cancel-return' && event.call === cancel.call);
      if (errors.length !== 1 || returns.length !== 1) continue;
      const error = errors[0];
      const errorReturns = chain.filter((event) => event.event === 'error-return' && event.call === error.call);
      if (errorReturns.length !== 1) continue;
      const ordered = [cancel, error, errorReturns[0], returns[0]];
      if (ordered.some((event, position) => resourceKey(event) !== resourceKey(resource)
        || event.seq <= loader.seq || !Number.isSafeInteger(event.call) || event.call < 1
        || !Number.isSafeInteger(event.thread) || event.thread < 1
        || event.thread !== cancel.thread
        || ns(event.ns) >= cutoff || (position > 0 && event.seq <= ordered[position - 1].seq))
        || cancel.parent !== null || error.call === cancel.call || errorReturns[0].parent !== cancel.call
        || returns[0].parent !== cancel.parent || errorReturns[0].normal !== true || returns[0].normal !== true) continue;
      // Another nested Cancel or same-call entry would make onLeave attribution ambiguous.
      if (chain.some((event) => event.event === 'cancel-enter' && event !== cancel
        && event.thread === cancel.thread && event.seq > cancel.seq && event.seq < returns[0].seq)
        || chain.filter((event) => event.call === error.call).length !== 2
        || chain.filter((event) => event.call === cancel.call).length !== 2) continue;
      terminals.push(ordered);
    }
    if (terminals.length !== 1) return conflict('incomplete/conflicting cancellation return chain');
    if (request.kind !== 'request-pending') {
      if (!request.canceled || request.kind !== 'request-failed') return conflict('native/CDP terminal conflict');
      return request;
    }
    const { unavailable: _pending, ...observed } = request;
    return { ...observed, kind: 'request-failed', error: 'native ResourceLoader Cancel/HandleError normal return',
      canceled: true, cdpObservation: request, nativeLifetime: {
        method: NATIVE_LIFETIME_METHOD, runId: observation.runId, schema: observation.schema,
        captureTimestamp: observation.captureTimestamp, resource, loader, identifiers, chain: terminals[0],
      } };
  });
  return { requests: reconciled, unavailable: [...new Set(unavailable)] };
}

export async function createNativeLifetimeObserver(options) {
  if (!options?.enabled) return null;
  const runId = randomUUID();
  const errors = [];
  const processes = [];
  const events = [];
  const directory = options.directory;
  const rawTrace = resolve(directory, 'lifetime.json');
  const logTrace = resolve(directory, 'lifetime-host.json');
  const schemaTrace = resolve(directory, 'lifetime-schema.json');
  const agentPath = fileURLToPath(new URL('./native-lifetime-agent.js', import.meta.url));
  const hostPath = fileURLToPath(new URL('./native-lifetime-host.py', import.meta.url));
  const agentSha256 = digest(await readFile(agentPath));
  const hostSha256 = digest(await readFile(hostPath));
  const schema = { schemaVersion: 1, method: NATIVE_LIFETIME_METHOD, schema: NATIVE_LIFETIME_SCHEMA,
    runId, identity: NATIVE_LIFETIME_IDENTITY, hooks: NATIVE_LIFETIME_HOOKS, shutdownHooks: NATIVE_SHUTDOWN_HOOKS,
    agentSha256, hostSha256, measurement: options.measurement ?? null };
  await writeFile(schemaTrace, `${JSON.stringify(schema, null, 2)}\n`);
  let host;
  let lines;
  let exit;
  let stderr = '';
  const messages = [];
  const pending = new Map();
  let serial = 0;
  let closePromise;
  let drained = false;
  let released = false;
  let ready = false;
  let targetId;
  let sessionId;
  let clock;
  let runtime;
  let coverageEnd;
  let browserCdp;
  let cleanup = { closed: false, detached: false, exitCode: null, signal: null };
  const rejectPending = (error) => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  };
  const command = (name, fields = {}) => new Promise((accept, reject) => {
    if (!host || host.exitCode !== null || host.signalCode !== null || !host.stdin.writable) {
      reject(new Error('native host unavailable')); return;
    }
    const id = ++serial;
    const timer = setTimeout(() => {
      pending.delete(id); reject(new Error(`native ${name} deadline`));
    }, options.timeoutMs ?? 10_000);
    pending.set(id, { accept, reject, timer });
    host.stdin.write(`${JSON.stringify({ id, command: name, ...fields })}\n`);
  });
  const close = (browserResult) => closePromise ??= (async () => {
    if (host) {
      try {
        const reply = await command('close', { browserResult });
        cleanup.detached = reply.detached === true;
      } catch (error) { errors.push(String(error)); }
      host.stdin.end();
      let timer;
      const timeout = new Promise((accept) => {
        timer = setTimeout(() => { errors.push('native cleanup deadline'); host.kill('SIGKILL'); accept(null); },
          options.timeoutMs ?? 10_000);
      });
      await Promise.race([exit, timeout]);
      clearTimeout(timer);
      // SIGKILL is sent only to the observer child we spawned. Its exit event,
      // not a signal request, establishes that cleanup actually completed.
      let killTimer;
      const result = await Promise.race([exit, new Promise((accept) => {
        killTimer = setTimeout(() => accept({ code: null, signal: null, live: true }), 5_000);
      })]);
      clearTimeout(killTimer);
      if (result.live) errors.push('native observer still live after SIGKILL deadline');
      cleanup = { ...cleanup, pid: host.pid ?? null, closed: !result.live,
        exitCode: result.code, signal: result.signal };
      lines?.close();
      lines?.removeAllListeners('line');
      host.stderr.removeAllListeners('data');
      host.removeAllListeners('error');
      host.removeAllListeners('exit');
    } else cleanup = { closed: true, detached: false, exitCode: null, signal: null };
    rejectPending(new Error('native observer closed'));
    await browserCdp?.detach().catch((error) => { errors.push(String(error)); });
    await writeFile(logTrace, `${JSON.stringify({ schemaVersion: 1, runId, messages, stderr, errors, cleanup }, null, 2)}\n`);
    options.signal?.removeEventListener('abort', abort);
  })();
  const abort = () => { errors.push('native observation aborted'); void close(); };
  return {
    runId, close, isObservedShutdownExit,
    async beginClose() { if (ready && released && !closePromise) await command('begin-close'); },
    get identity() { return { targetId, sessionId }; },
    async prepare(browser, browserPid, cdp) {
      try {
        if (process.platform !== 'linux' || process.arch !== 'arm64') throw new Error('unsupported native lifetime OS/architecture');
        if (!options.python || !isAbsolute(options.python)) throw new Error('explicit absolute nativeLifetime.python required');
        if (browser.version() !== NATIVE_LIFETIME_IDENTITY.browserVersion) throw new Error('unsupported browser version');
        host = (options.spawn ?? spawn)(options.python, [hostPath, agentPath], { stdio: ['pipe', 'pipe', 'pipe'] });
        exit = new Promise((accept) => {
          host.once('exit', (code, signal) => { rejectPending(new Error(`native host exit ${code}/${signal}`)); accept({ code, signal }); });
          host.once('error', (error) => { errors.push(String(error)); rejectPending(error); accept({ code: null, signal: null }); });
        });
        host.stderr.on('data', (chunk) => { stderr += chunk; });
        lines = createInterface({ input: host.stdout });
        lines.on('line', (line) => {
          let reply;
          try { reply = JSON.parse(line); } catch { errors.push('malformed native host output'); return; }
          messages.push(reply);
          if (reply.error) errors.push(reply.error);
          if (reply.process) processes.push({ ...reply.process });
          if (reply.processRole) {
            const process = processes.find((entry) => entry.pid === reply.processRole.pid);
            if (process) process.role = reply.processRole.role;
            else errors.push('unbound process role update');
          }
          if (reply.events) for (const event of reply.events) events.push(event);
          const waiter = pending.get(reply.id);
          if (waiter) {
            clearTimeout(waiter.timer); pending.delete(reply.id);
            if (reply.error) waiter.reject(new Error(reply.error)); else waiter.accept(reply);
          }
        });
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) throw new Error('native observation aborted before readiness');
        browserCdp = await browser.newBrowserCDPSession();
        {
          const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
          const { targetInfo } = await cdp.send('Target.getTargetInfo');
          targetId = targetInfo.targetId;
          sessionId = randomUUID();
          const reply = await command('prepare', { schema, browserPid,
            rendererPids: processInfo.filter((entry) => entry.type === 'renderer').map((entry) => entry.id) });
          runtime = reply.runtime;
          ready = true;
        }
      } catch (error) {
        errors.push(String(error));
        await close();
      }
    },
    async captureClock(readMetrics) {
      if (!ready || errors.length) return readMetrics();
      try {
        const before = await command('clock');
        const result = await readMetrics();
        const after = await command('clock');
        clock = { native: 'CLOCK_MONOTONIC', unit: 'nanoseconds', cdp: 'Chromium TimeTicks seconds',
          beforeNs: before.ns, afterNs: after.ns };
        return result;
      } catch (error) { errors.push(String(error)); return readMetrics(); }
    },
    async drain(captureTimestamp, ledger) {
      if (ready && !closePromise && !released) {
        try {
          const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
          const { targetInfos } = await browserCdp.send('Target.getTargets');
          if (targetInfos.some((entry) => ['worker', 'service_worker', 'shared_worker'].includes(entry.type))) {
            errors.push('worker target native lifetime coverage unsupported');
          }
          const reply = await command('drain', {
            rendererPids: processInfo.filter((entry) => entry.type === 'renderer').map((entry) => entry.id),
          });
          drained = reply.drained === true;
          coverageEnd = reply.ns;
        } catch (error) { errors.push(String(error)); }
        try {
          const reply = await command('release');
          cleanup.detached = reply.detached === true;
        } catch (error) { errors.push(String(error)); }
        released = true;
        await browserCdp?.detach().catch((error) => { errors.push(String(error)); });
        browserCdp = undefined;
      }
      // Exit subscriptions and the Python host stay owned until BrowserServer
      // terminates. The caller then closes and replays this same cutoff/ledger.
      await writeFile(logTrace, `${JSON.stringify({ schemaVersion: 1, runId, messages, stderr, errors, cleanup }, null, 2)}\n`);
      const cdpTrace = resolve(directory, 'lifetime-cdp.json');
      const coverageTrace = resolve(directory, 'lifetime-coverage.json');
      const coverage = { ready, complete: ready && !errors.length, drained,
        dropped: messages.reduce((sum, message) => sum + (message.buffer?.dropped ?? 0), 0),
        errors, targetId, sessionId, processes: processes.map((entry) => ({ ...entry,
          endNs: entry.endNs ?? coverageEnd ?? null })) };
      const observation = { schemaVersion: 1, method: NATIVE_LIFETIME_METHOD, schema: NATIVE_LIFETIME_SCHEMA,
        runId, measurement: schema.measurement, identity: NATIVE_LIFETIME_IDENTITY, runtime,
        clock, captureTimestamp, coverage, events, cleanup,
        lifecycle: messages.flatMap((message) => message.lifecycle ? [message.lifecycle] : []) };
      const references = [];
      for (const [role, path, record] of [
        ['native', rawTrace, observation], ['cdp', cdpTrace, { schemaVersion: 1, runId, ledger }],
        ['coverage', coverageTrace, { schemaVersion: 1, runId, coverage }],
      ]) {
        const raw = `${JSON.stringify(record, null, 2)}\n`;
        await writeFile(path, raw); references.push({ role, path, sha256: digest(raw) });
      }
      for (const [role, path] of [['schema', schemaTrace], ['host', logTrace]]) {
        references.push({ role, path, sha256: digest(await readFile(path)) });
      }
      return { observation, provenance: { method: NATIVE_LIFETIME_METHOD, schema: NATIVE_LIFETIME_SCHEMA,
        runId, measurement: schema.measurement, captureTimestamp, references,
        overhead: 'buffered request hooks and per-owned-session agent residency until process exit included; no per-request IPC during measurement; post-drain shutdown events use IPC; no cost subtraction; setup/drain and separate observer costs retained, not separately measured' } };
    },
  };
}

export async function verifyNativeLifetimeEvidence(provenance, requests, outputRoot, measurement, passiveCdpLedger) {
  if (provenance.method !== NATIVE_LIFETIME_METHOD || provenance.schema !== NATIVE_LIFETIME_SCHEMA
    || !provenance.runId || !Array.isArray(provenance.references)
    || provenance.references.length !== 5) throw new Error('invalid native lifetime provenance');
  const records = {};
  for (const reference of provenance.references) {
    if (!['native', 'cdp', 'coverage', 'schema', 'host'].includes(reference.role)
      || records[reference.role] || !isAbsolute(reference.path)) throw new Error('invalid native lifetime reference');
    const path = await realpath(reference.path);
    const location = relative(await realpath(outputRoot), path);
    if (location.startsWith('..') || isAbsolute(location)) throw new Error('native lifetime trace outside output root');
    const raw = await readFile(path);
    if (digest(raw) !== reference.sha256) throw new Error('native lifetime digest mismatch');
    const record = JSON.parse(raw);
    if (record.schemaVersion !== 1 || record.runId !== provenance.runId) throw new Error('native lifetime cross-run/schema mismatch');
    records[reference.role] = record;
  }
  const schema = records.schema;
  if (!isDeepStrictEqual(provenance.measurement, records.native.measurement)
    || !isDeepStrictEqual(schema.measurement, provenance.measurement)
    || measurement && !isDeepStrictEqual(measurement, provenance.measurement)) {
    throw new Error('native lifetime measurement identity mismatch');
  }
  if (schema.schema !== NATIVE_LIFETIME_SCHEMA || schema.method !== NATIVE_LIFETIME_METHOD
    || !isDeepStrictEqual(schema.identity, NATIVE_LIFETIME_IDENTITY)
    || !isDeepStrictEqual(schema.hooks, NATIVE_LIFETIME_HOOKS)
    || !isDeepStrictEqual(schema.shutdownHooks, NATIVE_SHUTDOWN_HOOKS)
    || schema.agentSha256 !== digest(await readFile(new URL('./native-lifetime-agent.js', import.meta.url)))
    || schema.hostSha256 !== digest(await readFile(new URL('./native-lifetime-host.py', import.meta.url)))
    || !isDeepStrictEqual(records.coverage.coverage, records.native.coverage)
    || !isDeepStrictEqual(records.host.cleanup, records.native.cleanup)
    || records.native.captureTimestamp !== provenance.captureTimestamp
    || !Array.isArray(records.cdp.ledger)) throw new Error('native lifetime schema/coverage/capture authentication mismatch');
  if (passiveCdpLedger && !isDeepStrictEqual(passiveCdpLedger, records.cdp.ledger)) {
    throw new Error('native lifetime CDP ledger mismatch');
  }
  const boundaries = records.cdp.ledger.filter((entry) => entry.name === 'capture-boundary');
  if (boundaries.length > 0 || records.native.coverage.complete === true) {
    if (boundaries.length !== 1 || cutoffNs(boundaries[0].data?.captureTimestamp) === null
      || boundaries[0].data.captureTimestamp !== provenance.captureTimestamp) {
      throw new Error('native lifetime raw CDP capture boundary mismatch');
    }
  }
  const host = records.host;
  const drain = host.messages?.findLast((message) => message.drained !== undefined);
  const capturedProcesses = host.messages?.filter((message) => message.process).map((message) => ({
    ...message.process, endNs: message.process.endNs ?? drain?.ns ?? null,
  }));
  for (const message of host.messages ?? []) {
    if (message.processRole) {
      const process = capturedProcesses.find((entry) => entry.pid === message.processRole.pid);
      if (process) process.role = message.processRole.role;
    }
  }
  if (!Array.isArray(host.messages) || !Array.isArray(host.errors)
    || !isDeepStrictEqual(host.messages.flatMap((message) => message.events ?? []), records.native.events)
    || !isDeepStrictEqual(host.messages.find((message) => message.runtime)?.runtime, records.native.runtime)
    || !isDeepStrictEqual(capturedProcesses, records.native.coverage.processes)
    || !isDeepStrictEqual(host.errors, records.native.coverage.errors)
    || !isDeepStrictEqual(host.messages.flatMap((message) => message.lifecycle ? [message.lifecycle] : []),
      records.native.lifecycle)
    || records.native.coverage.dropped !== host.messages.reduce((sum, message) => sum + (message.buffer?.dropped ?? 0), 0)
    || records.native.coverage.drained !== (drain?.drained === true)) {
    throw new Error('native lifetime host/event/coverage replay mismatch');
  }
  const clockSamples = host.messages.filter((message) => message.ns && message.drained === undefined);
  const recordedClock = clockSamples.length >= 2 ? {
    native: 'CLOCK_MONOTONIC', unit: 'nanoseconds', cdp: 'Chromium TimeTicks seconds',
    beforeNs: clockSamples.at(-2).ns, afterNs: clockSamples.at(-1).ns,
  } : undefined;
  if (!isDeepStrictEqual(recordedClock, records.native.clock)) throw new Error('native lifetime clock replay mismatch');
  const originals = requests.map((request) => request.nativeLifetime ? request.cdpObservation : request);
  const replay = reconcileNativeLifetime(originals, records.native, records.cdp.ledger);
  if (!isDeepStrictEqual(replay.requests, requests)) throw new Error('native lifetime reconciliation replay mismatch');
  return replay.unavailable;
}
