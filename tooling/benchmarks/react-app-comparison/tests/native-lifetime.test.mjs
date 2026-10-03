import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createNativeLifetimeObserver, NATIVE_LIFETIME_HOOKS, NATIVE_LIFETIME_IDENTITY,
  NATIVE_LIFETIME_RUNTIME, NATIVE_LIFETIME_SCHEMA, NATIVE_SHUTDOWN_HOOKS, decodeNativeJournal,
  reconcileNativeLifetime } from '../src/native-lifetime.mjs';
import { verifyTraceFiles } from '../src/measure.mjs';

const request = () => ({
  requestId: '123.7', targetId: 'page', sessionId: 'session', occurrence: 1,
  frameId: 'frame', loaderId: 'document-loader', startedTimestamp: 10,
  kind: 'request-pending', status: null, url: 'http://fixture/ignored',
  method: 'GET', unavailable: 'pending at capture',
});
const fixture = () => {
  const common = { pid: 123, processBirth: '123:1:0', resource: '0x100',
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
  return withJournals({ schemaVersion: 1, method: 'chromium-native-lifetime-v1', runId: 'run',
    schema: NATIVE_LIFETIME_SCHEMA, captureTimestamp: 11, clock: { native: 'CLOCK_MONOTONIC', unit: 'nanoseconds',
      cdp: 'Chromium TimeTicks seconds', beforeNs: '10999999999', afterNs: '11000000001' },
    identity: { platform: 'linux', arch: 'arm64', browserVersion: '149.0.7827.0',
      revision: '1228', binarySha256: 'b6f53f7e40c3ad6727cb3a12536026dcd93281e5965923752c8130ed53e5e8c4',
      buildId: 'afcd146a627911fb30269f995d093903636ed886', abi: 'ELF64-LE-AArch64' },
    runtime: structuredClone(NATIVE_LIFETIME_RUNTIME),
    coverage: { ready: true, complete: true, drained: true, dropped: 0, errors: [],
      targetId: 'page', sessionId: 'session',
      processes: [{ pid: 123, processBirth: '123:1:0', role: 'renderer', endKind: 'live',
        authenticated: true, hooks: 7, readyNs: '9000000000', endNs: '12000000000',
        binarySha256: NATIVE_LIFETIME_IDENTITY.binarySha256, buildId: NATIVE_LIFETIME_IDENTITY.buildId,
        executedPath: '/browser/headless_shell', loadedPath: '/browser/headless_shell' }] },
    events, cleanup: { closed: true, exitCode: 0, signal: null, detached: true } });
};
function withJournals(observation) {
  const names = ['hooks-ready', 'resource-birth', 'loader-birth', 'identifier',
    'cancel-enter', 'error-enter', 'error-return', 'cancel-return'];
  const fields = ['resource', 'resourceBirth', 'loader', 'loaderBirth', 'identifier',
    'observerCall', 'call', 'parent', 'thread', 'normal', 'hooks'];
  observation.journals = observation.coverage.processes.map((process) => {
    const entries = observation.events.filter((event) => event.processBirth === process.processBirth);
    const raw = Buffer.alloc(512 + entries.length * 128);
    const execEpoch = Number(process.processBirth.split(':').at(-1));
    [0x4e4c4a32, 2, 500000, 128, 512, process.pid, execEpoch, entries.length, entries.length]
      .forEach((value, index) => raw.writeUInt32LE(value, index * 4));
    raw.writeUInt32LE(1, 52);
    raw.write(observation.runId, 64);
    raw.write(process.processBirth, 192);
    entries.forEach((event, index) => {
      const offset = 512 + index * 128;
      raw.writeUInt32LE(event.seq, offset);
      raw.writeUInt32LE(names.indexOf(event.event) + 1, offset + 4);
      raw.writeBigUInt64LE(BigInt(event.ns), offset + 8);
      let mask = 0;
      fields.forEach((field, number) => {
        if (!Object.hasOwn(event, field)) return;
        mask |= 1 << number;
        raw.writeBigUInt64LE(BigInt(event[field] === null ? 0
          : typeof event[field] === 'boolean' ? Number(event[field]) : event[field]),
        offset + 16 + number * 8);
      });
      raw.writeUInt32LE(mask, offset + 104);
    });
    const osBirth = process.processBirth.slice(0, process.processBirth.lastIndexOf(':'));
    return { complete: true, raw: raw.toString('base64'), snapshotNs: process.endNs,
      ownership: { version: 2, protocol: 'aarch64-release-acquire-v2', capacity: 500000,
        stride: 128, headerSize: 512, size: 64000512, fd: 9, inode: process.pid * 100 + execEpoch, device: 1,
        pid: process.pid, processBirth: process.processBirth, execEpoch, runId: observation.runId,
        osBirthBefore: osBirth, osBirthAfter: osBirth,
        acquiredNs: String(BigInt(process.readyNs) - 1n), acknowledgedNs: process.readyNs } };
  });
  return observation;
}
const ledger = () => [{ name: 'Network.requestWillBeSent', targetId: 'page', sessionId: 'session',
  data: { requestId: '123.7', frameId: 'frame', loaderId: 'document-loader', timestamp: 10 } }];

const shutdownFixture = () => {
  const observation = fixture();
  const sender = { pid: 100, processBirth: '100:5:0' };
  const target = { pid: 123, processBirth: '123:1', state: 'S' };
  const shutdown = [
    { event: 'shutdown-ready' },
    { event: 'shutdown-normal-enter', call: 1, parent: null },
    { event: 'shutdown-terminate-enter', call: 2, parent: 1, exitCode: 0, wait: 0 },
    { event: 'shutdown-signal-enter', call: 3, parent: 2, signal: 15, target },
    { event: 'shutdown-signal-return', call: 3, parent: 2, signal: 15, target, result: 0 },
    { event: 'shutdown-terminate-return', call: 2, parent: 1, exitCode: 0, wait: 0, result: 1 },
    { event: 'shutdown-normal-return', call: 1, parent: null },
  ].map((entry, index) => ({ ...sender, runId: 'run', thread: 9,
    seq: index + 1, ns: String(12e9 + index + 2), ...entry }));
  observation.lifecycle = [
    { event: 'owned-attach', ...sender, binarySha256: NATIVE_LIFETIME_IDENTITY.binarySha256 },
    { event: 'owned-attach', pid: 123, processBirth: '123:1:0',
      binarySha256: NATIVE_LIFETIME_IDENTITY.binarySha256 },
    shutdown[0],
    { event: 'graceful-close', ...sender, ns: '12000000003' },
    ...shutdown.slice(1).map((entry) => ({ ...entry, ns: String(BigInt(entry.ns) + 2n) })),
    { event: 'owned-exit', pid: 123, processBirth: '123:1:0', exitCodeRaw: 15, missing: false, ns: '12000000020' },
    { event: 'browser-result', pid: 100, exitCode: 0, signal: null, forcedKill: false },
  ];
  return observation;
};

test('observed live-target normal shutdown preserves raw SIGTERM without invalidating captured requests', () => {
  const observation = shutdownFixture();
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(result.requests[0].canceled, true);
  assert.equal(observation.lifecycle.find((entry) => entry.event === 'owned-exit').exitCodeRaw, 15);
});

test('early status-only kill observation does not substitute for or break post-close identity proof', () => {
  const observation = shutdownFixture();
  const early = [
    { event: 'shutdown-signal-enter', call: 40, parent: null, signal: 15,
      target: { pid: 122, processBirth: '122:3', state: 'Z', exitCodeRaw: 0 } },
    { event: 'shutdown-signal-return', call: 40, parent: null, signal: 15, result: 0,
      target: { pid: 122, processBirth: '122:3', state: 'Z', exitCodeRaw: 0 } },
  ].map((entry, index) => ({ ...entry, pid: 100, processBirth: '100:5:0', runId: 'run',
    thread: 9, seq: index + 2, ns: String(12000000002n + BigInt(index)) }));
  const ready = observation.lifecycle.find((entry) => entry.event === 'shutdown-ready');
  ready.ns = '11999999999';
  observation.lifecycle.splice(observation.lifecycle.indexOf(ready) + 1, 0, ...early);
  for (const entry of observation.lifecycle) {
    if (entry.event.startsWith('shutdown-') && !early.includes(entry) && entry !== ready) entry.seq += 2;
  }
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(observation.lifecycle.filter((entry) => entry.call === 40).length, 2);
});

for (const [name, mutate] of [
  ['omitted identities', (events) => {
    for (const event of events) {
      delete event.call;
      delete event.thread;
      if (!event.event.startsWith('shutdown-normal')) delete event.parent;
    }
  }],
  ['aliased identities', (events) => {
    for (const event of events) {
      event.call = 1;
      if (!event.event.startsWith('shutdown-normal')) event.parent = 1;
    }
  }],
]) {
  test(`shutdown ${name} cannot authorize nonzero exit`, () => {
    const observation = shutdownFixture();
    mutate(observation.lifecycle.filter((e) => e.event.startsWith('shutdown-') && e.event !== 'shutdown-ready'));
    const result = reconcileNativeLifetime([request()], observation, ledger());
    assert.deepEqual(result.unavailable, ['native lifetime: owned process abnormal exit']);
    assert.deepEqual(result.requests, [request()]);
  });

  test(`authenticated replay rejects shutdown ${name} even with matching host and raw digests`, async (t) => {
    const f = await authenticatedFixture(t);
    f.records.native.lifecycle = shutdownFixture().lifecycle;
    f.records.host.messages.push(...f.records.native.lifecycle.map((lifecycle) => ({ lifecycle })));
    await f.save('native');
    await f.save('host');
    await f.verify();
    mutate(f.records.native.lifecycle.filter((e) => e.event.startsWith('shutdown-') && e.event !== 'shutdown-ready'));
    await f.save('native');
    await f.save('host');
    await assert.rejects(f.verify(), /native lifetime reconciliation replay mismatch/u);
  });
}

for (const [name, mutate] of [
  ['zombie target', (o) => { o.lifecycle.find((e) => e.event === 'shutdown-signal-enter').target.state = 'Z'; }],
  ['failed send', (o) => { o.lifecycle.find((e) => e.event === 'shutdown-signal-return').result = -1; }],
  ['different target birth', (o) => { o.lifecycle.find((e) => e.event === 'owned-exit').processBirth = '123:2:0'; }],
  ['pre-close signal', (o) => { o.lifecycle.find((e) => e.event === 'graceful-close').ns = '12000000030'; }],
  ['missing caller return', (o) => { o.lifecycle = o.lifecycle.filter((e) => e.event !== 'shutdown-normal-return'); }],
  ['abnormal caller', (o) => { o.lifecycle.find((e) => e.event === 'shutdown-terminate-enter').exitCode = 1; }],
  ['unknown sender', (o) => { o.lifecycle = o.lifecycle.filter((e) => !(e.event === 'owned-attach' && e.pid === 100)); }],
  ['cross-run event', (o) => { o.lifecycle.find((e) => e.event === 'shutdown-signal-enter').runId = 'other'; }],
  ['forced browser kill', (o) => { o.lifecycle.find((e) => e.event === 'browser-result').forcedKill = true; }],
  ['crash status', (o) => { o.lifecycle.find((e) => e.event === 'owned-exit').exitCodeRaw = 11; }],
]) {
  test(`normal shutdown evidence rejects ${name}`, () => {
    const observation = shutdownFixture();
    mutate(observation);
    assert.ok(reconcileNativeLifetime([request()], observation, ledger()).unavailable.length > 0);
  });
}

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
  // Keep valid binary fields synchronized so request/clock negatives reach
  // their owning invariant instead of all failing on stale transport bytes.
  const fields = ['resource', 'resourceBirth', 'loader', 'loaderBirth', 'identifier',
    'observerCall', 'call', 'parent', 'thread', 'normal', 'hooks'];
  if (observation.events.every((event) => fields.every((field) => !Object.hasOwn(event, field)
    || (field === 'normal' ? typeof event[field] === 'boolean'
      : event[field] === null || typeof event[field] === 'number' && Number.isSafeInteger(event[field])
        || typeof event[field] === 'string' && /^(?:0x[0-9a-f]+|[0-9]+)$/u.test(event[field]))))) {
    withJournals(observation);
  }
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
  withJournals(observation);
  const original = request();
  const result = reconcileNativeLifetime([original], observation, ledger());
  assert.deepEqual(result.requests, [original]);
  assert.deepEqual(result.unavailable, []);
});

