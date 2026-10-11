import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { AAInputFailure, BLOCKS, object, sha256 } from '../results/issue-3914/paired-aa.mjs';
import { digestFile, launchCollector, sequenceRuns } from '../results/issue-3914/paired-ab.mjs';
import { evaluateNode, frozenNodePlan, validateNodeProtocol } from '../results/issue-3914/paired-node.mjs';
import type { EvidenceFixture } from './fixtures/paired-node-evidence.mjs';
import { evidenceFixture, planFixture, protocolFixture } from './fixtures/paired-node-evidence.mjs';

for (const platform of ['nodejs', 'fastify', 'express'] as const) {
  for (const mode of ['calibration', 'candidate'] as const) {
    test(`evaluateNode: ${platform} ${mode} authentic evidence -> scoped verdict without mutation`, () => {
      const plan = planFixture(platform, mode);
      const evidence = evidenceFixture(plan);
      const before = JSON.stringify(evidence);

      const result = evaluateNode(plan, evidence);

      assert.equal(result.verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE');
      assert.equal(JSON.stringify(evidence), before);
      validateNodeProtocol(protocolFixture(plan), plan);
      const frozen = frozenNodePlan(plan);
      assert.equal(frozen.mode, mode);
      assert.equal(frozen.condition?.platform, platform);
      assert.equal(frozen.arms.X.packagesTree === frozen.arms.Y.packagesTree, mode === 'calibration');
    });
  }
}

for (const [name, mutate] of [
  ['bun-runtime', (e: EvidenceFixture) => { Object.assign(e.records[0].raw.servingIdentity.runtime, { bun: '1.4.2' }); }],
  ['only-bun-runtime', (e: EvidenceFixture) => { Reflect.deleteProperty(e.records[0].raw.servingIdentity.runtime, 'node'); }],
  ['other-node', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.runtime.node = '24.20.0'; }],
  ['v-prefixed-node', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.runtime.node = 'v24.21.0'; }],
  ['bun-label', (e: EvidenceFixture) => { e.records[0].raw.label = 'native-bun'; }],
  ['other-platform', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.target = 'native-fastify'; }],
  ['other-product', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.target = 'nestjs-nodejs'; }],
  ['wrong-executable', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.executableSha256 = sha256('other'); }],
  ['wrong-source', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.source.gitHead = e.records[1].raw.servingIdentity.source.gitHead; }],
  ['dirty-source', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.source.gitStatus = ' M server'; }],
  ['wrong-harness', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.source.benchmarkSourceSha256 = sha256('other'); }],
  ['wrong-build', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.artifactsSha256 = e.records[1].raw.servingIdentity.artifactsSha256; }],
  ['changed-artifact', (e: EvidenceFixture) => { Object.assign(e.records[0].raw.servingIdentity.artifacts, { '/unfrozen': sha256('other') }); }],
  ['unauthenticated', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.status = 'prepared'; }],
  ['instrumented', (e: EvidenceFixture) => { e.records[0].raw.servingIdentity.instrumentation = 'diagnostic'; }],
  ['wrong-condition', (e: EvidenceFixture) => { Object.assign(e.records[0].condition, { platform: 'bun' }); }],
  ['wrong-cwd', (e: EvidenceFixture) => { e.records[2].cwd = e.records[1].cwd; }],
  ['changed-plan', (e: EvidenceFixture) => { e.planSha256 = sha256('changed'); }],
  ['missing', (e: EvidenceFixture) => { e.records.pop(); }],
  ['missing-all', (e: EvidenceFixture) => { e.records.length = 0; }],
  ['duplicate', (e: EvidenceFixture) => { e.records[1] = e.records[0]; }],
  ['overlap', (e: EvidenceFixture) => { e.records[1].startedMs = e.records[0].endedMs - 1; }],
  ['interruption', (e: EvidenceFixture) => { e.invalidAttempts.push({ interrupted: true }); }],
  ['nonzero', (e: EvidenceFixture) => { e.records[0].child.exitCode = 17; }],
  ['signal', (e: EvidenceFixture) => { e.records[0].child.signal = 'SIGTERM'; }],
  ['timeout', (e: EvidenceFixture) => { e.records[0].child.timedOut = true; }],
  ['child-error', (e: EvidenceFixture) => { e.records[0].child.error = 'failed'; }],
  ['reused-collector', (e: EvidenceFixture) => { e.records[1].child.pid = e.records[0].child.pid; }],
  ['reused-server', (e: EvidenceFixture) => { e.records[1].raw.servingIdentity.pid = e.records[0].raw.servingIdentity.pid; }],
  ['reused-generator', (e: EvidenceFixture) => { e.records[1].raw.generator.pid = e.records[0].raw.generator.pid; }],
  ['generator-continuity', (e: EvidenceFixture) => { e.records[0].raw.warmup.generator.nonce = 'wrong'; }],
  ['cold-generator', (e: EvidenceFixture) => { e.records[0].raw.coldStart.firstRequest.generator.pid += 1; }],
  ['sampler-alias', (e: EvidenceFixture) => { e.records[0].child.pid = e.records[0].raw.generator.pid; }],
  ['sampler-in-tree', (e: EvidenceFixture) => { e.records[0].raw.server.samples[0].processes.push({ pid: e.records[0].child.pid, cpuSeconds: 0, rssKiB: 1 }); }],
  ['generator-in-tree', (e: EvidenceFixture) => { e.records[0].raw.server.samples[0].processes.push({ pid: e.records[0].raw.generator.pid, cpuSeconds: 0, rssKiB: 1 }); }],
  ['cold-error', (e: EvidenceFixture) => { e.records[0].raw.coldStart.firstRequest.result.errors = 1; }],
  ['warmup-error', (e: EvidenceFixture) => { e.records[0].raw.warmup.result.errors = 1; }],
  ['measurement-error', (e: EvidenceFixture) => { e.records[0].raw.result.errors = 1; }],
  ['short-warmup', (e: EvidenceFixture) => { e.records[0].raw.warmup.result.duration = 29; }],
  ['short-measurement', (e: EvidenceFixture) => { e.records[0].raw.result.duration = 59; }],
  ['histogram-count', (e: EvidenceFixture) => { e.records[0].raw.latencyHistogramMicros[0][1] -= 1; }],
  ['duplicate-bucket', (e: EvidenceFixture) => { e.records[0].raw.latencyHistogramMicros.push([1_000, 1]); }],
  ['cpu-corruption', (e: EvidenceFixture) => { e.records[0].raw.server.cpuSeconds += 1; }],
  ['rss-corruption', (e: EvidenceFixture) => { e.records[0].raw.server.peakRssBytes += 1; }],
] as const) {
  test(`evaluateNode: ${name} -> evidence fails closed`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    mutate(evidence);

    const result = evaluateNode(plan, evidence);

    assert.equal(result.verdict, 'FAIL_EVIDENCE');
  });
}

