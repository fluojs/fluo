import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BLOCKS, CONDITION, describePlan, evaluateAA, frozenPlan } from '../results/issue-3914/paired-aa.mjs';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = sha('fixture');
const head = '1'.repeat(40);
const artifacts = { '/prepared/server.js': digest };
const buildHash = sha(JSON.stringify(artifacts));
const cpuPrecision = { method: 'verified-fixture-cpu-counter', resolutionSeconds: 0.001, verified: true };

function plan() {
  return {
    status: 'FROZEN', frameworkSource: '2'.repeat(40), previousPolicySha256: digest,
    condition: CONDITION, blocks: BLOCKS, orderSeed: 'fixture',
    subjects: { N: 'native-bun', X: 'fluo-bun at the same BEFORE source', Y: 'fluo-bun at the same BEFORE source' },
    automaticAdditionalRepeats: 0, outlierDeletionAllowed: false, freshServerPerRun: true,
    maximumCpuQuantizationFraction: 0.01,
    generatorLifetime: 'one-local-session-per-server-run',
    maxCv: { throughputRps: 0.03, serverCpuMicrosPerRequest: 0.03, p95Ms: 0.05, p99Ms: 0.075, rssBytes: 0.05 },
    ratioLimits: {
      throughputRps: { minimum: 0.95 }, serverCpuMicrosPerRequest: { maximum: 1.05 },
      p95Ms: { maximum: 1.10 }, p99Ms: { maximum: 1.15 }, rssBytes: { maximum: 1.10 },
    },
    freeze: {
      head, collectorSha256: digest, harnessSha256: digest, runtimeExecutableSha256: digest,
      containerIdentity: 'fixture-linux-bun', cpuPrecision, planPath: '/prepared/plan.json',
      outputRoot: '/prepared/unique-output', buildReceipt: { path: '/prepared/build.json', sha256: digest },
      artifacts, targetArtifactsSha256: { N: buildHash, X: buildHash, Y: buildHash },
      generator: { protocol: 'local-session-v1', node: process.version, executable: process.execPath, hostname: 'fixture-host' },
    },
  };
}

function traffic(completed = 20_000, rps = 1_000, latencyMicros = 1_000, duration = 60, connections = 64) {
  return {
    result: { errors: 0, timeouts: 0, non2xx: 0, mismatches: 0, connections, duration, requests: { total: completed, average: rps } },
    statusMismatches: 0, latencyHistogramMicros: [[latencyMicros, completed]],
    // The evaluator must derive percentiles from the histogram, not these unrelated summaries.
    latencyPercentilesMs: { p50: 999, p95: 999, p99: 999 },
  };
}

function evidence() {
  const declared = plan();
  return {
    invalidAttempts: [] as unknown[],
    records: BLOCKS.flatMap((arms, block) => arms.map((arm, slot) => {
      const ordinal = block * 4 + slot;
      const pid = ordinal + 100;
      const generator = { ...declared.freeze.generator, pid: ordinal + 10_000, nonce: `generator-${ordinal}` };
      return {
        ordinal, block, slot, arm, condition: CONDITION, startedMs: ordinal * 100_000 + 1, endedMs: ordinal * 100_000 + 90_001,
        identity: {
          head, frameworkSource: declared.frameworkSource, collectorSha256: digest,
          harnessSha256: digest, buildReceiptSha256: digest, containerIdentity: declared.freeze.containerIdentity,
        },
        raw: {
          ...traffic(), label: arm === 'N' ? 'native-bun' : 'fluo-bun', generator,
          warmup: { ...traffic(10_000, 1_000, 1_000, 30), generator: { ...generator } },
          coldStart: { processToReadyMs: 1, firstRequest: { ...traffic(1, 1, 1_000, 1, 1), generator: { ...generator } } },
          servingIdentity: {
            status: 'authenticated', instrumentation: 'none', target: arm === 'N' ? 'native-bun' : 'fluo-bun',
            pid, launcherPid: pid, nonce: `nonce-${ordinal}`, runtime: { bun: '1.4.2' },
            executableSha256: digest, artifactsSha256: buildHash, artifacts,
            source: { gitHead: head, gitStatus: '', benchmarkSourceSha256: digest },
          },
          server: {
            subject: 'server-process-tree', rootPid: pid, method: cpuPrecision.method, wallSeconds: 60,
            cpuSeconds: 2, cpuTimeResolutionSeconds: cpuPrecision.resolutionSeconds, peakRssBytes: 102_400,
            samples: [
              { wallMs: 1, processes: [{ pid, rssKiB: 100, cpuSeconds: 0 }] },
              { wallMs: 60_001, processes: [{ pid, rssKiB: 100, cpuSeconds: 2 }] },
            ],
          },
        },
      };
    })),
  };
}
type RecordFixture = ReturnType<typeof evidence>['records'][number];
function scale(record: RecordFixture, factor: number) {
  record.raw.result.requests.average *= factor;
  scaleCpu(record, factor);
  record.raw.latencyHistogramMicros[0][0] *= factor;
  record.raw.server.peakRssBytes *= factor;
  for (const sample of record.raw.server.samples) sample.processes[0].rssKiB *= factor;
}
function scaleCpu(record: RecordFixture, factor: number) {
  record.raw.server.cpuSeconds *= factor;
  for (const sample of record.raw.server.samples) {
    for (const process of sample.processes) process.cpuSeconds *= factor;
  }
}