test('authenticated retired renderer keeps nonempty history beside its replacement', () => {
  // Given: the original renderer completed its native chain, then exited normally.
  const observation = fixture();
  const old = observation.coverage.processes[0];
  old.endNs = '10500000000';
  old.endKind = 'retired';
  observation.lifecycle = [
    { event: 'owned-attach', pid: old.pid, processBirth: old.processBirth,
      binarySha256: old.binarySha256 },
    { event: 'owned-exit', pid: old.pid, processBirth: old.processBirth,
      ns: old.endNs, exitCodeRaw: 0, missing: false },
    { event: 'detached', pid: old.pid, processBirth: old.processBirth,
      ns: old.endNs, reason: 'process-terminated', rendererHooks: true, closing: false },
  ];
  observation.coverage.processes.push({ ...old, pid: 124, processBirth: '124:2:0',
    readyNs: '10400000000', endNs: '12000000000', endKind: 'live' });
  observation.events.push({ event: 'hooks-ready', hooks: 7, pid: 124,
    processBirth: '124:2:0', runId: 'run', seq: 1, ns: '10400000000' });
  withJournals(observation);
  // When: both live intervals are reconciled at the unchanged cutoff.
  const result = reconcileNativeLifetime([request()], observation, ledger());
  // Then: a legitimate old interval is not padded or discarded.
  assert.deepEqual(result.unavailable, []);
  assert.equal(result.requests[0].canceled, true);
  assert.equal(observation.events.filter((event) => event.pid === 123).length, 9);
  assert.equal(old.endNs, '10500000000');
});