for (const [name, mutate] of [
  ['draft', (p: ReturnType<typeof planFixture>) => { p.status = 'DRAFT'; }],
  ['bun-platform', (p: ReturnType<typeof planFixture>) => { Object.assign(p.condition, { platform: 'bun' }); }],
  ['next-platform', (p: ReturnType<typeof planFixture>) => { Object.assign(p.condition, { platform: 'nextjs' }); }],
  ['other-version', (p: ReturnType<typeof planFixture>) => { Object.assign(p.condition, { runtimeVersion: '24.20.0' }); }],
  ['missing-mode', (p: ReturnType<typeof planFixture>) => { Reflect.deleteProperty(p, 'mode'); }],
  ['implicit-mode', (p: ReturnType<typeof planFixture>) => { Object.assign(p, { mode: 'aa' }); }],
  ['finite-duration', (p: ReturnType<typeof planFixture>) => { Object.assign(p.condition, { measureSeconds: 1 }); }],
  ['lower-count', (p: ReturnType<typeof planFixture>) => { Object.assign(p.condition, { minimumCompletedRequests: 3 }); }],
  ['repeats', (p: ReturnType<typeof planFixture>) => { p.automaticAdditionalRepeats = 1; }],
  ['missing-orchestrator', (p: ReturnType<typeof planFixture>) => { Reflect.deleteProperty(p.freeze, 'orchestratorSha256'); }],
  ['different-baseline-tree', (p: ReturnType<typeof planFixture>) => { p.arms.N.packagesTree = '7'.repeat(40); }],
  ['same-candidate', (p: ReturnType<typeof planFixture>) => { p.arms.Y.packagesTree = p.arms.X.packagesTree; }],
  ['missing-lock', (p: ReturnType<typeof planFixture>) => { delete p.arms.Y.artifacts[`${p.arms.Y.cwd}/pnpm-lock.yaml`]; }],
  ['other-generator-runtime', (p: ReturnType<typeof planFixture>) => { p.freeze.generator.node = 'v24.20.0'; }],
  ['other-generator-executable', (p: ReturnType<typeof planFixture>) => { p.freeze.generator.executable = '/prepared/other-node'; }],
] as const) {
  test(`frozenNodePlan: ${name} -> rejects unsupported plan`, () => {
    const plan = structuredClone(planFixture());
    mutate(plan);

    assert.throws(() => frozenNodePlan(plan), AAInputFailure);
    assert.equal(evaluateNode(plan, evidenceFixture(plan)).verdict, 'FAIL_EVIDENCE');
  });
}

