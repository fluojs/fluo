import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { METRICS } from '../src/evaluate.ts';
import { evaluateEvidence } from '../src/gate.mjs';

const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
const budgets = Object.fromEntries(METRICS.map((metric) => [metric, metric === 'throughputRequestsPerSecond' ? 50 : 100]));
const bands = Object.fromEntries(METRICS.map((metric) => [metric, 1.5]));
const baseline = {
  policy: { minimumRuns: 3, warmupRuns: 1, maximumRelativeSpread: 0.1, outlierMadMultiplier: 3 },
  profiles: {
    'desktop-native': { mode: 'native', absoluteBudgets: budgets, relativeBands: bands },
    'tablet-matched-cache': { mode: 'matched-cache', absoluteBudgets: budgets, relativeBands: bands },
  },
};

async function evidence(directory) {
  const receipts = [];
  for (const [profile, config] of Object.entries(baseline.profiles)) {
    const runs = [];
    for (const framework of frameworks) {
      for (let index = 0; index < 3; index += 1) {
        const runId = `${profile}-${framework}-${index}`;
        const trace = join(directory, `${runId}.json`);
        const metrics = Object.fromEntries(METRICS.map((metric) => [metric, metric === 'throughputRequestsPerSecond' ? 80 : 70]));
        await writeFile(trace, JSON.stringify({
          profile, mode: config.mode, framework, runId,
          schemaVersion: 1, provenance: { commit: 'a'.repeat(40) }, environment: { runtime: 'Node 24' },
          correctness: { pass: true }, metrics, unavailable: {}, profileSettings: {},
          requests: [],
        }));
        runs.push({ profile, mode: config.mode, framework, runId, trace, warmupRuns: 1, correctness: 'pass', metrics });
      }
    }
    receipts.push({ profile, mode: config.mode, runs });
  }
  return receipts;
}

test('aggregates every profile before passing the representative gate', async () => {
  // Given: complete independent observations and real raw traces for both profiles.
  const directory = await mkdtemp(join(tmpdir(), 'react-gate-'));
  try {
    const receipts = await evidence(directory);
    // When: all profiles are evaluated as one gate, not independently.
    const result = await evaluateEvidence(baseline, receipts, directory);
    // Then: every absolute and relative check has sufficient recorded evidence.
    assert.equal(result.verdict, 'pass');
    assert.equal(result.observations['desktop-native'].next.coldTtfbMs, 70);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects observations from a different build head', async () => {
  // Given: one otherwise valid raw trace belongs to another application commit.
  const directory = await mkdtemp(join(tmpdir(), 'react-gate-'));
  try {
    const receipts = await evidence(directory);
    const trace = receipts[0].runs[0].trace;
    const raw = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(trace, 'utf8')));
    await writeFile(trace, JSON.stringify({ ...raw, provenance: { commit: 'b'.repeat(40) } }));
    // When/Then: measurements from different heads are not interchangeable.
    await assert.rejects(evaluateEvidence(baseline, receipts, directory), /provenance/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a missing profile instead of declaring a partial victory', async () => {
  // Given: only the desktop profile completed.
  const directory = await mkdtemp(join(tmpdir(), 'react-gate-'));
  try {
    const receipts = await evidence(directory);
    // When: the representative gate evaluates an incomplete report.
    const result = await evaluateEvidence(baseline, receipts.slice(0, 1), directory);
    // Then: missing tablet observations cannot pass.
    assert.equal(result.verdict, 'inconclusive');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails a confirmed Fluo regression with all traces present', async () => {
  // Given: all three independent desktop Fluo samples breach the absolute TTFB budget.
  const directory = await mkdtemp(join(tmpdir(), 'react-gate-'));
  try {
    const receipts = await evidence(directory);
    receipts[0].runs = await Promise.all(receipts[0].runs.map(async (run) => {
      if (run.framework !== 'fluo') return run;
      const metrics = { ...run.metrics, coldTtfbMs: 130 };
      const raw = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(run.trace, 'utf8')));
      await writeFile(run.trace, JSON.stringify({ ...raw, metrics }));
      return { ...run, metrics };
    }));
    // When: the complete profile set is evaluated.
    const result = await evaluateEvidence(baseline, receipts, directory);
    // Then: the real gate fails, not merely an isolated evaluator test.
    assert.equal(result.verdict, 'fail');
    assert.ok(result.checks.some((check) => check.reason === 'absolute-budget'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a missing raw trace rather than trusting a path string', async () => {
  // Given: one run points to a file that is not present.
  const directory = await mkdtemp(join(tmpdir(), 'react-gate-'));
  try {
    const receipts = await evidence(directory);
    receipts[0].runs[0] = { ...receipts[0].runs[0], trace: join(directory, 'absent.json') };
    // When/Then: a missing trace cannot become a passing gate.
    await assert.rejects(evaluateEvidence(baseline, receipts, directory), /trace/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a summary value that differs from the retained raw trace', async () => {
  // Given: the published run claims a fast TTFB that its raw trace did not observe.
  const directory = await mkdtemp(join(tmpdir(), 'react-gate-'));
  try {
    const receipts = await evidence(directory);
    const run = receipts[0].runs[0];
    receipts[0].runs[0] = { ...run, metrics: { ...run.metrics, coldTtfbMs: 1 } };
    // When/Then: the trace-to-summary identity is required before budget evaluation.
    await assert.rejects(evaluateEvidence(baseline, receipts, directory), /raw trace metrics/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const kind of ['warmups', 'developmentWarmups']) {
  for (const mutation of ['zero', 'deleted']) {
    test(`evaluateEvidence: ${kind} summary errorRate ${mutation} -> rejects unchanged raw`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'react-gate-warmup-'));
      try {
        const receipts = await evidence(directory);
        const original = receipts[0].runs[0];
        const raw = JSON.parse(await readFile(original.trace, 'utf8'));
        const warmup = { ...original, runId: `${original.runId}-${kind}`,
          trace: join(directory, `${kind}.json`), warmup: true,
          metrics: { ...original.metrics, errorRate: 0.25 } };
        await writeFile(warmup.trace, JSON.stringify({ ...raw,
          runId: warmup.runId, warmup: true, metrics: warmup.metrics }));
        receipts[0][kind] = [warmup];
        const originalBytes = await readFile(warmup.trace, 'utf8');
        assert.equal((await evaluateEvidence(baseline, receipts, directory)).verdict, 'pass');
        warmup.metrics = { ...warmup.metrics };
        if (mutation === 'zero') warmup.metrics.errorRate = 0;
        else delete warmup.metrics.errorRate;

        await assert.rejects(evaluateEvidence(baseline, receipts, directory), /raw trace metrics/u);

        assert.equal(await readFile(warmup.trace, 'utf8'), originalBytes);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