for (const [name, mutate] of [
  ['missing ownership', (journal) => { delete journal.ownership; }],
  ['foreign PID', (journal) => { journal.ownership.pid++; }],
  ['birth mismatch', (journal) => { journal.ownership.osBirthAfter = '123:2'; }],
  ['late ownership', (journal) => { journal.ownership.acquiredNs = '9000000001'; }],
  ['unacknowledged ownership', (_journal, raw) => { raw.writeUInt32LE(0, 52); }],
  ['attempted tail', (_journal, raw) => { raw.writeUInt32LE(10, 28); }],
  ['committed gap', (_journal, raw) => { raw.writeUInt32LE(8, 32); }],
  ['torn marker', (_journal, raw) => { raw.writeUInt32LE(0, 512 + 8 * 128); }],
  ['sequence gap', (_journal, raw) => { raw.writeUInt32LE(10, 512 + 8 * 128); }],
  ['overflow', (_journal, raw) => { raw.writeUInt32LE(500001, 28); }],
  ['drop', (_journal, raw) => { raw.writeUInt32LE(1, 36); }],
  ['interrupted callback', (_journal, raw) => { raw.writeUInt32LE(1, 40); }],
  ['pending constructor or observer call', (_journal, raw) => { raw.writeUInt32LE(1, 44); }],
  ['callback failure', (_journal, raw) => { raw.writeUInt32LE(1, 48); }],
  ['foreign raw header', (_journal, raw) => { raw.writeUInt32LE(124, 20); }],
  ['unknown record fields', (_journal, raw) => { raw.writeUInt32LE(1 << 15, 512 + 104); }],
]) {
  test(`native journal rejects ${name} without losing original raw`, () => {
    // Given: an original complete journal with one adversarial transport defect.
    const observation = fixture();
    const journal = observation.journals[0];
    const raw = Buffer.from(journal.raw, 'base64');
    mutate(journal, raw);
    journal.raw = raw.toString('base64');
    const retained = journal.raw;
    // When: the authenticated binary protocol is independently decoded.
    assert.throws(() => decodeNativeJournal(journal, observation.coverage.processes[0], 'run'),
      /incomplete\/foreign native journal/u);
    // Then: rejection never repairs or drops the attempted raw.
    assert.equal(journal.raw, retained);
  });
}

function retiredFixture() {
  const observation = fixture();
  const process = observation.coverage.processes[0];
  process.endKind = 'retired';
  process.endNs = '10500000000';
  observation.lifecycle = [
    { event: 'owned-attach', pid: process.pid, processBirth: process.processBirth,
      binarySha256: process.binarySha256 },
    { event: 'detached', pid: process.pid, processBirth: process.processBirth, ns: process.endNs,
      rendererHooks: true, closing: false, reason: 'process-terminated' },
    { event: 'owned-exit', pid: process.pid, processBirth: process.processBirth, osBirth: '123:1',
      ns: '10500000001', exitCodeRaw: 0, missing: false },
  ];
  return withJournals(observation);
}