test('evaluateAA: stable paired drifting arms -> passes without arm or global native CV blockers', () => {
  const input = evidence();
  for (const record of input.records) scale(record, [1, 1.2, 1.4][record.block]);

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE');
  assert.ok(result.observations.every((metric) => metric.xCv > 0.03 && metric.globalNativeCv > 0.03));
  assert.ok(result.observations.every((metric) => metric.ratios.every((ratio) => ratio === 1)));
});

test('evaluateAA: within-block native drift -> inconclusive without normalizing budgets', () => {
  const input = evidence();
  scale(input.records[3], 1.2);
  for (const record of input.records.filter((item) => item.arm === 'Y')) scaleCpu(record, 1.1);

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.inconclusive.some((reason) => reason.includes('native block drift')));
  assert.equal(result.budgetBreaches.filter((item) => item.metric === 'serverCpuMicrosPerRequest').length, 4);
});

test('evaluateAA: unstable three paired ratios -> inconclusive with budget observations retained', () => {
  const input = evidence();
  for (const record of input.records.filter((item) => item.arm === 'Y')) record.raw.result.requests.average *= [0.9, 1, 1.1][record.block];

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.inconclusive.includes('throughputRps: paired ratio instability'));
  assert.ok(result.budgetBreaches.some((item) => item.metric === 'throughputRps' && item.observation === 'pair-0'));
});

test('evaluateAA: one stable pair violates budget despite passing median -> fails budget', () => {
  const input = evidence();
  const y = input.records.filter((record) => record.arm === 'Y');
  for (const [i, record] of y.entries()) record.raw.result.requests.average *= [0.94, 0.96, 0.96][i];

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'FAIL_BUDGET');
  const throughput = result.observations.find((item) => item.metric === 'throughputRps');
  assert.ok(throughput && throughput.medianRatio > 0.95 && throughput.ratioCv < 0.03);
  assert.deepEqual(result.budgetBreaches, [{ metric: 'throughputRps', observation: 'pair-0', ratio: 0.94 }]);
});

