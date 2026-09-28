import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { METRICS as EVALUATOR_METRICS } from '../src/evaluate.ts';
import { createBrowserDriver } from '../src/measure-browser.mjs';
import { collectDevMeasurements, collectMeasurements, mergeEvidence, planMeasurements, PROFILES, verifyTraceFiles } from '../src/measure.mjs';

const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
const config = {
  profile: 'desktop-matched-cache',
  mode: 'matched-cache',
  warmupRuns: 1,
  measurementRuns: 3,
  apps: Object.fromEntries(frameworks.map((framework) => [framework, `http://127.0.0.1/${framework}`])),
  provenance: { browser: 'Chromium pinned', runtime: 'Node pinned', builds: { fluo: 'build command' }, lockfile: 'sha256:abc', dataset: 'fixture-v1' },
};

test('alternates all four frameworks across warmup and independent samples', () => {
  // Given: one warmup and three measured cycles.
  // When
  const plan = planMeasurements(config);
  // Then: a rotated order prevents the same app from always running first.
  assert.deepEqual(plan.map((item) => `${item.framework}:${item.warmup}`), [
    'fluo:true', 'next:true', 'react-router:true', 'tanstack-start:true',
    'next:false', 'react-router:false', 'tanstack-start:false', 'fluo:false',
    'react-router:false', 'tanstack-start:false', 'fluo:false', 'next:false',
    'tanstack-start:false', 'fluo:false', 'next:false', 'react-router:false',
  ]);
  assert.equal(new Set(plan.filter((item) => !item.warmup).map((item) => item.runId)).size, 12);
  assert.equal(PROFILES.desktop.cpuSlowdown, 1);
  assert.ok(PROFILES.tablet.cpuSlowdown > 1);
});

test('browser emulation matches the committed desktop and tablet baseline', async () => {
  // Given: baseline network rates are kilobits per second.
  const baseline = JSON.parse(await readFile(new URL('../baseline.json', import.meta.url), 'utf8'));
  // When / Then: CDP expects bytes per second, not kilobits per second.
  for (const [device, mode] of [['desktop', 'native'], ['tablet', 'matched-cache']]) {
    const expected = baseline.profiles[`${device}-${mode}`];
    assert.equal(PROFILES[device].cpuSlowdown, expected.cpuSlowdown);
    assert.equal(PROFILES[device].latencyMs, expected.network.latencyMs);
    assert.equal(PROFILES[device].downloadBytesPerSecond, expected.network.downloadKbps * 125);
    assert.equal(PROFILES[device].uploadBytesPerSecond, expected.network.uploadKbps * 125);
    assert.ok(expected.viewport.width > 0 && expected.viewport.height > 0);
    assert.deepEqual(PROFILES[device].viewport, expected.viewport);
  }
});

test('the raw measurement metric vocabulary matches the evaluator', async () => {
  // Given: the evaluator owns the machine-consumed metric contract.
  const { METRICS } = await import('../src/measure.mjs');
  // When / Then: drift cannot leave an evaluator metric unreported silently.
  assert.deepEqual(METRICS, EVALUATOR_METRICS);
});

test('production correctness remains mandatory when development measurements are configured', async () => {
  // Given: development commands exist but the production journeys do not.
  // When / Then: a production run cannot be replaced by a development ready event.
  await assert.rejects(createBrowserDriver({ ...config, dev: {} }, { devMode: false }), /journeys/);
});