for (const [name, mutate] of [
  ['unknown exit status', (o) => { Object.assign(o.lifecycle.at(-1), { exitCodeRaw: null, missing: true }); }],
  ['crash', (o) => { o.lifecycle.at(-1).exitCodeRaw = 11; }],
  ['foreign exit birth', (o) => { o.lifecycle.at(-1).osBirth = '123:2'; }],
  ['unmatched detach', (o) => { o.lifecycle[1].processBirth = '123:2:0'; }],
  ['missing journal', (o) => { o.journals = []; }],
  ['invented retirement interval', (o) => { o.coverage.processes[0].endNs = '10600000000'; }],
]) {
  test(`retired interval rejects ${name} instead of padding coverage`, () => {
    const observation = retiredFixture();
    mutate(observation);
    assert.ok(reconcileNativeLifetime([request()], observation, ledger()).unavailable.length);
  });
}

for (const event of ['detached', 'owned-exit', 'exec-success']) {
  test(`live interval cannot conceal retained ${event} evidence`, () => {
    const observation = fixture();
    observation.lifecycle = [{ event, pid: 123, processBirth: '123:1:0',
      previousBirth: '123:1:0', osBirth: '123:1', ns: '10500000000',
      exitCodeRaw: null, missing: true }];
    const result = reconcileNativeLifetime([request()], observation, ledger());
    assert.deepEqual(result.unavailable, ['native lifetime: process identity/coverage conflict']);
    assert.deepEqual(result.requests, [request()]);
  });
}

test('post-drain exit and detach do not invalidate a completed live interval', () => {
  const observation = fixture();
  observation.lifecycle = [
    { event: 'owned-exit', pid: 123, processBirth: '123:1:0', osBirth: '123:1',
      ns: '13000000000', exitCodeRaw: null, missing: true },
    { event: 'detached', pid: 123, processBirth: '123:1:0', ns: '13000000001',
      reason: 'process-terminated', rendererHooks: true, closing: true },
  ];
  assert.deepEqual(reconcileNativeLifetime([request()], observation, ledger()).unavailable, []);
});

test('birth-bound zombie witness retains missing pidfd status independently', () => {
  const observation = retiredFixture();
  Object.assign(observation.lifecycle.at(-1), { exitCodeRaw: null, missing: true });
  observation.lifecycle.push(
    { event: 'owned-attach', pid: 100, processBirth: '100:5:0',
      binarySha256: NATIVE_LIFETIME_IDENTITY.binarySha256 },
    { event: 'shutdown-signal-enter', pid: 100, processBirth: '100:5:0', runId: 'run',
      ns: '10499999999', target: { pid: 123, processBirth: '123:1', state: 'Z', exitCodeRaw: 0 } });
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(observation.lifecycle[2].missing, true);
  assert.equal(observation.lifecycle[2].exitCodeRaw, null);
});

test('hooks-ready-only retirement retains its actual record beside a nonempty successor', () => {
  const observation = retiredFixture();
  const old = observation.coverage.processes[0];
  old.endNs = '9500000000';
  observation.lifecycle[1].ns = old.endNs;
  observation.lifecycle[2].ns = '9500000001';
  const history = observation.events.map((event, index) => ({ ...event, pid: 124,
    processBirth: '124:2:0', ns: String(9400000000n + BigInt(index) * 100000000n) }));
  observation.events.splice(1);
  observation.events.push(...history);
  observation.coverage.processes.push({ ...old, pid: 124, processBirth: '124:2:0',
    readyNs: '9400000000', endNs: '12000000000', endKind: 'live' });
  withJournals(observation);
  const pending = { ...request(), requestId: '124.7' };
  const cdp = ledger();
  cdp[0].data.requestId = pending.requestId;
  const result = reconcileNativeLifetime([pending], observation, cdp);
  assert.deepEqual(result.unavailable, []);
  assert.equal(observation.events.filter((event) => event.pid === 123).length, 1);
  assert.equal(result.requests[0].canceled, true);
});

test('failed exec leaves the original live journal and sequence intact', () => {
  const observation = fixture();
  const original = structuredClone(observation.journals[0]);
  observation.lifecycle = [{ event: 'exec-failed', pid: 123, processBirth: '123:1:0',
    ns: '10000000000', result: -1 }];
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.deepEqual(observation.journals, [original]);
  assert.equal(observation.coverage.processes[0].endKind, 'live');
});

function parentStatusFixture(statusRaw = 0) {
  const observation = retiredFixture();
  Object.assign(observation.lifecycle[2], { exitCodeRaw: null, missing: true });
  const fields = Array(50).fill('0');
  fields[0] = 'Z';
  fields[1] = '100';
  fields[19] = '1';
  fields[49] = String(statusRaw);
  observation.lifecycle.push(
    { event: 'owned-attach', pid: 100, processBirth: '100:5:0',
      executedPath: '/browser/headless_shell', binarySha256: NATIVE_LIFETIME_IDENTITY.binarySha256 },
    { event: 'parent-wait-ready', pid: 100, processBirth: '100:5:0', runId: 'run',
      seq: 1, ns: '9000000000', loadedPath: '/browser/headless_shell', hooks: ['waitpid', 'wait4'] },
    { event: 'parent-reap', pid: 100, processBirth: '100:5:0', runId: 'run', seq: 2,
      ns: '10500000002', startedNs: '10490000000', function: 'waitpid', normal: true,
      requestedPid: -1, options: 1, result: 123, thread: 100, statusRaw,
      target: { pid: 123, processBirth: '123:1', parentPid: 100, exitCodeRaw: statusRaw,
        stat: `123 (renderer) ${fields.join(' ')}` } });
  if (statusRaw === 15) {
    const source = shutdownFixture().lifecycle.filter((entry) => entry.event.startsWith('shutdown-'));
    source.forEach((entry, index) => { entry.ns = String(10400000000n + BigInt(index) * 10000000n); });
    observation.lifecycle.push(...source);
  }
  return observation;
}

