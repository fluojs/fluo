import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NATIVE_LIFETIME_IDENTITY, NATIVE_LIFETIME_RUNTIME, NATIVE_LIFETIME_SCHEMA,
  reconcileNativeLifetime } from '../src/native-lifetime.mjs';

const request = () => ({
  requestId: '123.7', targetId: 'page', sessionId: 'session', occurrence: 1,
  frameId: 'frame', loaderId: 'document-loader', startedTimestamp: 10,
  kind: 'request-pending', status: null, url: 'http://fixture/ignored',
  method: 'GET', unavailable: 'pending at capture',
});
const fixture = () => {
  const common = { pid: 123, processBirth: '123:1', resource: '0x100',
    resourceBirth: 1, loader: '0x200', loaderBirth: 1 };
  const events = [
    { event: 'hooks-ready', hooks: 7 },
    { event: 'resource-birth' },
    { event: 'identifier', identifier: '7', observerCall: 1 },
    { event: 'identifier', identifier: '7', observerCall: 1 },
    { event: 'loader-birth' },
    { event: 'cancel-enter', call: 2, thread: 1, parent: null },
    { event: 'error-enter', call: 3, thread: 1, parent: 2 },
    { event: 'error-return', call: 3, thread: 1, parent: 2, normal: true },
    { event: 'cancel-return', call: 2, thread: 1, parent: null, normal: true },
  ].map((entry, index) => ({ ...common, ns: String((9 + index / 10) * 1e9),
    seq: index + 1, runId: 'run', ...entry }));
  return { schemaVersion: 1, method: 'chromium-native-lifetime-v1', runId: 'run',
    schema: NATIVE_LIFETIME_SCHEMA, captureTimestamp: 11, clock: { native: 'CLOCK_MONOTONIC', unit: 'nanoseconds',
      cdp: 'Chromium TimeTicks seconds', beforeNs: '10999999999', afterNs: '11000000001' },
    identity: { platform: 'linux', arch: 'arm64', browserVersion: '149.0.7827.0',
      revision: '1228', binarySha256: 'b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4',
      buildId: 'afcd146a627911fb30269f995d093903636ed886', abi: 'ELF64-LE-AArch64' },
    runtime: structuredClone(NATIVE_LIFETIME_RUNTIME),
    coverage: { ready: true, complete: true, drained: true, dropped: 0, errors: [],
      targetId: 'page', sessionId: 'session',
      processes: [{ pid: 123, processBirth: '123:1', role: 'renderer',
        authenticated: true, hooks: 7, readyNs: '9000000000', endNs: '12000000000',
        binarySha256: NATIVE_LIFETIME_IDENTITY.binarySha256, buildId: NATIVE_LIFETIME_IDENTITY.buildId,
        executedPath: '/browser/headless_shell', loadedPath: '/browser/headless_shell' }] },
    events, cleanup: { closed: true, exitCode: 0, signal: null, detached: true } };
};
const ledger = () => [{ name: 'Network.requestWillBeSent', targetId: 'page', sessionId: 'session',
  data: { requestId: '123.7', frameId: 'frame', loaderId: 'document-loader', timestamp: 10 } }];

test('exact pending native chain requires both nested normal returns before original cutoff', () => {
  const original = request();
  const result = reconcileNativeLifetime([original], fixture(), ledger());
  assert.equal(result.requests[0].kind, 'request-failed');
  assert.equal(result.requests[0].canceled, true);
  assert.deepEqual(result.requests[0].cdpObservation, original);
  assert.equal(Object.hasOwn(result.requests[0], 'settledTimestamp'), false);
  assert.equal(Object.hasOwn(result.requests[0], 'errorCode'), false);
  assert.deepEqual(result.unavailable, []);
});

test('disabled native lifetime observation requires no external runtime', async () => {
  const collector = await import('../src/native-lifetime.mjs');
  let spawned = false;
  const observer = await collector.createNativeLifetimeObserver({
    enabled: false,
    spawn() { spawned = true; throw new Error('external runtime must not start'); },
  });
  assert.equal(observer, null);
  assert.equal(spawned, false);
});

const rejectMutation = (change) => {
  const observation = fixture();
  const requests = [request()];
  const cdp = ledger();
  change(observation, requests, cdp);
  const result = reconcileNativeLifetime(requests, observation, cdp);
  assert.deepEqual(result.requests, requests);
  assert.ok(result.unavailable.length > 0);
};

