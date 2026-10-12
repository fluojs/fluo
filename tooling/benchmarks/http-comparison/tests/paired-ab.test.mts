import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { AAInputFailure, BLOCKS, object, sha256 } from '../results/issue-3914/paired-aa.mjs';
import { collectAB, digestFile, evaluateAB, flushJournalPhases, frozenABPlan, launchCollector, sequenceRuns } from '../results/issue-3914/paired-ab.mjs';
import type { EvidenceFixture } from './fixtures/paired-ab-evidence.mjs';
import { evidenceFixture, planFixture, scaleCpu } from './fixtures/paired-ab-evidence.mjs';

test('evaluateAB: authentic source-specific identities -> passes without raw rewriting', () => {
  const plan = planFixture();
  const evidence = evidenceFixture(plan);
  const original = JSON.stringify(evidence);

  const result = evaluateAB(plan, evidence);

  assert.equal(result.verdict, 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE');
  assert.equal(JSON.stringify(evidence), original);
  assert.notEqual(evidence.records[1].raw.servingIdentity.source.gitHead, evidence.records[2].raw.servingIdentity.source.gitHead);
});

for (const phase of ['cold', 'warmup', 'measurement', 'resource-first', 'resource-last'] as const) {
  for (const [markerName, marker] of [['object', { purpose: 'diagnostic-only' }], ['null', null]] as const) {
    test(`evaluateAB: diagnostic marker ${phase}/${markerName} -> rejects otherwise valid evidence`, () => {
      const plan = planFixture();
      const evidence = evidenceFixture(plan);
      const raw = evidence.records[0].raw;
      const phases = {
        cold: raw.coldStart.firstRequest, warmup: raw.warmup, measurement: raw,
        'resource-first': raw.server.samples[0], 'resource-last': raw.server.samples[1],
      };
      Object.assign(phases[phase], { driftDiagnostic: marker });

      const result = evaluateAB(plan, evidence);

      assert.equal(result.verdict, 'FAIL_EVIDENCE');
    });
  }
}

for (const [name, mutate] of [
  ['wrong-arm', (e: EvidenceFixture) => { e.records[1].arm = 'Y'; }],
  ['wrong-source', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.source.gitHead = e.records[1].raw.servingIdentity.source.gitHead; }],
  ['wrong-build', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.artifactsSha256 = e.records[1].raw.servingIdentity.artifactsSha256; }],
  ['wrong-runtime', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.runtime.bun = '1.4.1'; }],
  ['wrong-target', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.target = 'native-bun'; }],
  ['wrong-cwd', (e: EvidenceFixture) => { e.records[2].cwd = e.records[1].cwd; }],
  ['dirty-head', (e: EvidenceFixture) => { e.records[2].raw.servingIdentity.source.gitStatus = ' M file'; }],
  ['changed-plan', (e: EvidenceFixture) => { e.planSha256 = sha256('other'); }],
  ['missing', (e: EvidenceFixture) => { e.records.pop(); }],
  ['missing-all', (e: EvidenceFixture) => { e.records.length = 0; }],
  ['duplicate', (e: EvidenceFixture) => { e.records[1] = e.records[2]; }],
  ['overlap', (e: EvidenceFixture) => { e.records[1].startedMs = 2; }],
  ['interrupted', (e: EvidenceFixture) => { e.invalidAttempts.push({ interrupted: true }); }],
  ['child-failure', (e: EvidenceFixture) => { e.records[1].child.exitCode = 17; }],
  ['child-signal', (e: EvidenceFixture) => { e.records[1].child.signal = 'SIGTERM'; }],
  ['child-timeout', (e: EvidenceFixture) => { e.records[1].child.timedOut = true; }],
  ['child-error', (e: EvidenceFixture) => { e.records[1].child.error = 'interrupted'; }],
  ['reused-collector', (e: EvidenceFixture) => { e.records[1].child.pid = e.records[0].child.pid; }],
  ['sampler-generator-alias', (e: EvidenceFixture) => { e.records[0].child.pid = e.records[0].raw.generator.pid; }],
  ['sampler-tree-alias', (e: EvidenceFixture) => { e.records[0].raw.server.samples[0].processes.push({ pid: e.records[0].child.pid, rssKiB: 1, cpuSeconds: 0 }); }],
  ['generator-tree-alias', (e: EvidenceFixture) => { e.records[0].raw.server.samples[0].processes.push({ pid: e.records[0].raw.generator.pid, rssKiB: 1, cpuSeconds: 0 }); }],
  ['broken-generator-continuity', (e: EvidenceFixture) => { e.records[1].raw.warmup.generator.nonce = 'other'; }],
  ['failed-warmup', (e: EvidenceFixture) => { e.records[0].raw.warmup.result.errors = 1; }],
  ['short-measurement', (e: EvidenceFixture) => { e.records[0].raw.result.duration = 59; }],
] as const) {
  test(`evaluateAB: ${name} -> rejects evidence`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    mutate(evidence);

    const result = evaluateAB(plan, evidence);

    assert.equal(result.verdict, 'FAIL_EVIDENCE');
    assert.equal(result.evidenceErrors.length, 1);
  });
}