test('owned parent normal reap authenticates retirement without rewriting missing pidfd status', () => {
  const observation = parentStatusFixture();
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(observation.lifecycle[2].exitCodeRaw, null);
  assert.equal(observation.lifecycle[2].missing, true);
});

test('pre-cutoff SIGTERM retirement keeps genuine status and requires its own complete caller chain', () => {
  const observation = parentStatusFixture(15);
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(observation.lifecycle.find((entry) => entry.event === 'parent-reap').statusRaw, 15);
  assert.equal(observation.lifecycle.some((entry) => entry.event === 'graceful-close'), false);
  assert.equal(observation.lifecycle[2].exitCodeRaw, null);
});

test('NULL wait destination stays missing while its pre-reap zombie stat supplies independent status', () => {
  const observation = parentStatusFixture();
  const reap = observation.lifecycle.find((entry) => entry.event === 'parent-reap');
  reap.statusRaw = null;
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(reap.statusRaw, null);
  assert.equal(reap.target.exitCodeRaw, 0);
  assert.equal(observation.lifecycle[2].exitCodeRaw, null);
});

for (const [name, mutate] of [
  ['foreign parent', (o) => { o.lifecycle.find((entry) => entry.event === 'parent-reap').pid = 101; }],
  ['foreign target birth', (o) => { o.lifecycle.find((entry) => entry.event === 'parent-reap').target.processBirth = '123:2'; }],
  ['foreign raw stat', (o) => { const e = o.lifecycle.find((entry) => entry.event === 'parent-reap'); e.target.stat = e.target.stat.replace('renderer) Z 100', 'renderer) Z 101'); }],
  ['unknown raw status', (o) => {
    const reap = o.lifecycle.find((entry) => entry.event === 'parent-reap');
    reap.statusRaw = null;
    reap.target.exitCodeRaw = null;
  }],
  ['missing normal return', (o) => { o.lifecycle.find((entry) => entry.event === 'parent-reap').normal = false; }],
  ['raw status conflict', (o) => { Object.assign(o.lifecycle[2], { exitCodeRaw: 0, missing: false }); }],
  ['missing ready', (o) => { o.lifecycle = o.lifecycle.filter((entry) => entry.event !== 'parent-wait-ready'); }],
  ['cross-run witness', (o) => { o.lifecycle.find((entry) => entry.event === 'parent-reap').runId = 'foreign'; }],
  ['missing termination caller', (o) => { o.lifecycle = o.lifecycle.filter((entry) => entry.event !== 'shutdown-normal-enter'); }],
  ['missing caller return', (o) => { o.lifecycle = o.lifecycle.filter((entry) => entry.event !== 'shutdown-normal-return'); }],
  ['zombie signal cause', (o) => { o.lifecycle.find((entry) => entry.event === 'shutdown-signal-enter').target.state = 'Z'; }],
  ['failed signal send', (o) => { o.lifecycle.find((entry) => entry.event === 'shutdown-signal-return').result = -1; }],
  ['post-cutoff caller', (o) => { o.lifecycle.filter((entry) => entry.event.startsWith('shutdown-')).forEach((entry, i) => { entry.ns = String(12e9 + i); }); }],
  ['borrowed graceful-close', (o) => {
    o.lifecycle = o.lifecycle.filter((entry) => !entry.event.startsWith('shutdown-'));
    o.lifecycle.push({ event: 'graceful-close', pid: 100, processBirth: '100:5:0', ns: '9000000000' });
  }],
]) {
  test(`independent retirement status rejects ${name}`, () => {
    const observation = parentStatusFixture(15);
    mutate(observation);
    const result = reconcileNativeLifetime([request()], observation, ledger());
    assert.ok(result.unavailable.length);
    assert.deepEqual(result.requests, [request()]);
  });
}

function execFixture() {
  const observation = retiredFixture();
  const old = observation.coverage.processes[0];
  old.endKind = 'exec';
  observation.lifecycle[1].reason = 'process-replaced';
  observation.lifecycle.pop();
  observation.coverage.processes.push({ ...old, processBirth: '123:1:1', endKind: 'live',
    readyNs: '10600000000', endNs: '12000000000' });
  observation.events.push({ event: 'hooks-ready', hooks: 7, runId: 'run', pid: 123,
    processBirth: '123:1:1', seq: 1, ns: '10600000000' });
  observation.lifecycle.push(
    { event: 'exec-success', pid: 123, previousBirth: old.processBirth,
      processBirth: '123:1:1', gated: true, ns: '10600000001' },
    { event: 'child-resume', pid: 123, processBirth: '123:1:1', ns: '10600000002' });
  return withJournals(observation);
}

test('successful gated exec retains distinct same-birth journal histories', () => {
  const observation = execFixture();
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.unavailable, []);
  assert.equal(observation.journals.length, 2);
  assert.equal(observation.events.filter((event) => event.seq === 1).length, 2);
});

for (const [name, mutate] of [
  ['failed exec treated as retirement', (o) => { o.lifecycle[2].event = 'exec-failed'; }],
  ['missing gate', (o) => { o.lifecycle[2].gated = false; }],
  ['late successor hooks', (o) => { o.lifecycle[3].ns = '10599999999'; }],
  ['overlapping image intervals', (o) => { o.coverage.processes[1].readyNs = '10499999999'; }],
  ['aliased journal inode', (o) => { o.journals[1].ownership.inode = o.journals[0].ownership.inode; }],
  ['dropped predecessor', (o) => { o.coverage.processes.shift(); }],
]) {
  test(`exec evidence rejects ${name}`, () => {
    const observation = execFixture();
    mutate(observation);
    assert.ok(reconcileNativeLifetime([request()], observation, ledger()).unavailable.length);
  });
}