test('frozenNodePlan: calibration with candidate source -> refuses cross-source calibration', () => {
  const plan = planFixture('express', 'calibration');
  plan.arms.Y.frameworkSource = '7'.repeat(40);

  assert.throws(() => frozenNodePlan(plan), AAInputFailure);
});

test('frozenNodePlan: calibration changed build -> refuses same-code mismatch', () => {
  const plan = planFixture('fastify', 'calibration');
  plan.arms.Y.targetArtifactsSha256 = sha256('different');

  assert.throws(() => frozenNodePlan(plan), AAInputFailure);
});

for (const [name, mutate] of [
  ['bun-PASS', (p: ReturnType<typeof protocolFixture>) => { Object.assign(p.calibration.condition, { platform: 'bun', runtimeVersion: '1.4.2' }); }],
  ['other-Node-platform', (p: ReturnType<typeof protocolFixture>) => { Object.assign(p.calibration.condition, { platform: 'express' }); }],
  ['other-Node-version', (p: ReturnType<typeof protocolFixture>) => { Object.assign(p.calibration.condition, { runtimeVersion: '24.20.0' }); }],
  ['candidate-as-calibration', (p: ReturnType<typeof protocolFixture>) => { p.calibration.mode = 'candidate'; }],
  ['inconclusive-calibration', (p: ReturnType<typeof protocolFixture>) => { p.calibration.verdict = 'INCONCLUSIVE'; }],
  ['other-calibration-tree', (p: ReturnType<typeof protocolFixture>) => { p.calibration.packagesTree = '7'.repeat(40); }],
  ['draft-protocol', (p: ReturnType<typeof protocolFixture>) => { p.status = 'DRAFT'; }],
] as const) {
  test(`validateNodeProtocol: ${name} -> refuses calibration contamination`, () => {
    const plan = planFixture();
    const protocol = structuredClone(protocolFixture(plan));
    mutate(protocol);

    assert.throws(() => validateNodeProtocol(protocol, plan), AAInputFailure);
  });
}

for (const cause of ['requests', 'precision'] as const) {
  test(`evaluateNode: insufficient ${cause} -> inconclusive rather than PASS`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    if (cause === 'requests') {
      evidence.records[0].raw.result.requests.total = 19_999;
      evidence.records[0].raw.latencyHistogramMicros[0][1] = 19_999;
    } else evidence.records[0].raw.server.cpuTimeResolutionSeconds = 1;

    const result = evaluateNode(plan, evidence);

    assert.equal(result.verdict, 'INCONCLUSIVE');
  });
}

