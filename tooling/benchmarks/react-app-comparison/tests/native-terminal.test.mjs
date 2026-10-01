import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as collector from '../src/measure-browser.mjs';
import { createNativeCapture } from '../src/native-terminal.mjs';

const source = { id: 96, type: 1, start_time: '1018445000' };
const job = { id: 99, type: 17, start_time: '1018445000' };
const url = 'http://127.0.0.1/jukebox/songs?_rsc=observed';
const event = (type, phase, time, params, owner = source) => ({
  type, phase, time: String(time), source: owner, ...(params ? { params } : {}),
});
const log = () => ({
  constants: {
    logEventTypes: { CANCELLED: 0, REQUEST_ALIVE: 2, URL_REQUEST_START_JOB: 134,
      HTTP_STREAM_REQUEST_BOUND_TO_JOB: 186, HTTP_STREAM_JOB_BOUND_TO_REQUEST: 188 },
    logEventPhase: { PHASE_NONE: 0, PHASE_BEGIN: 1, PHASE_END: 2 },
    logSourceType: { URL_REQUEST: 1 },
  },
  events: [
    event(2, 1, 1018445000, { url }),
    event(134, 1, 1018445000, { url, method: 'GET' }),
    event(186, 0, 1018445000, { source_dependency: job }),
    event(188, 0, 1018445000, { source_dependency: source }, job),
    event(0, 0, 1018445000),
    event(2, 2, 1018445001),
  ],
});
const pending = () => ({
  requestId: '91238.26', loaderId: 'old-loader', method: 'GET', url,
  startedTimestamp: 1018445.00007, kind: 'request-pending', status: null,
  unavailable: 'request still in flight at capture boundary',
});
const provenance = { rawTrace: '/contained/native-network.json', sha256: 'a'.repeat(64),
  captureTimestamp: 1018455 };
const reconcile = (requests, nativeLog) =>
  collector.reconcileNativeTerminals(requests, nativeLog, provenance);

test('native cancellation missing from CDP counts as failure with exact source provenance', () => {
  // Given: observed millisecond native times and the old-loader CDP clock.
  const original = pending();
  // When: the complete native source chain ends before capture.
  const [outcome] = reconcile([original], log());
  // Then: cancellation is a failure, without forging a CDP loadingFailed.
  assert.equal(outcome.kind, 'request-failed');
  assert.equal(outcome.canceled, true);
  assert.equal(collector.summarizeErrorRate([outcome, { status: 200 }]), 0.5);
  assert.deepEqual(outcome.cdpObservation, original);
  assert.deepEqual(outcome.nativeTerminal.source, source);
  assert.equal(outcome.nativeTerminal.cancellation.time, '1018445000');
  assert.equal(outcome.nativeTerminal.end.time, '1018445001');
  assert.equal(outcome.nativeTerminal.rawTrace, provenance.rawTrace);
  assert.equal(outcome.nativeTerminal.sha256, provenance.sha256);
  assert.equal(Object.hasOwn(outcome, 'settledTimestamp'), false);
  assert.equal(Object.hasOwn(outcome, 'errorCode'), false);
  assert.equal(original.kind, 'request-pending');
});

test('observed cancellation before stream-job allocation authenticates through its reciprocal controller', () => {
  // Given: smoke request 625.27/source 100 had only controller 102 at cancellation.
  const nativeLog = log();
  nativeLog.constants.logEventTypes.HTTP_STREAM_JOB_CONTROLLER_BOUND = 194;
  nativeLog.events[2] = event(194, 0, 1018445000, {
    source_dependency: { id: 102, type: 32 },
  });
  nativeLog.events[3] = event(194, 0, 1018445000, {
    source_dependency: { id: source.id, type: source.type },
  }, { id: 102, type: 32, start_time: source.start_time });
  const [outcome] = reconcile([pending()], nativeLog);
  assert.equal(outcome.kind, 'request-failed');
  assert.equal(outcome.nativeTerminal.binding.type, 194);
  assert.equal(outcome.nativeTerminal.reciprocal.source.id, 102);
});

test('native requestTime correlates a dispatch crossing the renderer millisecond boundary', () => {
  // Given: the real final-smoke request began in the renderer's preceding tick.
  const request = { ...pending(), startedTimestamp: 1018444.999861 };
  const extra = { name: 'Network.requestWillBeSentExtraInfo', data: {
    requestId: request.requestId, connectTiming: { requestTime: 1018445.000099 },
  } };
  // When: the network service reports its exact timing in the retained CDP ledger.
  const [outcome] = collector.reconcileNativeTerminals([request], log(), provenance, [extra]);
  // Then: no clock tolerance or manufactured loadingFailed is needed.
  assert.equal(outcome.kind, 'request-failed');
  assert.deepEqual(outcome.cdpObservation, request);
  assert.equal(outcome.nativeTerminal.requestClock.timestamp, extra.data.connectTiming.requestTime);
});

test('duplicate or contradictory native requestTime observations stay inconclusive', () => {
  const request = pending();
  const extra = { name: 'Network.requestWillBeSentExtraInfo', data: {
    requestId: request.requestId, connectTiming: { requestTime: 1018445.000099 },
  } };
  assert.deepEqual(collector.reconcileNativeTerminals([request], log(), provenance, [extra, extra]), [request]);
  const earlier = { ...extra, data: { ...extra.data, connectTiming: { requestTime: 1018444 } } };
  assert.deepEqual(collector.reconcileNativeTerminals([request], log(), provenance, [earlier]), [request]);
});