test('known descendant crash cannot reconcile despite normal Python cleanup and main exit', () => {
  const observation = fixture();
  observation.lifecycle = [{ event: 'owned-exit', pid: 124, processBirth: '124:1',
    ns: '12000000000', exitCodeRaw: 11, missing: false }];
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.deepEqual(result.requests, [request()]);
  assert.deepEqual(result.unavailable, ['native lifetime: owned process abnormal exit']);
});

test('missing descendant wait status is retained rather than synthesized as normal', () => {
  const observation = fixture();
  observation.lifecycle = [{ event: 'owned-exit', pid: 124, processBirth: '124:1',
    ns: '12000000000', exitCodeRaw: null, missing: true }];
  const result = reconcileNativeLifetime([request()], observation, ledger());
  assert.equal(result.requests[0].kind, 'request-failed');
  assert.equal(observation.lifecycle[0].exitCodeRaw, null);
  assert.equal(observation.lifecycle[0].missing, true);
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
  withJournals(observation);
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

async function authenticatedFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'native-cutoff-auth-'));
  t.after(() => rm(directory, { recursive: true }));
  const hash = (raw) => createHash('sha256').update(raw).digest('hex');
  const observation = fixture();
  observation.clock.beforeNs = '10900000000';
  observation.clock.afterNs = '11100000000';
  observation.lifecycle = [];
  const measurement = { runId: 'measurement', framework: 'next', profile: 'desktop-native', mode: 'native' };
  observation.measurement = measurement;
  const cdp = [...ledger(), { name: 'capture-boundary', data: { captureTimestamp: 11 } }];
  const schema = { schemaVersion: 1, runId: observation.runId, method: observation.method,
    schema: observation.schema, measurement, identity: observation.identity, hooks: NATIVE_LIFETIME_HOOKS,
    shutdownHooks: NATIVE_SHUTDOWN_HOOKS,
    agentSha256: hash(await readFile(new URL('../src/native-lifetime-agent.js', import.meta.url))),
    hostSha256: hash(await readFile(new URL('../src/native-lifetime-host.py', import.meta.url))) };
  const host = { schemaVersion: 1, runId: observation.runId, errors: [], cleanup: observation.cleanup,
    messages: [
      { process: observation.coverage.processes[0], runtime: observation.runtime },
      ...observation.journals.flatMap((journal) => [{ journalOwnership: journal.ownership }, { journal }]),
      { ns: observation.clock.beforeNs }, { ns: observation.clock.afterNs },
      { drained: true, ns: '12000000000', events: observation.events, buffer: { dropped: 0 } },
    ] };
  const provenance = { method: observation.method, schema: observation.schema,
    runId: observation.runId, measurement, captureTimestamp: 11, references: [] };
  const records = { native: observation, cdp: { schemaVersion: 1, runId: observation.runId, ledger: cdp },
    coverage: { schemaVersion: 1, runId: observation.runId, coverage: observation.coverage }, schema, host };
  const save = async (role) => {
    const raw = JSON.stringify(records[role]);
    const path = join(directory, `${role}.json`);
    await writeFile(path, raw);
    const reference = provenance.references.find((entry) => entry.role === role);
    if (reference) reference.sha256 = hash(raw);
    else provenance.references.push({ role, path, sha256: hash(raw) });
  };
  for (const role of Object.keys(records)) await save(role);
  const netlog = JSON.stringify({ constants: {}, events: [{}] });
  await writeFile(join(directory, 'netlog.json'), netlog);
  const record = { schemaVersion: 1, ...measurement, provenance: {}, environment: {}, profileSettings: {},
    correctness: { pass: true }, metrics: {}, unavailable: {}, qualityFailures: [],
    requests: reconcileNativeLifetime([request()], observation, cdp).requests,
    artifacts: { nativeLifetimeObserver: provenance, nativeTerminalObserver: {
      rawTrace: join(directory, 'netlog.json'), sha256: hash(netlog),
      cdpTrace: join(directory, 'cdp.json'), cdpSha256: provenance.references[1].sha256, captureTimestamp: 11,
    } } };
  const trace = join(directory, 'trace.json');
  const verify = async () => {
    await writeFile(trace, JSON.stringify(record));
    return verifyTraceFiles([{ trace }], directory);
  };
  return { records, record, save, verify };
}

test('authenticated cutoff cannot move consistently inside the clock bracket away from raw CDP capture', async (t) => {
  const f = await authenticatedFixture(t);
  await f.verify();
  const timestamp = 11.05;
  f.records.native.captureTimestamp = timestamp;
  f.record.artifacts.nativeLifetimeObserver.captureTimestamp = timestamp;
  f.record.artifacts.nativeTerminalObserver.captureTimestamp = timestamp;
  f.record.requests[0].nativeLifetime.captureTimestamp = timestamp;
  await f.save('native');
  await assert.rejects(f.verify(), /raw CDP capture boundary/u);
});