for (const metric of ['throughput', 'cpu', 'latency', 'rss'] as const) {
  test(`evaluateNode: stable ${metric} regression -> every pair and median budget retained`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    for (const row of evidence.records.filter((row) => row.arm === 'Y')) {
      if (metric === 'throughput') row.raw.result.requests.average *= 0.9;
      if (metric === 'cpu') {
        row.raw.server.cpuSeconds *= 1.1;
        for (const sample of row.raw.server.samples) for (const process of sample.processes) process.cpuSeconds *= 1.1;
      }
      if (metric === 'latency') row.raw.latencyHistogramMicros[0][0] *= 1.2;
      if (metric === 'rss') {
        row.raw.server.peakRssBytes *= 2;
        for (const sample of row.raw.server.samples) sample.processes[0].rssKiB *= 2;
      }
    }

    const result = evaluateNode(plan, evidence);

    assert.equal(result.verdict, 'FAIL_BUDGET');
    assert.equal(result.budgetBreaches.length, metric === 'latency' ? 8 : 4);
    assert.ok(result.budgetBreaches.some((breach) => breach.observation === 'median'));
    for (let i = 0; i < 3; i++) assert.ok(result.budgetBreaches.some((breach) => breach.observation === `pair-${i}`));
  });
}

for (const drift of ['native', 'paired'] as const) {
  test(`evaluateNode: ${drift} CV exceeds unchanged bound -> inconclusive`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    evidence.records[drift === 'native' ? 3 : 2].raw.result.requests.average *= 1.2;

    const result = evaluateNode(plan, evidence);

    assert.equal(result.verdict, 'INCONCLUSIVE');
    assert.ok(result.inconclusive.length > 0);
  });
}

let directory: string;
let generatorEntry: string;
const cwd = fileURLToPath(new URL('../', import.meta.url));
const childEntry = fileURLToPath(new URL('./fixtures/paired-node-child.mts', import.meta.url));
const collector = fileURLToPath(new URL('../results/issue-3914/paired-node.mts', import.meta.url));
before(async () => {
  directory = await mkdtemp(join(cwd, 'results/issue-3914/paired-node-check-'));
  generatorEntry = join(directory, 'load-client.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/load-client.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: generatorEntry,
  });
});

test('digestFile: changed Node build artifact -> rejects immutable bytes', async () => {
  const path = join(directory, 'changed-build');
  await writeFile(path, 'changed');

  await assert.rejects(digestFile(path, sha256('frozen'), 'Node build'), AAInputFailure);
});

