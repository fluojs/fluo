import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectSuite } from './suites';
import { buildTarget, startTargets, stopTargets, TARGETS, WDIR, waitForTarget } from './targets';
import { shoot } from './traffic';

const receipts: unknown[] = [];
const requested = process.env.BENCH_TARGETS?.split(',');
const targets = requested ? TARGETS.filter((target) => requested.includes(target.name)) : TARGETS;
if (requested?.some((name) => !TARGETS.some((target) => target.name === name))) {
  throw new Error('Unknown BENCH_TARGETS entry');
}
await mkdir(join(WDIR, 'results'), { recursive: true });
try {
  // Nest Fastify and Express share one legacy-decorator build.
  for (const target of targets) await buildTarget(target);
  for (const target of targets) {
    for (const scenario of selectSuite()) {
      const startedAt = new Date().toISOString();
      const processes = startTargets(scenario.appShape, [target]);
      try {
        await waitForTarget(processes[0]);
        const measurement = await shoot({
          url: `http://127.0.0.1:${target.port}`, duration: 1,
          amount: 25, connections: 1, requests: scenario.requests,
        }, `${target.name}/${scenario.name}`);
        receipts.push({ target: target.name, scenario: scenario.name, startedAt, measurement, kind: 'correctness-smoke' });
        console.log(`SMOKE PASS ${target.name}/${scenario.name}`);
      } finally {
        await stopTargets(processes);
      }
    }
  }
} finally {
  await writeFile(join(WDIR, 'results/correctness-smoke.json'), `${JSON.stringify({ kind: 'correctness-smoke', notPerformanceBaseline: true, receipts }, null, 2)}\n`);
}
