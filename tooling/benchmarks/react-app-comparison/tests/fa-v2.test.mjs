import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as evaluator from '../src/evaluate.ts';
import * as gate from '../src/gate.mjs';
import * as browser from '../src/measure-browser.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertMethodConfig, captureMethodBinding, hashObject, pairStimuliIdentity,
  pairStimuliComparison, verifyMethodBinding, verifyMethodReceipt, verifyMethodTrace } from '../src/fa-v2.mjs';
import { collectDevMeasurements, collectMeasurements, environmentConfigIdentity, mergeEvidence, planMeasurements, verifyTraceFiles } from '../src/measure.mjs';

const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
const baseline = {
  profiles: { 'desktop-native': {
    mode: 'native',
    absoluteBudgets: Object.fromEntries(evaluator.METRICS.map((metric) =>
      [metric, metric === 'errorRate' ? 0 : 100])),
    relativeBands: Object.fromEntries(evaluator.METRICS.map((metric) => [metric, 1.5])),
  } },
  policy: { minimumRuns: 5, warmupRuns: 2, maximumRelativeSpread: 0.15, outlierMadMultiplier: 3 },
};
function samples(metric, fluo, peer = fluo) {
  return frameworks.flatMap((framework) => Array.from({ length: 5 }, (_, index) => ({
    methodVersion: 'FA-V2', measurementPurpose: 'timing',
    framework, profile: 'desktop-native', mode: 'native', runId: `${framework}-${index}`,
    trace: `/raw/${framework}-${index}`, correctness: 'pass', warmupRuns: 2,
    metrics: { ...Object.fromEntries(evaluator.METRICS.map((name) =>
      [name, name === 'errorRate' ? 0 : name === 'throughputRequestsPerSecond' ? 120 : 50])),
    [metric]: (framework === 'fluo' ? fluo : peer)[index] },
  })));
}

test('explicit FA-V2 dispatch reports an all-sample budget failure despite spread', () => {
  const runs = samples('cpuPercent', [101, 110, 120, 130, 140]);
  assert.equal(evaluator.evaluatePerformance(baseline, runs, 'FA-V2').verdict, 'fail');
});

test('FA-V2 exposes range evaluation without replacing historical replay', () => {
  assert.equal(typeof evaluator.evaluateObservedRanges, 'function');
  const runs = samples('cpuPercent', [101, 110, 120, 130, 140]);
  assert.equal(evaluator.evaluatePerformance(baseline, runs).verdict, 'inconclusive');
  assert.equal(evaluator.evaluateObservedRanges(baseline, runs).verdict, 'fail');
});

for (const [label, numbers, verdict] of [
  ['equality', [100, 100, 100, 100, 100], 'pass'],
  ['crossing', [99, 99, 99, 99, 101], 'inconclusive'],
  ['spread within budget', [10, 30, 50, 70, 90], 'pass'],
  ['all above', [101, 110, 120, 130, 140], 'fail'],
]) {
  test(`FA-V2 upper absolute ${label}`, () => {
    const runs = samples('cpuPercent', numbers, [100, 100, 100, 100, 100]);
    const result = evaluator.evaluateObservedRanges(baseline, runs);
    assert.equal(result.checks.find((check) => check.metric === 'cpuPercent'
      && check.framework === 'fluo').verdict, verdict);
  });
}

for (const [fluo, peer, verdict] of [
  [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 'pass'],
  [[0.9, 0.9, 0.9, 0.9, 0.9], [0.6, 0.6, 0.6, 0.6, 0.6], 'pass'],
  [[0.9000000000000001, 0.9000000000000001, 0.9000000000000001, 0.9000000000000001, 0.9000000000000001],
    [0.6, 0.6, 0.6, 0.6, 0.6], 'fail'],
  [[80, 80, 80, 80, 95], [60, 60, 60, 60, 60], 'inconclusive'],
]) {
  test(`FA-V2 upper peer ${fluo[0]}..${fluo[4]} gives ${verdict}`, () => {
    const result = evaluator.evaluateObservedRanges(baseline, samples('cpuPercent', fluo, peer));
    assert.equal(result.checks.find((check) => check.metric === 'cpuPercent'
      && check.framework === 'next').verdict, verdict);
  });
}