test('sequenceRuns: finite real HTTP Node children -> fixed order and isolated continuous generators', {
  // Each of the 12 sequential children retains its 20s deadline and 5s teardown.
  // The parent watchdog must accommodate those bounds on slower supported hosts.
  timeout: BLOCKS.flat().length * (20_000 + 5_000) + 10_000,
}, async () => {
  const output = join(directory, 'finite');
  await mkdir(output);
  const subject = { platform: 'nodejs', mode: 'calibration' } as const;

  const evidence = await sequenceRuns(output, async (ordinal, arm, prefix) => {
    const payloadPath = `${prefix}.child.json`;
    const child = await launchCollector(process.execPath, [
      '--import', 'tsx', childEntry, 'finite', payloadPath, String(ordinal), arm, generatorEntry,
    ], cwd, prefix, { ...process.env, BENCH_LOAD_PROCESS: '1', BENCH_WARMUP_SEC: '1', BENCH_MEASURE_SEC: '1' }, 20_000);
    return { child, cwd, payload: JSON.parse(await readFile(payloadPath, 'utf8')) };
  }, subject);

  assert.equal(evidence.records.length, 12);
  const rows = evidence.records.map(object);
  assert.deepEqual(rows.map((row) => row.arm), BLOCKS.flat());
  assert.equal(new Set(rows.map((row) => object(object(row.raw).generator).pid)).size, 12);
  assert.equal(new Set(rows.map((row) => object(row.child).pid)).size, 12);
  for (const row of rows) {
    const raw = object(row.raw);
    assert.deepEqual(object(raw.warmup).generator, raw.generator);
    assert.deepEqual(object(object(raw.coldStart).firstRequest).generator, raw.generator);
    const server = object(raw.servingIdentity);
    assert.equal(object(server.runtime).node, process.versions.node);
    assert.notEqual(object(raw.generator).pid, server.pid);
    assert.notEqual(object(row.child).pid, server.pid);
    assert.notEqual(object(row.child).pid, object(raw.generator).pid);
    const prefix = join(output, `run-${row.ordinal}-${row.arm}`);
    assert.deepEqual(JSON.parse(await readFile(`${prefix}.exit.json`, 'utf8')), row.child);
    await readFile(`${prefix}.stdout.log`);
    await readFile(`${prefix}.stderr.log`);
    const phases = object(JSON.parse(await readFile(`${prefix}.child.json.phases.json`, 'utf8')));
    assert.deepEqual(phases.invalidAttempts, []);
  }
});

test('sequenceRuns: early Node collector exit -> preserves diagnostics and stops without repeat', async () => {
  const output = join(directory, 'early-exit');
  await mkdir(output);

  await assert.rejects(sequenceRuns(output, async (ordinal, arm, prefix) => ({
    child: await launchCollector(process.execPath, ['--import', 'tsx', childEntry, 'exit'], cwd, prefix, process.env),
    payload: null, cwd,
  }), { platform: 'nodejs', mode: 'candidate' }), AAInputFailure);

  assert.equal(await readFile(join(output, 'run-0-N.stderr.log'), 'utf8'), 'FINITE_COLLECTOR_EARLY_EXIT\n');
  assert.equal(JSON.parse(await readFile(join(output, 'run-0-N.exit.json'), 'utf8')).exitCode, 17);
  const journal = object(JSON.parse(await readFile(join(output, 'parent-journal.json'), 'utf8')));
  assert.equal((journal.attempts as unknown[]).length, 1);
});

test('launchCollector: event-driven Node timeout -> bounded kill retains exact exit receipt', { timeout: 10_000 }, async () => {
  const prefix = join(directory, 'timeout');
  const output = `${prefix}.child.json`;
  const abort = new AbortController();
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const watcher = watch(directory, (_event, filename) => {
      if (filename === 'timeout.child.json.ready') {
        watcher.close();
        clearTimeout(deadline);
        resolveReady();
      }
    });
    const deadline = setTimeout(() => { watcher.close(); rejectReady(new Error('Readiness deadline')); }, 5_000);
  });
  const pending = launchCollector(process.execPath, ['--import', 'tsx', childEntry, 'hang', output, '0', 'N'],
    cwd, prefix, process.env, abort.signal, 100);
  await ready;
  abort.abort();

  const result = await pending;

  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
  assert.deepEqual(JSON.parse(await readFile(`${prefix}.exit.json`, 'utf8')), result);
});

test('Node CLI: finite override and diagnostic environment -> fail closed outside fixture', async () => {
  const plan = planFixture();
  const path = join(directory, 'plan.json');
  plan.freeze.planPath = path;
  await writeFile(path, JSON.stringify(plan));

  for (const [name, args, env] of [
    ['finite', ['--plan-only', path, '--amount=1'], process.env],
    ['diagnostic', ['--collect', path, join(directory, 'production')], { ...process.env, BENCH_DIAGNOSTIC_DRIFT: '1' }],
  ] as const) {
    const result = await launchCollector(process.execPath, ['--import', 'tsx', collector, ...args],
      cwd, join(directory, name), env, 5_000);

    assert.equal(result.exitCode, 1);
  }
});