for (const field of ['platform', 'arch', 'browserVersion', 'revision', 'binarySha256', 'buildId', 'abi']) {
  test(`unsupported binary ${field} cannot resolve pending`, () => {
    rejectMutation((observation) => { observation.identity[field] = 'unsupported'; });
  });
}
for (const [name, change] of [
  ['schema mismatch', (o) => { o.schema = 'bad'; }],
  ['missing runtime', (o) => { delete o.runtime; }],
  ['Frida identity mismatch', (o) => { o.runtime.fridaVersion = '17.0.0'; }],
  ['Python executable mismatch', (o) => { o.runtime.pythonSha256 = 'a'.repeat(64); }],
  ['dependency identity mismatch', (o) => { o.runtime.fridaFiles['aio.py'] = 'b'.repeat(64); }],
  ['partial hooks', (o) => { o.coverage.processes[0].hooks = 6; }],
  ['late attach', (o) => { o.coverage.processes[0].readyNs = '10000000000'; }],
  ['process end before capture', (o) => { o.coverage.processes[0].endNs = '10999999999'; }],
  ['process replacement PID reuse', (o) => { o.coverage.processes.push({ ...o.coverage.processes[0], processBirth: '123:2' }); }],
  ['loaded binary mismatch', (o) => { o.coverage.processes[0].loadedPath = '/other/headless_shell'; }],
  ['coverage gap', (o) => { o.coverage.complete = false; }],
  ['script error', (o) => { o.coverage.errors.push('script error'); }],
  ['transport error', (o) => { o.coverage.errors.push('transport error'); }],
  ['event drop', (o) => { o.coverage.dropped = 1; }],
  ['empty events', (o) => { o.events = []; }],
  ['sequence gap', (o) => { o.events[4].seq++; }],
  ['event clock reversal', (o) => { o.events[4].ns = '9000000000'; }],
  ['cross-run event', (o) => { o.events[4].runId = 'other'; }],
  ['PID conflict', (o) => { o.events[4].pid = 124; }],
  ['birth conflict', (o) => { o.events[4].processBirth = '123:2'; }],
  ['incomplete drain', (o) => { o.coverage.drained = false; }],
  ['cleanup error', (o) => { o.cleanup.exitCode = 1; }],
  ['cleanup live child', (o) => { o.cleanup.closed = false; }],
  ['cleanup live session', (o) => { o.cleanup.detached = false; }],
  ['wrong clock unit', (o) => { o.clock.unit = 'microseconds'; }],
  ['wrong clock source', (o) => { o.clock.native = 'wall-time'; }],
  ['clock bracket conflict', (o) => { o.clock.beforeNs = '11000000001'; }],
  ['cutoff equality', (o) => { o.events.at(-1).ns = '11000000000'; }],
  ['after cutoff', (o) => { o.events.at(-1).ns = '11000000001'; }],
  ['error return at cutoff', (o) => { o.events.at(-2).ns = '11000000000'; o.events.at(-1).ns = '11000000001'; }],
  ['Cancel entry only', (o) => { o.events.splice(6); }],
  ['missing HandleError return', (o) => { o.events.splice(7, 1); o.events.at(-1).seq--; }],
  ['missing Cancel return', (o) => { o.events.pop(); }],
  ['exceptional error return', (o) => { o.events[7].normal = false; }],
  ['malformed normal return flag', (o) => { o.events[7].normal = 'true'; }],
  ['missing Cancel entry', (o) => { o.events.splice(5, 1); o.events.forEach((e, i) => { e.seq = i + 1; }); }],
  ['missing HandleError entry', (o) => { o.events.splice(6, 1); o.events.forEach((e, i) => { e.seq = i + 1; }); }],
  ['invented Cancel parent', (o) => { o.events[5].parent = 999; o.events[8].parent = 999; }],
  ['malformed call thread', (o) => { o.events.slice(5).forEach((e) => { e.thread = '1'; }); }],
  ['malformed complete coverage flag', (o) => { o.coverage.complete = 'true'; }],
  ['wrong nested call', (o) => { o.events[6].parent = 999; }],
  ['wrong return attribution', (o) => { o.events[7].call = 999; }],
  ['thread conflict', (o) => { o.events[7].thread = 2; }],
  ['reversed returns', (o) => { [o.events[7].event, o.events[8].event] = [o.events[8].event, o.events[7].event]; }],
  ['loader binding conflict', (o) => { o.events[7].resourceBirth = 2; }],
  ['identifier conflict', (o) => { o.events[3].identifier = '8'; }],
  ['URL-only events', (o) => { o.events = o.events.filter((e) => e.event !== 'identifier'); }],
  ['CDP target conflict', (_o, r) => { r[0].targetId = 'other'; }],
  ['CDP session conflict', (_o, r) => { r[0].sessionId = 'other'; }],
  ['CDP occurrence reuse', (_o, r) => { r[0].occurrence = 2; }],
  ['redirect occurrence', (_o, _r, c) => { c[0].data.redirectResponse = { status: 302 }; }],
  ['CDP request reuse', (_o, _r, c) => { c.push(structuredClone(c[0])); }],
  ['two CDP consumers', (_o, r) => { r.push({ ...r[0] }); }],
  ['Resource pointer birth reuse', (o) => {
    o.events.push(...o.events.slice(1, 4).map((e, i) => ({ ...e, resourceBirth: 2,
      seq: 10 + i, ns: String(10_500_000_000 + i) })));
  }],
  ['Loader pointer independent birth reuse', (o) => {
    o.events.push({ ...o.events[4], loaderBirth: 2, seq: 10, ns: '10500000000' });
  }],
  ['missing independent Loader birth', (o) => { delete o.events[4].loaderBirth; }],
  ['nested Cancel ambiguity', (o) => {
    o.events.splice(6, 0, { ...o.events[5], call: 4, parent: 2 });
    o.events.forEach((e, i) => { e.seq = i + 1; });
  }],
]) {
  test(`${name} remains pending and explicitly inconclusive`, () => rejectMutation(change));
}