for (const [name, mutate] of [
  ['missing', (input: ReturnType<typeof evidence>) => { input.records.pop(); }],
  ['duplicate', (input: ReturnType<typeof evidence>) => { input.records[1] = input.records[2]; }],
  ['misordered', (input: ReturnType<typeof evidence>) => { [input.records[1], input.records[2]] = [input.records[2], input.records[1]]; }],
  ['extra', (input: ReturnType<typeof evidence>) => { input.records.push(input.records[0]); }],
  ['overlapping', (input: ReturnType<typeof evidence>) => { input.records[1].startedMs = 2; }],
  ['reused-process', (input: ReturnType<typeof evidence>) => {
    input.records[1].raw.servingIdentity.nonce = input.records[0].raw.servingIdentity.nonce;
  }],
  ['invalid-attempt', (input: ReturnType<typeof evidence>) => { input.invalidAttempts.push({ error: 'interrupted' }); }],
  ['measurement-traffic', (input: ReturnType<typeof evidence>) => { input.records[0].raw.result.errors = 1; }],
  ['warmup-traffic', (input: ReturnType<typeof evidence>) => { input.records[0].raw.warmup.result.mismatches = 1; }],
  ['cold-traffic', (input: ReturnType<typeof evidence>) => { input.records[0].raw.coldStart.firstRequest.statusMismatches = 1; }],
  ['identity', (input: ReturnType<typeof evidence>) => { input.records[0].identity.frameworkSource = head; }],
  ['serving-runtime', (input: ReturnType<typeof evidence>) => { input.records[0].raw.servingIdentity.runtime.bun = '1.4.1'; }],
  ['warmup-generator-restart', (input: ReturnType<typeof evidence>) => { input.records[0].raw.warmup.generator.pid += 100; }],
  ['cold-generator-nonce', (input: ReturnType<typeof evidence>) => { input.records[0].raw.coldStart.firstRequest.generator.nonce = 'other'; }],
  ['generator-runtime', (input: ReturnType<typeof evidence>) => { input.records[0].raw.generator.node = 'other'; }],
  ['generator-server-alias', (input: ReturnType<typeof evidence>) => {
    const row = input.records[0].raw;
    for (const measurement of [row, row.warmup, row.coldStart.firstRequest]) measurement.generator.pid = row.server.rootPid;
  }],
  ['reused-generator', (input: ReturnType<typeof evidence>) => {
    const reused = input.records[0].raw.generator;
    const row = input.records[1].raw;
    for (const measurement of [row, row.warmup, row.coldStart.firstRequest]) measurement.generator = { ...reused };
  }],
  ['dirty-source', (input: ReturnType<typeof evidence>) => { input.records[0].raw.servingIdentity.source.gitStatus = ' M file'; }],
  ['bad-histogram', (input: ReturnType<typeof evidence>) => { input.records[0].raw.latencyHistogramMicros[0][1] -= 1; }],
  ['nonfinite', (input: ReturnType<typeof evidence>) => { input.records[0].raw.result.requests.average = NaN; }],
  ['rss-not-simultaneous', (input: ReturnType<typeof evidence>) => { input.records[0].raw.server.peakRssBytes += 1; }],
  ['short-measurement', (input: ReturnType<typeof evidence>) => { input.records[0].raw.result.duration = 59; }],
  ['short-warmup', (input: ReturnType<typeof evidence>) => { input.records[0].raw.warmup.result.duration = 29; }],
  ['missing-resource-samples', (input: ReturnType<typeof evidence>) => { input.records[0].raw.server.samples.pop(); }],
] as const) {
  test(`evaluateAA: ${name} evidence with insufficient requests -> fails evidence before inconclusive`, () => {
    const input = evidence();
    input.records[0].raw.result.requests.total = 19_000;
    input.records[0].raw.latencyHistogramMicros[0][1] = 19_000;
    mutate(input);

    const result = evaluateAA(plan(), input);

    assert.equal(result.verdict, 'FAIL_EVIDENCE');
    assert.ok(result.evidenceErrors.length > 0);
  });
}

test('evaluateAA: insufficient completions -> inconclusive and budget breaches preserved', () => {
  const input = evidence();
  input.records[0].raw.result.requests.total = 19_999;
  input.records[0].raw.latencyHistogramMicros[0][1] = 19_999;
  for (const record of input.records.filter((item) => item.arm === 'Y')) scaleCpu(record, 1.1);

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.budgetBreaches.length > 0);
});

test('evaluateAA: absent CPU precision -> inconclusive rather than fabricated precision', () => {
  const input = evidence();
  const raw: Record<string, unknown> = input.records[0].raw.server;
  delete raw.cpuTimeResolutionSeconds;

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.inconclusive.some((reason) => reason.includes('CPU precision')));
});

test('evaluateAA: different CPU time resolution -> inconclusive despite integer-looking CPU samples', () => {
  const input = evidence();
  input.records[0].raw.server.cpuTimeResolutionSeconds = 1;

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.ok(result.inconclusive.some((reason) => reason.includes('CPU precision')));
});

test('evaluateAA: elapsed SDK duration exceeds requested duration -> preserves valid evidence', () => {
  const input = evidence();
  for (const record of input.records) {
    record.raw.result.duration = 60.02;
    record.raw.warmup.result.duration = 30.01;
  }

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE');
});