test('checks correctness before timing and retains failed-run evidence', async () => {
  // Given: the first framework fails its correctness journey.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  const calls = [];
  try {
    // When
    const result = await collectMeasurements(config, {
      async check(item) { calls.push(`check:${item.framework}`); return { pass: item.framework !== 'fluo', steps: ['listing', 'auth'] }; },
      async measure(item) { calls.push(`measure:${item.framework}`); return { metrics: { coldTtfbMs: 25 }, requests: [] }; },
    }, directory);
    // Then: failure is recorded but never timed, including during warmup.
    assert.ok(!calls.includes('measure:fluo'));
    assert.equal(result.runs.length, 12);
    assert.equal(result.runs[0].warmupRuns, 1);
    assert.ok(result.runs.filter((run) => run.framework === 'fluo').every((run) => run.correctness === 'fail' && Object.keys(run.metrics).length === 0));
    const trace = JSON.parse(await readFile(result.runs.find((run) => run.framework === 'fluo').trace, 'utf8'));
    assert.equal(trace.correctness.pass, false);
    assert.equal(trace.provenance.lockfile, 'sha256:abc');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing observations stay unavailable and cannot become zero-valued metrics', async () => {
  // Given: a driver only reports a measured TTFB.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    // When
    const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: ['listing'] }; },
      async measure() { return { metrics: { coldTtfbMs: 42 }, unavailable: { lcpMs: 'browser did not emit LCP' }, requests: [] }; },
    }, directory);
    // Then: evaluator sees absent values; trace preserves why.
    assert.equal(result.runs[0].metrics.coldTtfbMs, 42);
    assert.equal(Object.hasOwn(result.runs[0].metrics, 'lcpMs'), false);
    const trace = JSON.parse(await readFile(result.runs[0].trace, 'utf8'));
    assert.equal(trace.unavailable.lcpMs, 'browser did not emit LCP');
    assert.equal(trace.unavailable.devColdReadyMs, 'not measured in production-browser mode');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects invalid profiles and forged non-finite metrics before saving traces', async () => {
  // Given: unsupported profile and a non-finite timing.
  assert.throws(() => planMeasurements({ ...config, profile: 'phone' }), /profile/);
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    // When / Then
    await assert.rejects(collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: [] }; },
      async measure() { return { metrics: { lcpMs: Number.NaN } }; },
    }, directory), /lcpMs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('development readiness and edit visibility use separate raw runs', async () => {
  // Given: an observed ready event and separate React, CSS, and server edits.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  const events = [];
  try {
    // When
    const result = await collectDevMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { events.push('check'); return { pass: true, steps: ['dev-start'] }; },
      async restartDev() { events.push('restart'); return { pass: true, steps: ['fresh-dev-start'] }; },
      async measureDev(_item, _config, kind) { events.push(kind); return { durationMs: 25, event: `${kind}-visible` }; },
    }, directory);
    // Then: edit-to-visible timings are not conflated with production navigation.
    assert.deepEqual(events, Array.from({ length: 4 }, () => [
      'check', 'cold-ready', 'restart', 'react-edit',
      'restart', 'css-edit', 'restart', 'server-edit',
    ]).flat());
    assert.equal(result.runs[0].metrics.devReactEditVisibleMs, 25);
    assert.equal(Object.hasOwn(result.runs[0].metrics, 'coldTtfbMs'), false);
    assert.deepEqual(Object.keys((JSON.parse(await readFile(result.runs[0].trace, 'utf8'))).timings),
      ['cold-ready', 'react-edit-ready', 'react-edit', 'css-edit-ready', 'css-edit',
        'server-edit-ready', 'server-edit']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('development closes each completed app before the next cycle reuses its port', async () => {
  // Given: a run uses one owned dev server and the next cycle must use its port.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  const active = new Set();
  const released = [];
  try {
    // When: a warmup and a measured cycle visit every app twice.
    await collectDevMeasurements({ ...config, warmupRuns: 1, measurementRuns: 1 }, {
      async check(item) {
        assert.equal(active.has(item.framework), false, `port already owned by ${item.framework}`);
        active.add(item.framework);
        return { pass: true, steps: ['ready'] };
      },
      async measureDev(_item, _config, kind) { return { durationMs: 25, event: `${kind}-visible` }; },
      async closeDev(item) {
        assert.equal(active.delete(item.framework), true);
        released.push(item.framework);
      },
    }, directory);
    // Then: no server remains at the end of the repeated measurement.
    assert.equal(active.size, 0);
    assert.equal(released.length, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('combines matching production and development evidence without inventing values', async () => {
  // Given: a production sample and independently traced development sample.
  const production = { runs: [{ framework: 'fluo', runId: 'r-1', profile: 'desktop-native', mode: 'native',
    warmupRuns: 1, correctness: 'pass', trace: '/tmp/production.json', metrics: { lcpMs: 12 } }] };
  const development = { runs: [{ ...production.runs[0], trace: '/tmp/dev.json', metrics: { devColdReadyMs: 30 } }] };
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    // When
    const result = await mergeEvidence(production, development, directory);
    // Then
    assert.deepEqual(result.runs[0].metrics, { lcpMs: 12, devColdReadyMs: 30 });
    assert.equal(Object.hasOwn(result.runs[0].metrics, 'rssBytes'), false);
    assert.deepEqual(JSON.parse(await readFile(result.runs[0].trace, 'utf8')).sourceTraces,
      ['/tmp/production.json', '/tmp/dev.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('gate rejects missing, escaped, and incomplete raw traces', async () => {
  // Given: a good local trace and invalid trace references.
  const directory = await mkdtemp(join(tmpdir(), 'fluo-measure-'));
  try {
    const result = await collectMeasurements({ ...config, warmupRuns: 0, measurementRuns: 1 }, {
      async check() { return { pass: true, steps: [] }; },
      async measure() { return { metrics: { coldTtfbMs: 10 } }; },
    }, directory);
    // When / Then: real trace resolves but a missing or escaped path never does.
    await verifyTraceFiles(result.runs, directory);
    await assert.rejects(verifyTraceFiles([{ ...result.runs[0], trace: join(directory, 'missing.json') }], directory), /trace/);
    await assert.rejects(verifyTraceFiles([{ ...result.runs[0], trace: '/tmp/outside.json' }], directory), /trace/);
    const broken = join(directory, 'incomplete.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(broken, '{"schemaVersion":1}'));
    await assert.rejects(verifyTraceFiles([{ ...result.runs[0], trace: broken }], directory), /trace/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