test('actual CDP terminals are preserved and contradictory success is inconclusive', () => {
  const canceled = { ...request(), kind: 'request-failed', canceled: true, error: 'net::ERR_ABORTED' };
  assert.deepEqual(reconcileNativeLifetime([canceled], fixture(), ledger()).requests, [canceled]);
  const success = { ...request(), kind: 'response', status: 200 };
  const result = reconcileNativeLifetime([success], fixture(), ledger());
  assert.deepEqual(result.requests, [success]);
  assert.ok(result.unavailable.some((reason) => reason.includes('terminal conflict')));
});

test('genuinely unfinished requests without native cancellation stay pending', () => {
  const observation = fixture();
  observation.events.splice(5);
  const original = request();
  const result = reconcileNativeLifetime([original], observation, ledger());
  assert.deepEqual(result.requests, [original]);
  assert.deepEqual(result.unavailable, []);
});

test('missing clock samples after child coverage failure report coverage as the primary blocker', () => {
  const observation = fixture();
  delete observation.clock;
  observation.coverage.complete = false;
  observation.coverage.errors = ['owned child hook coverage failed before capture'];
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.requests, [request()]);
  assert.deepEqual(result.unavailable, ['native lifetime: incomplete coverage/drain/cleanup']);
});

test('settled cached requests sharing one native Resource without cancellation stay unchanged', () => {
  const observation = fixture();
  observation.events.splice(5);
  observation.events.push({ ...observation.events[2], seq: 6, ns: '10000000001',
    identifier: '8', observerCall: 4 });
  const requests = [request(), { ...request(), requestId: '123.8' }]
    .map((entry) => ({ ...entry, kind: 'response', status: 200 }));
  const cdp = [...ledger(), { ...ledger()[0], data: { ...ledger()[0].data, requestId: '123.8' } }];
  const result = reconcileNativeLifetime(requests, observation, cdp);
  assert.deepEqual(result.requests, requests);
  assert.deepEqual(result.unavailable, []);
});

test('unsupported opt-in records unavailable evidence without spawning runtime', async () => {
  const { createNativeLifetimeObserver } = await import('../src/native-lifetime.mjs');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'native-unsupported-'));
  let spawned = false;
  const observer = await createNativeLifetimeObserver({ enabled: true, directory,
    spawn() { spawned = true; throw new Error('must not spawn unsupported browser'); } });
  await observer.prepare({ version: () => 'unsupported' }, 123, {});
  const result = await observer.drain(11, []);
  assert.equal(spawned, false);
  assert.equal(result.observation.coverage.complete, false);
  assert.ok(result.observation.coverage.errors.length);
});