for (const [numbers, verdict] of [
  [[100, 100, 100, 100, 100], 'pass'],
  [[0, 0, 0, 0, 0], 'fail'],
  [[99, 100, 101, 102, 103], 'inconclusive'],
]) {
  test(`FA-V2 throughput lower budget ${numbers[0]} gives ${verdict}`, () => {
    const result = evaluator.evaluateObservedRanges(baseline,
      samples('throughputRequestsPerSecond', numbers, [100, 100, 100, 100, 100]));
    assert.equal(result.checks.find((check) => check.metric === 'throughputRequestsPerSecond'
      && check.framework === 'fluo').verdict, verdict);
  });
}

for (const mutation of [
  (runs) => runs.slice(1),
  (runs) => [...runs, runs[0]],
  (runs) => runs.map((run, index) => index ? run : { ...run, correctness: 'inconclusive' }),
  (runs) => runs.map((run, index) => index ? run : { ...run, metrics: { ...run.metrics, cpuPercent: NaN } }),
  (runs) => runs.map((run, index) => index ? run : { ...run, metrics: {} }),
  (runs) => runs.map((run) => ({ ...run, mode: 'matched-cache' })),
  (runs) => runs.map((run) => ({ ...run, methodVersion: undefined })),
  (runs) => runs.map((run) => ({ ...run, measurementPurpose: 'native-conformance' })),
]) {
  test('FA-V2 incomplete invalid or wrong-purpose samples cannot pass', () => {
    assert.notEqual(evaluator.evaluateObservedRanges(baseline,
      mutation(samples('cpuPercent', [50, 50, 50, 50, 50]))).verdict, 'pass');
  });
}

test('accepted gate rejects historical receipt before considering performance', async () => {
  assert.equal(typeof gate.evaluateAcceptedEvidence, 'function');
  await assert.rejects(gate.evaluateAcceptedEvidence(baseline,
    [{ profile: 'desktop-native', mode: 'native', runs: [] }], '/tmp'), /FA-V2/);
});

test('server CPU uses unrounded lifetime ticks and retains RSS and raw ps', async () => {
  assert.equal(typeof browser.readServerCpu, 'function');
  const fields = Array(50).fill('0');
  fields[0] = 'S';
  fields[11] = '90';
  fields[12] = '10';
  fields[19] = '100';
  const stat = `123 (server (name)) ${fields.join(' ')}`;
  const record = await browser.readServerCpu(123, {
    read: async (path) => path === '/proc/uptime' ? '4.01 0.00\n' : stat,
    execute: async (command) => ({ stdout: command === 'getconf' ? '100\n' : '33.2 42\n' }),
  });
  assert.equal(record.cpuPercent, 100 / 3.01);
  assert.equal(record.rssBytes, 42 * 1024);
  assert.equal(record.rawPs, '33.2 42\n');
  assert.equal(record.starttime, 100);
  assert.equal(record.clkTck, 100);
  assert.ok(record.quantization.cpuTickSeconds > 0);
});

test('server CPU rejects PID birth replacement instead of substituting client CPU', async () => {
  assert.equal(typeof browser.readServerCpu, 'function');
  const fields = Array(50).fill('0');
  fields[0] = 'S'; fields[19] = '100';
  let reads = 0;
  await assert.rejects(browser.readServerCpu(123, {
    read: async (path) => {
      if (path === '/proc/uptime') return '4 0\n';
      fields[19] = String(100 + reads++);
      return `123 (server) ${fields.join(' ')}`;
    },
    execute: async (command) => ({ stdout: command === 'getconf' ? '100\n' : '0.0 42\n' }),
  }), /birth/);
});

const methodConfig = {
  ...JSON.parse(await readFile(new URL('../config/representative.json', import.meta.url), 'utf8')).measurement,
  methodVersion: 'FA-V2', measurementPurpose: 'timing', pairId: 'fixed-pair', pairPhase: 'before',
  profile: 'desktop-native', mode: 'native', warmupRuns: 2, measurementRuns: 5,
  nativeLifetime: { enabled: false },
  apps: Object.fromEntries(frameworks.map((name) => [name, `http://fixture/${name}`])),
  serverPids: Object.fromEntries(frameworks.map((name) => [name, 123])),
  provenance: { baselineSha256: 'a'.repeat(64), commit: 'b'.repeat(40) },
};