for (const [name, mutate] of [
  ['draft', (p: ReturnType<typeof planFixture>) => { p.status = 'DRAFT'; }],
  ['bad-hash', (p: ReturnType<typeof planFixture>) => { p.freeze.harnessSha256 = 'bad'; }],
  ['different-baseline', (p: ReturnType<typeof planFixture>) => { p.arms.N.packagesTree = '7'.repeat(40); }],
  ['same-candidate', (p: ReturnType<typeof planFixture>) => { p.arms.Y.packagesTree = p.arms.X.packagesTree; }],
  ['weakened-condition', (p: ReturnType<typeof planFixture>) => { Object.assign(p.condition, { measureSeconds: 1 }); }],
  ['missing-lock', (p: ReturnType<typeof planFixture>) => { delete p.arms.Y.artifacts[`${p.arms.Y.cwd}/pnpm-lock.yaml`]; }],
] as const) {
  test(`frozenABPlan: ${name} -> rejects plan`, () => {
    const input = structuredClone(planFixture());
    mutate(input);

    assert.throws(() => frozenABPlan(input), AAInputFailure);
  });
}

for (const metric of ['throughput', 'cpu', 'latency', 'rss'] as const) {
  test(`evaluateAB: stable ${metric} regression -> retains every pair and median breach`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    for (const row of evidence.records.filter((row) => row.arm === 'Y')) {
      if (metric === 'throughput') row.raw.result.requests.average *= 0.9;
      if (metric === 'cpu') scaleCpu(row, 1.1);
      if (metric === 'latency') row.raw.latencyHistogramMicros[0][0] *= 1.2;
      if (metric === 'rss') {
        row.raw.server.peakRssBytes *= 2;
        for (const sample of row.raw.server.samples) sample.processes[0].rssKiB *= 2;
      }
    }

    const result = evaluateAB(plan, evidence);

    assert.equal(result.verdict, 'FAIL_BUDGET');
    assert.equal(result.budgetBreaches.length, metric === 'latency' ? 8 : 4);
  });
}

test('evaluateAB: drift with budget failure -> inconclusive retains breaches', () => {
  const plan = planFixture();
  const evidence = evidenceFixture(plan);
  evidence.records[3].raw.result.requests.average *= 1.2;
  for (const row of evidence.records.filter((row) => row.arm === 'Y')) scaleCpu(row, 1.1);

  const result = evaluateAB(plan, evidence);

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.equal(result.budgetBreaches.length, 4);
});

for (const cause of ['requests', 'precision'] as const) {
  test(`evaluateAB: insufficient ${cause} -> inconclusive`, () => {
    const plan = planFixture();
    const evidence = evidenceFixture(plan);
    if (cause === 'requests') {
      evidence.records[0].raw.result.requests.total = 19_999;
      evidence.records[0].raw.latencyHistogramMicros[0][1] = 19_999;
    } else evidence.records[0].raw.server.cpuTimeResolutionSeconds = 1;

    const result = evaluateAB(plan, evidence);

    assert.equal(result.verdict, 'INCONCLUSIVE');
  });
}

let directory: string;
let generatorEntry: string;
const childEntry = fileURLToPath(new URL('./fixtures/paired-ab-child.mts', import.meta.url));
before(async () => {
  const root = fileURLToPath(new URL('../results/issue-3914/', import.meta.url));
  directory = await mkdtemp(join(root, 'paired-ab-check-'));
  generatorEntry = join(directory, 'load-client.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/load-client.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: generatorEntry,
  });
});
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('digestFile: changed frozen content -> rejects before collection', async () => {
  const path = join(directory, 'changed-artifact');
  await writeFile(path, 'changed');

  await assert.rejects(digestFile(path, sha256('frozen'), 'artifact'), AAInputFailure);
});

test('digestFile: exact frozen content -> verifies original bytes', async () => {
  const path = join(directory, 'valid-artifact');
  await writeFile(path, 'frozen');

  await digestFile(path, sha256('frozen'), 'artifact');
});

test('flushJournalPhases: measurement starts after warmup -> persists completed raw phase before finish', async () => {
  const path = join(directory, 'phase-flush.json');
  const { EvidenceJournal } = await import('../src/evidence');
  const journal: import('../src/evidence').EvidenceJournal = new EvidenceJournal(path, () => ({ current: journal.current }));
  const rawWarmup = { completed: 3, generator: { pid: 321, nonce: 'fixture' } };
  flushJournalPhases(journal);
  try {
    journal.current = { phase: 'measurement', warmup: rawWarmup };

    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      current: { phase: 'measurement', warmup: rawWarmup }, invalidAttempts: [],
    });
  } finally {
    journal.finish();
  }
});

