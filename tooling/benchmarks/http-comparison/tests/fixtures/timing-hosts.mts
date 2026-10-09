import assert from 'node:assert/strict';
import { dirname, join, relative } from 'node:path';
import { EvidenceJournal } from '../../src/evidence';
import type { TargetResult } from '../../src/report';
import { runScenario } from '../../src/run';
import { STAGE_SCENARIOS } from '../../src/scenarios';
import { AVAILABLE_TARGETS, buildCommands, buildTarget, WDIR } from '../../src/targets';

// Bounded identity/correctness verification, not the performance matrix.
const output = process.env.BENCH_TIMING_CHECK_OUTPUT;
if (!output || relative(join(WDIR, 'results/issue-3914'), output).startsWith('..')) {
  throw new Error('BENCH_TIMING_CHECK_OUTPUT must be inside results/issue-3914');
}
const names = process.env.BENCH_TARGETS?.split(',') ?? [
  'native-nodejs', 'fluo-nodejs', 'native-bun', 'fluo-bun', 'native-deno', 'fluo-deno',
  'native-nextjs', 'fluo-nextjs', 'native-nextjs-pages', 'fluo-nextjs-pages',
  'native-workers', 'fluo-workers',
];
const targets = names.map((name) => {
  const target = AVAILABLE_TARGETS.find((target) => target.name === name);
  if (!target) throw new Error(`Unknown target ${name}`);
  return target;
});
const scenario = STAGE_SCENARIOS.find((scenario) => scenario.name === 'stage-minimal');
assert.ok(scenario);
assert.equal(AVAILABLE_TARGETS.length, 18);
const completed: { target: string; samples: TargetResult[] }[] = [];
const journal = new EvidenceJournal(output, () => ({
  kind: 'bounded-serving-identity-and-finite-HTTP', notPerformanceBaseline: true,
  expectedConditions: targets.length, completed, buildCommands,
  outputRoot: dirname(output),
  deployedWorkers: 'not-run; lead-owned',
}));
try {
  for (const target of targets) {
    await buildTarget(target);
    const samples: TargetResult[] = [];
    completed.push({ target: target.name, samples });
    await runScenario(scenario, { index: 0, repeat: 0, targets: [target], connections: 1, samples, journal, amount: 3 });
    const sample = samples[0];
    assert.equal(sample.result.requests.total, 3);
    assert.ok(sample.warmup);
    assert.equal(sample.warmup.result.requests.total, 3);
    assert.ok(sample.warmup.latencyHistogramMicros.length > 0);
    assert.equal(sample.servingIdentity?.status, 'authenticated');
    assert.equal(sample.servingIdentity?.instrumentation, 'none');
    if (sample.servingIdentity?.status === 'authenticated') {
      assert.ok(sample.servingIdentity.pid > 0);
      assert.ok(Object.keys(sample.servingIdentity.runtime).length > 0);
    }
    console.log(`TIMING IDENTITY CHECK ${target.name}`);
    journal.flush();
  }
} finally {
  journal.finish();
}