test('frozen measured inventory rejects swapping warmups across both purposes without changing raw evidence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-inventory-swap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const receipts = [];
  for (const measurementPurpose of ['timing', 'native-conformance']) {
    const config = { ...methodConfig, measurementPurpose,
      nativeLifetime: measurementPurpose === 'timing' ? { enabled: false } : { enabled: true, python: '/python' } };
    let breached = false;
    const receipt = await collectMeasurements(config, {
      async check() { return { pass: true, steps: [] }; },
      async measure(item) {
        const metrics = { ...samples('cpuPercent', [50, 50, 50, 50, 50])[0].metrics };
        if (!item.warmup && item.framework === 'fluo' && !breached) {
          metrics.cpuPercent = 150;
          breached = true;
        }
        return { metrics };
      },
    }, join(directory, measurementPurpose));
    await verifyMethodReceipt(receipt, directory);
    receipts.push(receipt);
  }
  const before = evaluator.evaluateObservedRanges(baseline, receipts[0].runs);
  assert.notEqual(before.verdict, 'pass');
  const originalBytes = new Map();
  for (const receipt of receipts) {
    for (const run of [...receipt.runs, ...receipt.warmups]) originalBytes.set(run.trace, await readFile(run.trace, 'utf8'));
    originalBytes.set(receipt.methodBinding.path, await readFile(receipt.methodBinding.path, 'utf8'));
    const measured = receipt.runs.findIndex((run) => run.framework === 'fluo' && run.metrics.cpuPercent === 150);
    const warmup = receipt.warmups.findIndex((run) => run.framework === 'fluo');
    [receipt.runs[measured], receipt.warmups[warmup]] = [receipt.warmups[warmup], receipt.runs[measured]];
  }
  assert.equal(evaluator.evaluateObservedRanges(baseline, receipts[0].runs).verdict, 'pass');
  for (const [path, bytes] of originalBytes) assert.equal(await readFile(path, 'utf8'), bytes);
  for (const receipt of receipts) await assert.rejects(verifyMethodReceipt(receipt, directory), /frozen measured inventory/u);
  const frozen = JSON.parse(await readFile(new URL('../baseline.json', import.meta.url), 'utf8'));
  await assert.rejects(gate.evaluateAcceptedEvidence(frozen, [receipts[0]], directory, [receipts[1]]),
    /frozen measured inventory/u);
});

test('approved production descriptor rejects consistently changed endpoints across both phases and purposes', () => {
  for (const pairPhase of ['before', 'after']) {
    for (const measurementPurpose of ['timing', 'native-conformance']) {
      const config = structuredClone({ ...methodConfig, pairPhase, measurementPurpose,
        nativeLifetime: measurementPurpose === 'timing' ? { enabled: false } : { enabled: true, python: '/python' } });
      for (const throughput of Object.values(config.throughput)) throughput.path = '/';
      assert.throws(() => assertMethodConfig(config), /approved production descriptor/u);
    }
  }
});

test('approved production descriptor rejects consistently rehashed counterpart configurations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-descriptor-rehash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const pairPhase of ['before', 'after']) {
    for (const measurementPurpose of ['timing', 'native-conformance']) {
      const binding = await captureMethodBinding({ ...methodConfig, pairPhase, measurementPurpose,
        nativeLifetime: measurementPurpose === 'timing' ? { enabled: false } : { enabled: true, python: '/python' } }, directory);
      const record = JSON.parse(await readFile(binding.path, 'utf8'));
      for (const throughput of Object.values(record.configuration.throughput)) throughput.path = '/';
      const { measurementPurpose: _purpose, nativeLifetime, provenance, serverPids,
        environmentBinding, isolatedRepresentative, ...stimuli } = record.configuration;
      record.configSha256 = hashObject(record.configuration);
      record.stimuliSha256 = hashObject(stimuli);
      const bytes = JSON.stringify(record);
      await writeFile(binding.path, bytes);
      const altered = { ...binding, configSha256: record.configSha256, stimuliSha256: record.stimuliSha256,
        sha256: createHash('sha256').update(bytes).digest('hex') };
      await assert.rejects(verifyMethodBinding(altered, directory), /approved production descriptor/u);
    }
  }
});