for (const mutation of ['retired end', 'live classification', 'live unknown status']) {
  test(`rehashing an invented ${mutation} cannot waive semantic replay`, async (t) => {
    // Given: complete, independently replayable old-renderer retirement.
    const f = await authenticatedFixture(t);
    const retired = retiredFixture();
    Object.assign(f.records.native, { lifecycle: retired.lifecycle, journals: retired.journals,
      coverage: retired.coverage });
    f.records.coverage.coverage = f.records.native.coverage;
    f.records.host.messages = [
      { process: retired.coverage.processes[0], runtime: f.records.native.runtime },
      ...retired.lifecycle.map((lifecycle) => ({ lifecycle })),
      ...retired.journals.flatMap((journal) => [{ journalOwnership: journal.ownership }, { journal }]),
      { ns: f.records.native.clock.beforeNs }, { ns: f.records.native.clock.afterNs },
      { drained: true, ns: '12000000000', events: retired.events, buffer: { dropped: 0 } },
    ];
    f.record.requests = reconcileNativeLifetime([request()], f.records.native, f.records.cdp.ledger).requests;
    for (const role of ['native', 'coverage', 'host']) await f.save(role);
    await f.verify();
    // When: raw/host/coverage digests agree but end no longer matches the witness.
    const process = f.records.native.coverage.processes[0];
    process.endNs = mutation === 'retired end' ? '10500000001' : '12000000000';
    f.records.native.journals[0].snapshotNs = process.endNs;
    if (mutation !== 'retired end') process.endKind = 'live';
    if (mutation === 'live unknown status') {
      const exit = f.records.native.lifecycle.find((entry) => entry.event === 'owned-exit');
      Object.assign(exit, { exitCodeRaw: null, missing: true });
    }
    for (const role of ['native', 'coverage', 'host']) await f.save(role);
    // Then: digest consistency does not substitute for interval authenticity.
    await assert.rejects(f.verify(), /reconciliation replay mismatch/u);
  });
}

test('rehashing a torn journal marker cannot waive original record replay', async (t) => {
  const f = await authenticatedFixture(t);
  await f.verify();
  const journal = f.records.native.journals[0];
  const raw = Buffer.from(journal.raw, 'base64');
  raw.writeUInt32LE(0, raw.length - 128);
  journal.raw = raw.toString('base64');
  await f.save('native');
  await f.save('host');
  await assert.rejects(f.verify(), /reconciliation replay mismatch/u);
});

for (const [name, mutate] of [
  ['missing', (cdp) => { cdp.ledger.pop(); }],
  ['duplicate', (cdp) => { cdp.ledger.push(structuredClone(cdp.ledger.at(-1))); }],
  ['nonfinite', (cdp) => { cdp.ledger.at(-1).data.captureTimestamp = null; }],
]) {
  test(`complete native evidence rejects ${name} raw capture boundary`, async (t) => {
    const f = await authenticatedFixture(t);
    await f.verify();
    mutate(f.records.cdp);
    await f.save('cdp');
    f.record.artifacts.nativeTerminalObserver.cdpSha256 =
      f.record.artifacts.nativeLifetimeObserver.references.find((entry) => entry.role === 'cdp').sha256;
    await assert.rejects(f.verify(), /raw CDP capture boundary/u);
  });
}

test('host ingestion retains the supported 500000 event buffer and completes drain and cleanup', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'native-max-ingestion-'));
  t.after(() => rm(directory, { recursive: true }));
  const host = new EventEmitter();
  Object.assign(host, { stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null, pid: 321 });
  const commands = [];
  host.stdin = {
    writable: true,
    write(line) {
      const message = JSON.parse(line);
      commands.push(message.command);
      let reply = { id: message.id };
      if (message.command === 'prepare') reply.runtime = NATIVE_LIFETIME_RUNTIME;
      if (message.command === 'clock') reply.ns = '11000000000';
      if (message.command === 'drain') {
        reply = { ...reply, drained: true, ns: '12000000000', buffer: { dropped: 0 },
          events: Array.from({ length: 500_000 }, (_, seq) => ({ event: 'resource-birth', seq: seq + 1 })) };
      }
      if (['release', 'close'].includes(message.command)) {
        reply.detached = true;
        reply.released = true;
        reply.shutdownReady = true;
      }
      host.stdout.write(`${JSON.stringify(reply)}\n`);
    },
    end() { host.exitCode = 0; host.emit('exit', 0, null); },
  };
  let detached = false;
  const browserCdp = {
    async send(name) { return name === 'SystemInfo.getProcessInfo'
      ? { processInfo: [] } : { targetInfos: [] }; },
    async detach() { detached = true; },
  };
  const observer = await createNativeLifetimeObserver({
    enabled: true, directory, python: '/fake/python', spawn: () => host,
  });
  // Exercise the existing injected host seam on every host OS without Python/Frida.
  const descriptors = ['platform', 'arch'].map((key) => [key, Object.getOwnPropertyDescriptor(process, key)]);
  try {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    await observer.prepare({ version: () => NATIVE_LIFETIME_IDENTITY.browserVersion,
      async newBrowserCDPSession() { return browserCdp; } }, 123,
    { async send() { return { targetInfo: { targetId: 'page' } }; } });
  } finally {
    for (const [key, descriptor] of descriptors) Object.defineProperty(process, key, descriptor);
  }
  await observer.captureClock(async () => ({}));
  await observer.drain(11, []);
  await observer.close();
  const result = await observer.drain(11, []);
  assert.equal(result.observation.coverage.drained, true);
  assert.deepEqual(result.observation.coverage.errors, []);
  assert.equal(result.observation.events.length, 500_000);
  assert.equal(result.observation.events[0].seq, 1);
  assert.equal(result.observation.events.at(-1).seq, 500_000);
  assert.deepEqual(commands, ['prepare', 'clock', 'clock', 'drain', 'release', 'close']);
  assert.equal(result.observation.cleanup.closed, true);
  assert.equal(result.observation.cleanup.detached, true);
  assert.equal(result.observation.cleanup.exitCode, 0);
  assert.equal(detached, true);
  assert.equal(host.stderr.listenerCount('data'), 0);
  const retained = JSON.parse(await readFile(join(directory, 'lifetime.json'), 'utf8'));
  assert.equal(retained.events.length, 500_000);
  const receipt = JSON.parse(await readFile(join(directory, 'lifetime-host.json'), 'utf8'));
  assert.equal(receipt.messages.find((message) => message.drained).events.length, 500_000);
  assert.equal(receipt.cleanup.closed, true);
});