test('sequenceRuns: real finite HTTP children -> fixed order fresh generators and parent timestamps', {
  // Keep the same per-child deadline and teardown budget as the Node suites.
  // The parent must not cancel a valid sequence before all owned children settle.
  timeout: BLOCKS.flat().length * (20_000 + 5_000) + 10_000,
}, async () => {
  const output = join(directory, 'finite');
  await mkdir(output);
  const cwd = fileURLToPath(new URL('../', import.meta.url));

  const evidence = await sequenceRuns(output, async (ordinal, arm, prefix) => {
    const payloadPath = `${prefix}.child.json`;
    const child = await launchCollector(process.execPath, [
      '--import', 'tsx', childEntry, 'finite', payloadPath, String(ordinal), arm, generatorEntry,
    ], cwd, prefix, { ...process.env, BENCH_LOAD_PROCESS: '1', BENCH_WARMUP_SEC: '1', BENCH_MEASURE_SEC: '1' }, 20_000);
    return { child, cwd, payload: JSON.parse(await readFile(payloadPath, 'utf8')) };
  });

  assert.equal(evidence.records.length, 12);
  const rows = evidence.records.map(object);
  assert.deepEqual(rows.map((row) => row.arm), ['N', 'X', 'Y', 'N', 'N', 'Y', 'X', 'N', 'N', 'X', 'Y', 'N']);
  const generators = rows.map((row) => object(object(row.raw).generator));
  assert.equal(new Set(generators.map((generator) => generator.pid)).size, 12);
  assert.equal(new Set(rows.map((row) => object(row.child).pid)).size, 12);
  for (const [index, row] of rows.entries()) {
    const raw = object(row.raw);
    assert.deepEqual(object(raw.warmup).generator, raw.generator);
    assert.deepEqual(object(object(raw.coldStart).firstRequest).generator, raw.generator);
    assert.equal(object(object(raw.result).requests).total, 3);
    assert.notEqual(object(row.child).pid, object(raw.generator).pid);
    assert.notEqual(object(row.child).pid, object(raw.servingIdentity).pid);
    for (const pid of [object(row.child).pid, object(raw.generator).pid, object(raw.servingIdentity).pid]) {
      assert.equal(typeof pid, 'number');
      if (typeof pid === 'number') assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
    if (index > 0) assert.ok(Number(row.startedMs) >= Number(rows[index - 1].endedMs));
  }
});

test('sequenceRuns: early child exit -> preserves status diagnostics and stops without retry', { timeout: 10_000 }, async () => {
  const output = join(directory, 'failure');
  await mkdir(output);
  let count = 0;

  await assert.rejects(sequenceRuns(output, async (ordinal, arm, prefix) => {
    count += 1;
    const child = await launchCollector(process.execPath, [
      '--import', 'tsx', childEntry, 'exit', `${prefix}.child.json`, String(ordinal), arm,
    ], fileURLToPath(new URL('../', import.meta.url)), prefix, process.env, 5_000);
    return { child, payload: null, cwd: output };
  }), AAInputFailure);

  assert.equal(count, 1);
  const attempt = JSON.parse(await readFile(join(output, 'run-0-N.parent.json'), 'utf8'));
  assert.equal(attempt.child.exitCode, 17);
  assert.deepEqual(JSON.parse(await readFile(join(output, 'run-0-N.exit.json'), 'utf8')), attempt.child);
  assert.match(await readFile(join(output, 'run-0-N.stderr.log'), 'utf8'), /FINITE_COLLECTOR_EARLY_EXIT/);
  const journal = JSON.parse(await readFile(join(output, 'parent-journal.json'), 'utf8'));
  assert.equal(journal.invalidAttempts.length, 1);
  assert.equal(journal.records.length, 0);
});

test('launchCollector: unresponsive HTTP child -> deadline kills owned group', { timeout: 15_000 }, async () => {
  const prefix = join(directory, 'timeout');
  const output = `${prefix}.child.json`;
  const deadlineSignal = new AbortController();
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const watcher = watch(directory, (_event, filename) => {
      if (filename === 'timeout.child.json.ready') { watcher.close(); clearTimeout(deadline); resolveReady(); }
    });
    const deadline = setTimeout(() => { watcher.close(); rejectReady(new Error('Fixture readiness deadline')); }, 5_000);
  });
  const running = launchCollector(process.execPath, [
    '--import', 'tsx', childEntry, 'hang', output, '0', 'N',
  ], fileURLToPath(new URL('../', import.meta.url)), prefix, process.env, deadlineSignal.signal, 100);
  await ready;
  deadlineSignal.abort();

  const result = await running;

  assert.equal(result.timedOut, true);
  assert.equal(result.signal, 'SIGKILL');
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
});

test('collectAB: CLI finite override -> cannot weaken production condition', { timeout: 10_000 }, async () => {
  const planPath = join(directory, 'plan.json');
  const plan = planFixture();
  plan.freeze.planPath = planPath;
  await writeFile(planPath, JSON.stringify(plan));
  const collector = fileURLToPath(new URL('../results/issue-3914/paired-ab.mts', import.meta.url));

  const result = await launchCollector(process.execPath, ['--import', 'tsx', collector, '--plan-only', planPath, '--amount=1'],
    fileURLToPath(new URL('../', import.meta.url)), join(directory, 'cli-override'), process.env, 5_000);

  assert.equal(result.exitCode, 1);
  const described = await collectAB(planPath, '', true);
  assert.ok('status' in described && described.status === 'FROZEN');
});