for (const mutate of [
  (config) => { config.journeys.detail.path = '/products/sku-43'; },
  (config) => { config.journeys.auth.actions[0].value = 'other-user'; },
  (config) => { config.interactions[0].trigger = 'a[href="/jukebox/songs"]'; },
]) {
  test('approved production descriptor rejects route action and interaction stimulus mutations', () => {
    const config = structuredClone(methodConfig);
    mutate(config);
    assert.throws(() => assertMethodConfig(config), /approved production descriptor/u);
  });
}

for (const changes of [
  { measurementPurpose: 'native' }, { measurementPurpose: 'matched-cache' },
  { measurementPurpose: 'native-conformance' }, { methodVersion: 'historical-v1' },
  { warmupRuns: 1 }, { measurementRuns: 4 }, { pairPhase: 'unknown' },
  { throughput: { ...methodConfig.throughput, next: { path: '/', requests: 5000, concurrency: 8 } } },
  { nativeLifetime: { enabled: true } },
]) {
  test(`purpose configuration rejects ${JSON.stringify(changes)}`, () => {
    assert.throws(() => assertMethodConfig({ ...methodConfig, ...changes }), /FA-V2/);
  });
}

test('collector authenticates purpose and independent executions without manufacturing correctness', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-collect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const driver = { check: async () => ({ pass: false, steps: [] }) };
  const receipt = await collectMeasurements(methodConfig, driver, directory);
  await verifyMethodReceipt(receipt, directory);
  await verifyTraceFiles([...receipt.runs, ...receipt.warmups], directory);
  assert.equal(receipt.runs.length, 20);
  assert.equal(receipt.warmups.length, 8);
  assert.ok(receipt.runs.every((run) => run.correctness === 'fail'));
  const second = await captureMethodBinding(methodConfig, directory);
  assert.notEqual(second.executionId, receipt.methodBinding.executionId);
  assert.equal(second.configSha256, receipt.methodBinding.configSha256);
  const development = await collectDevMeasurements(methodConfig, driver, join(directory, 'dev'));
  const combined = await mergeEvidence(receipt, development, join(directory, 'combined'));
  await verifyTraceFiles(combined.runs, directory);
  await assert.rejects(verifyTraceFiles([{ ...combined.runs[0], correctness: 'pass' }], directory), /combined quality/u);
  await assert.rejects(verifyMethodReceipt({ ...receipt, measurementPurpose: 'native-conformance' }, directory), /identity/);
  const trace = JSON.parse(await readFile(receipt.runs[0].trace, 'utf8'));
  trace.measurementPurpose = 'native-conformance';
  await writeFile(receipt.runs[0].trace, JSON.stringify(trace));
  await assert.rejects(verifyTraceFiles(receipt.runs, directory), /purpose/);
});