test('repeated native URL and method in the same clock tick remain ambiguous', () => {
  const nativeLog = log();
  nativeLog.events.push(...log().events.map((entry) => ({
    ...entry, source: { ...entry.source, id: entry.source.id + 100 },
    ...(entry.params?.source_dependency ? { params: {
      source_dependency: { ...entry.params.source_dependency, id: entry.params.source_dependency.id + 100 },
    } } : {}),
  })));
  assert.deepEqual(reconcile([pending()], nativeLog), [pending()]);
});

test('two CDP identities cannot consume the same native source', () => {
  const requests = [pending(), { ...pending(), requestId: '91238.27' }];
  assert.deepEqual(reconcile(requests, log()), requests);
});

test('missing cancellation or END or reciprocal source binding stays inconclusive', () => {
  for (const index of [2, 3, 4, 5]) {
    const nativeLog = log();
    nativeLog.events.splice(index, 1);
    assert.deepEqual(reconcile([pending()], nativeLog), [pending()]);
  }
});

test('native cancellation or END after capture is not a measured terminal', () => {
  for (const index of [4, 5]) {
    const nativeLog = log();
    nativeLog.events[index].time = String(provenance.captureTimestamp * 1000 + 1);
    assert.deepEqual(reconcile([pending()], nativeLog), [pending()]);
  }
});

test('URL-only, mismatched method, missing clock and wrong source identity cannot correlate', () => {
  const requests = [
    { ...pending(), method: 'POST' },
    { ...pending(), startedTimestamp: 1018446 },
    { ...pending(), startedTimestamp: undefined },
  ];
  assert.deepEqual(reconcile(requests, log()), requests);
  const nativeLog = log();
  nativeLog.events[4].source = { ...source, start_time: '1018445002' };
  assert.deepEqual(reconcile([pending()], nativeLog), [pending()]);
});

test('existing CDP failure and successful HTTP observations remain unchanged', () => {
  const requests = [
    { ...pending(), kind: 'request-failed', error: 'net::ERR_ABORTED', canceled: true },
    { ...pending(), kind: undefined, status: 200 },
  ];
  assert.deepEqual(reconcile(requests, log()), requests);
});

test('a competing incomplete native source and a redirect chain cannot grant a terminal', () => {
  const nativeLog = log();
  nativeLog.events.push(...log().events.slice(0, 2).map((entry) => ({
    ...entry, source: { ...entry.source, id: 196 },
  })));
  assert.deepEqual(reconcile([pending()], nativeLog), [pending()]);
  const redirected = log();
  redirected.events.push(event(134, 1, 1018445001, { url, method: 'GET' }));
  assert.deepEqual(reconcile([pending()], redirected), [pending()]);
});

test('missing native source start time and a terminal exactly at cutoff stay inconclusive', () => {
  const nativeLog = log();
  for (const entry of nativeLog.events) entry.source = { id: entry.source.id, type: entry.source.type };
  assert.deepEqual(reconcile([pending()], nativeLog), [pending()]);
  const atCutoff = log();
  atCutoff.events[5].time = String(provenance.captureTimestamp * 1000);
  assert.deepEqual(reconcile([pending()], atCutoff), [pending()]);
});

test('native close is shared, flushes once and saves the original ledger after termination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-close-test-'));
  let release;
  const finished = new Promise((accept) => { release = accept; });
  let closes = 0;
  let transportCloses = 0;
  const child = { pid: 123, exitCode: null, signalCode: null };
  let path;
  const capture = await createNativeCapture({
    async launchServer(options) {
      path = options.args[0].slice('--log-net-log='.length);
      return {
        process: () => child, wsEndpoint: () => 'fixture',
        async close() { closes++; await finished; child.exitCode = 0; },
        async kill() { assert.fail('successful flush must not kill'); },
      };
    },
    async connect() { return { async close() { transportCloses++; } }; },
  }, directory);
  capture.ledger.push({ name: 'Network.requestWillBeSent', data: { requestId: 'original' } });
  const first = capture.close();
  const second = capture.close();
  assert.strictEqual(first, second);
  release();
  await first;
  assert.equal(closes, 1);
  assert.equal(transportCloses, 1);
  assert.equal(child.exitCode, 0);
  assert.equal(JSON.parse(await readFile(join(path, '..', 'cdp.json'), 'utf8')).ledger[0].data.requestId, 'original');
});

test('native close failure is preserved and owned kill completes before rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-close-failure-'));
  const failure = new Error('original native flush failure');
  const child = { pid: 124, exitCode: null, signalCode: null };
  let killed = 0;
  const capture = await createNativeCapture({
    async launchServer() {
      return {
        process: () => child, wsEndpoint: () => 'fixture',
        async close() { throw failure; },
        async kill() { killed++; child.signalCode = 'SIGKILL'; },
      };
    },
    async connect() { return { async close() {} }; },
  }, directory);
  await assert.rejects(capture.close(), (error) => error === failure);
  await assert.rejects(capture.close(), (error) => error === failure);
  assert.equal(killed, 1);
  assert.equal(child.signalCode, 'SIGKILL');
});