test('failed close readiness preserves the first coverage error and still closes the observer', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'native-primary-error-'));
  t.after(() => rm(directory, { recursive: true }));
  const host = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null, pid: 323 });
  const commands = [];
  host.stdin = {
    writable: true,
    write(line) {
      const command = JSON.parse(line);
      commands.push(command.command);
      const reply = { id: command.id };
      if (command.command === 'prepare') reply.runtime = NATIVE_LIFETIME_RUNTIME;
      if (command.command === 'drain') reply.error = 'renderer detached before drain';
      if (command.command === 'release') reply.error = 'script has been destroyed';
      if (command.command === 'begin-close') reply.error = 'shutdown observation not ready';
      if (command.command === 'close') reply.detached = true;
      host.stdout.write(`${JSON.stringify(reply)}\n`);
    },
    end() { host.exitCode = 0; host.emit('exit', 0, null); },
  };
  const observer = await createNativeLifetimeObserver({
    enabled: true, directory, python: '/fake/python', spawn: () => host,
  });
  const descriptors = ['platform', 'arch'].map((key) => [key, Object.getOwnPropertyDescriptor(process, key)]);
  try {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    await observer.prepare({ version: () => NATIVE_LIFETIME_IDENTITY.browserVersion,
      async newBrowserCDPSession() { return { async send(name) {
        return name === 'SystemInfo.getProcessInfo' ? { processInfo: [] } : { targetInfos: [] };
      }, async detach() {} }; } }, 123,
    { async send() { return { targetInfo: { targetId: 'page' } }; } });
  } finally {
    for (const [key, descriptor] of descriptors) Object.defineProperty(process, key, descriptor);
  }
  await observer.drain(11, []);
  try {
    await assert.rejects(observer.beginClose(), (error) =>
      error.message === 'renderer detached before drain'
      && error.cause?.message === 'shutdown observation not ready');
  } finally { await observer.close(); }
  const result = await observer.drain(11, []);
  assert.equal(result.observation.coverage.complete, false);
  assert.equal(result.observation.coverage.drained, false);
  assert.equal(result.observation.cleanup.closed, true);
  assert.equal(result.observation.cleanup.detached, true);
  assert.equal(result.observation.cleanup.exitCode, 0);
  assert.deepEqual(commands, ['prepare', 'drain', 'release', 'begin-close', 'close']);
  const receipt = JSON.parse(await readFile(join(directory, 'lifetime-host.json'), 'utf8'));
  assert.equal(receipt.errors[0], 'renderer detached before drain');
  assert.ok(receipt.errors.includes('script has been destroyed'));
  assert.ok(receipt.errors.includes('shutdown observation not ready'));
  assert.equal(host.listenerCount('exit'), 0);
});

test('drain releases hooks but retains process exit observation until browser termination', async (t) => {
  // Given: an event-backed host whose owned browser has not terminated.
  const directory = await mkdtemp(join(tmpdir(), 'native-resident-lifetime-'));
  t.after(() => rm(directory, { recursive: true }));
  const host = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null, pid: 322 });
  let browserAlive = true;
  const commands = [];
  host.stdin = {
    writable: true,
    write(line) {
      const command = JSON.parse(line);
      commands.push(command.command);
      const reply = { id: command.id };
      if (command.command === 'prepare') reply.runtime = NATIVE_LIFETIME_RUNTIME;
      if (command.command === 'drain') Object.assign(reply, { drained: true, ns: '12000000000' });
      if (command.command === 'release') Object.assign(reply, {
        detached: false, released: true, shutdownReady: true });
      if (command.command === 'close') {
        assert.equal(browserAlive, false, 'observer exit subscription ended before browser exit');
        Object.assign(reply, { detached: true });
        host.stdout.write(`${JSON.stringify({ lifecycle: { event: 'owned-exit', pid: 123,
          processBirth: '123:1', exitCodeRaw: null, missing: true, ns: '13000000000' } })}\n`);
      }
      host.stdout.write(`${JSON.stringify(reply)}\n`);
    },
    end() { host.exitCode = 0; host.emit('exit', 0, null); },
  };
  const observer = await createNativeLifetimeObserver({
    enabled: true, directory, python: '/fake/python', spawn: () => host,
  });
  const descriptors = ['platform', 'arch'].map((key) => [key, Object.getOwnPropertyDescriptor(process, key)]);
  try {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    await observer.prepare({ version: () => NATIVE_LIFETIME_IDENTITY.browserVersion,
      async newBrowserCDPSession() { return { async send(name) {
        return name === 'SystemInfo.getProcessInfo' ? { processInfo: [] } : { targetInfos: [] };
      }, async detach() {} }; } }, 123,
    { async send() { return { targetInfo: { targetId: 'page' } }; } });
  } finally {
    for (const [key, descriptor] of descriptors) Object.defineProperty(process, key, descriptor);
  }
  // When: original-cutoff drain precedes the real browser exit boundary.
  const draining = await observer.drain(11, []);
  assert.equal(draining.observation.cleanup.detached, false);
  assert.equal(host.exitCode, null);
  assert.deepEqual(commands, ['prepare', 'drain', 'release']);
  browserAlive = false;
  await observer.close();
  const result = await observer.drain(11, []);
  // Then: cleanup evidence contains the exit event, without inventing missing status.
  assert.equal(result.observation.cleanup.closed, true);
  assert.equal(result.observation.lifecycle.at(-1).exitCodeRaw, null);
  assert.equal(result.observation.lifecycle.at(-1).missing, true);
  assert.equal(host.listenerCount('exit'), 0);
  assert.equal(host.listenerCount('error'), 0);
});