test('raw CPU, passive terminals and config identity cannot be altered or borrowed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-raw-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const methodBinding = await captureMethodBinding(methodConfig, directory);
  const fields = Array(50).fill('0');
  fields[0] = 'S'; fields[11] = '90'; fields[12] = '10'; fields[19] = '100';
  const serverCpu = await browser.readServerCpu(123, {
    read: async (path) => path === '/proc/uptime' ? '4.01 0\n' : `123 (server) ${fields.join(' ')}`,
    execute: async (command) => ({ stdout: command === 'getconf' ? '100\n' : '33.2 42\n' }),
  });
  const cdpTrace = join(directory, 'cdp.json');
  const cdp = { ledger: [{ name: 'capture-boundary', data: { captureTimestamp: 10, methodBinding } }],
    cleanup: { closed: true, exitCode: 0, signalCode: null } };
  const bytes = JSON.stringify(cdp);
  await writeFile(cdpTrace, bytes);
  const item = planMeasurements(methodConfig).find((entry) => entry.framework === 'fluo' && !entry.warmup);
  const record = {
    ...item,
    methodVersion: 'FA-V2', measurementPurpose: 'timing', methodBinding,
    provenance: methodConfig.provenance, correctness: { pass: true }, qualityFailures: [],
    timings: {}, requests: Array.from({ length: 200 }, () => ({ status: 200, resourceType: 'throughput' })),
    metrics: { cpuPercent: serverCpu.cpuPercent, rssBytes: serverCpu.rssBytes, errorRate: 0 },
    artifacts: { serverCpu, serverCpuSha256: hashObject(serverCpu),
      throughput: methodConfig.throughput.fluo,
      nativeTerminalObserver: { cdpTrace, cdpSha256: createHash('sha256').update(bytes).digest('hex'), captureTimestamp: 10 } },
  };
  const expected = { ...record, correctness: 'pass', serverCpuSha256: hashObject(serverCpu) };
  await verifyMethodTrace(record, expected, directory);
  for (const mutate of [
    (value) => { value.metrics.cpuPercent = 33.2; },
    (value) => { value.artifacts.serverCpu.utime++; },
    (value) => {
      value.artifacts.serverCpu.rawStat = value.artifacts.serverCpu.rawStat.replace('90 10', '89 11');
      value.artifacts.serverCpu.rawStatAfter = value.artifacts.serverCpu.rawStatAfter.replace('90 10', '89 11');
      value.artifacts.serverCpu.utime = 89;
      value.artifacts.serverCpu.stime = 11;
      value.artifacts.serverCpuSha256 = hashObject(value.artifacts.serverCpu);
    },
    (value) => { value.artifacts.serverCpu.rawUptime = '5 0'; value.artifacts.serverCpuSha256 = hashObject(value.artifacts.serverCpu); },
    (value) => { value.artifacts.serverCpu.pid++; value.artifacts.serverCpuSha256 = hashObject(value.artifacts.serverCpu); },
    (value) => { value.requests.push({ nativeLifetime: {} }); },
    (value) => { value.qualityFailures.push('pending request'); },
    (value) => { value.requests.push({ kind: 'request-pending' }); },
    (value) => { value.metrics.errorRate = 0.5; },
    (value) => { value.artifacts.throughput.requests = 5000; },
    (value) => { value.artifacts.nativeTerminalObserver.captureTimestamp++; },
    (value) => { value.timings['cold-ready'] = {}; },
  ]) {
    const altered = structuredClone(record);
    mutate(altered);
    await assert.rejects(verifyMethodTrace(altered, expected, directory), /FA-V2/);
  }
  await writeFile(methodBinding.path, '{}');
  await assert.rejects(verifyMethodBinding(methodBinding, directory), /digest/);
});

test('raw frozen inventory rejects warmup cycle and slot reclassification', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-raw-inventory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const receipt = await collectMeasurements(methodConfig, { async check() { return { pass: false, steps: [] }; } }, directory);
  const run = receipt.runs[0];
  const record = JSON.parse(await readFile(run.trace, 'utf8'));
  for (const mutation of [
    { warmup: true }, { cycle: 1 }, { slot: 4 }, { device: 'tablet' }, { url: 'http://other/' },
  ]) {
    await assert.rejects(verifyMethodTrace({ ...record, ...mutation }, run, directory), /frozen raw inventory/u);
  }
  await assert.rejects(verifyMethodTrace(record, { ...run, warmup: true }, directory), /frozen raw inventory/u);
});

test('accepted gate rejects missing counterparts and changed frozen budgets', async () => {
  const frozen = JSON.parse(await readFile(new URL('../baseline.json', import.meta.url), 'utf8'));
  const timing = [{ methodVersion: 'FA-V2', measurementPurpose: 'timing' }];
  await assert.rejects(gate.evaluateAcceptedEvidence(frozen, timing, '/tmp'), /counterpart/);
  await assert.rejects(gate.evaluateAcceptedEvidence({ ...frozen, policy: { ...frozen.policy, minimumRuns: 4 } },
    timing, '/tmp'), /baseline mutation/);
});

test('pair identity freezes stimuli but permits separate native configuration and product locators', () => {
  const native = { ...methodConfig, measurementPurpose: 'native-conformance', nativeLifetime: { enabled: true, python: '/python' } };
  assert.equal(pairStimuliIdentity(methodConfig), pairStimuliIdentity(native));
  assert.equal(pairStimuliIdentity(methodConfig), pairStimuliIdentity({ ...methodConfig, pairPhase: 'after' }));
  assert.notEqual(pairStimuliIdentity(methodConfig), pairStimuliIdentity({ ...methodConfig, interactions: [] }));
});