test('evaluateAA: matching but coarse CPU counters -> remains inconclusive', () => {
  const input = evidence();
  const declared = plan();
  declared.freeze.cpuPrecision = { ...cpuPrecision, resolutionSeconds: 1 };
  for (const record of input.records) record.raw.server.cpuTimeResolutionSeconds = 1;

  const result = evaluateAA(declared, input);

  assert.equal(result.verdict, 'INCONCLUSIVE');
});

test('evaluateAA: CPU total contradicts raw counters -> fails evidence', () => {
  const input = evidence();
  for (const record of input.records) record.raw.server.cpuSeconds = 1;

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'FAIL_EVIDENCE');
});

test('evaluateAA: changing simultaneous tree RSS -> uses maximum tree sum rather than sum of per-process maxima', () => {
  const input = evidence();
  for (const record of input.records) {
    const pid = record.raw.server.rootPid;
    record.raw.server.samples = [
      { wallMs: 1, processes: [{ pid, rssKiB: 100, cpuSeconds: 0 }, { pid: pid + 1_000, rssKiB: 150, cpuSeconds: 0 }] },
      { wallMs: 60_001, processes: [{ pid, rssKiB: 200, cpuSeconds: 1 }, { pid: pid + 1_000, rssKiB: 50, cpuSeconds: 1 }] },
    ];
    record.raw.server.peakRssBytes = 250 * 1_024;
  }

  const result = evaluateAA(plan(), input);

  assert.equal(result.verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE');
});

for (const metric of ['serverCpuMicrosPerRequest', 'p95Ms', 'p99Ms', 'rssBytes'] as const) {
  test(`evaluateAA: stable single-pair ${metric} breach -> fails despite passing median`, () => {
    const input = evidence();
    for (const record of input.records.filter((item) => item.arm === 'Y')) {
      const first = record.block === 0;
      switch (metric) {
        case 'serverCpuMicrosPerRequest': scaleCpu(record, first ? 1.051 : 1.049); break;
        case 'p95Ms': record.raw.latencyHistogramMicros = [[first ? 1_101 : 1_099, 19_800], [1_120, 200]]; break;
        case 'p99Ms': record.raw.latencyHistogramMicros = [[1_000, 19_600], [first ? 1_151 : 1_149, 400]]; break;
        case 'rssBytes':
          record.raw.server.peakRssBytes = (first ? 112 : 109) * 1_024;
          for (const sample of record.raw.server.samples) sample.processes[0].rssKiB = first ? 112 : 109;
          break;
      }
    }

    const result = evaluateAA(plan(), input);

    assert.equal(result.verdict, 'FAIL_BUDGET');
    assert.deepEqual(result.budgetBreaches.map((breach) => [breach.metric, breach.observation]), [[metric, 'pair-0']]);
  });
}

test('frozenPlan: draft plan -> rejects execution while allowing plan-only description', () => {
  const input = plan();
  input.status = 'DRAFT_NOT_EXECUTABLE';

  const description = describePlan(input);

  assert.equal(description.status, 'DRAFT_NOT_EXECUTABLE');
  assert.throws(() => frozenPlan(input));
});

test('frozenPlan: different X/Y frozen builds -> rejects collection', () => {
  const input = plan();
  input.freeze.targetArtifactsSha256.Y = sha('different');

  assert.throws(() => frozenPlan(input));
});

test('module import: collection arguments present -> imports without process or network workload', async () => {
  const modulePath = fileURLToPath(new URL('../results/issue-3914/paired-aa.mts', import.meta.url));
  const probe = `
    import * as cp from 'node:child_process';
    import * as fs from 'node:fs';
    import * as net from 'node:net';
    import { syncBuiltinESMExports } from 'node:module';
    const fail = () => { throw new Error('workload during import'); };
    cp.default.spawn = fail; cp.default.execFile = fail; cp.default.exec = fail;
    cp.default.spawnSync = fail; cp.default.execFileSync = fail; cp.default.execSync = fail;
    fs.default.writeFileSync = fail;
    fs.promises.writeFile = fail; fs.promises.mkdir = fail;
    net.default.Server.prototype.listen = fail;
    net.default.Socket.prototype.connect = fail;
    globalThis.fetch = fail;
    syncBuiltinESMExports();
    process.argv = ['node', '/not-the-collector', '--collect', '/missing-plan', '/missing-output'];
    await import(${JSON.stringify(modulePath)});
  `;

  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', probe], {
    timeout: 10_000, env: { ...process.env, TSX_DISABLE_CACHE: '1' },
  });

  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