test('RE-A01 classification preserves full identities and requires separate source authentication', () => {
  const edit = { file: 'src/document.ts', reload: true, from: 'Editor login', to: 'Editor login changed',
    path: '/login', selector: 'h1', expectedText: 'Editor login changed' };
  const before = { ...methodConfig, measurementKind: 'development',
    dev: { fluo: { edits: { 'react-edit': edit } } } };
  const after = { ...before, pairPhase: 'after',
    dev: { fluo: { edits: { 'react-edit': { ...edit, file: 'src/catalog-destination.tsx', reload: false } } } } };
  assert.notEqual(pairStimuliIdentity(before), pairStimuliIdentity(after));
  assert.equal(pairStimuliComparison(before, after), 'react-edit-source-relation-required');
  assert.equal(pairStimuliComparison(before, { ...before, pairPhase: 'after' }), 'identical');
  assert.equal(pairStimuliComparison({ ...before, measurementKind: 'production' },
    { ...after, measurementKind: 'production' }), 'mismatch');
  assert.equal(pairStimuliComparison(after, before), 'mismatch');
  for (const change of [
    { reload: true }, { file: 'src/other.tsx' }, { from: 'Other' },
    { expectedText: 'Other' }, { restartPattern: 'READY' }, { explicitReload: false },
  ]) {
    const altered = structuredClone(after);
    Object.assign(altered.dev.fluo.edits['react-edit'], change);
    assert.equal(pairStimuliComparison(before, altered), 'mismatch');
  }
  const nativeAfter = { ...after, measurementPurpose: 'native-conformance', nativeLifetime: { enabled: true, python: '/python' } };
  assert.equal(pairStimuliComparison(before, nativeAfter), 'mismatch');
  assert.notEqual(hashObject(before), hashObject(after));
  assert.notEqual(environmentConfigIdentity(before), environmentConfigIdentity({ ...before, pairPhase: 'after' }));
});

test('real gate CLI rejects unversioned evidence rather than replaying it as acceptance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const receipt = join(directory, 'historical.json');
  await writeFile(receipt, JSON.stringify({ profile: 'desktop-native', mode: 'native', runs: [] }));
  await assert.rejects(promisify(execFile)(process.execPath, [
    new URL('../src/gate.mjs', import.meta.url).pathname, '--baseline',
    new URL('../baseline.json', import.meta.url).pathname, '--output', join(directory, 'result.json'),
    '--trace-root', directory, receipt,
  ]), (error) => error.code === 1 && /FA-V2 timing receipts required/u.test(error.stderr));
});

test('real gate CLI rejects historical evidence mixed with versioned timing instead of filtering it out', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fa-v2-mixed-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const historical = join(directory, 'historical.json');
  const timing = join(directory, 'timing.json');
  await writeFile(historical, JSON.stringify({ profile: 'desktop-native', mode: 'native', runs: [] }));
  await writeFile(timing, JSON.stringify({ methodVersion: 'FA-V2', measurementPurpose: 'timing' }));
  await assert.rejects(promisify(execFile)(process.execPath, [
    new URL('../src/gate.mjs', import.meta.url).pathname, '--baseline',
    new URL('../baseline.json', import.meta.url).pathname, '--output', join(directory, 'result.json'),
    '--trace-root', directory, timing, historical,
  ]), (error) => error.code === 1 && /mixed historical/u.test(error.stderr));
});

test('throughput peers use extrema in the higher-is-better direction including zero', () => {
  for (const [fluo, peer, verdict] of [
    [[100, 100, 100, 100, 100], [150, 150, 150, 150, 150], 'pass'],
    [[100, 100, 100, 100, 100], [150.00000000000003, 150.00000000000003, 150.00000000000003, 150.00000000000003, 150.00000000000003], 'fail'],
    [[100, 110, 120, 130, 140], [160, 160, 160, 160, 160], 'inconclusive'],
    [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 'pass'],
  ]) {
    const result = evaluator.evaluateObservedRanges(baseline, samples('throughputRequestsPerSecond', fluo, peer));
    assert.equal(result.checks.find((check) => check.framework === 'next'
      && check.metric === 'throughputRequestsPerSecond').verdict, verdict);
  }
});
