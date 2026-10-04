import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { TARGETS } from '../src/targets';
import { SCENARIOS } from '../src/scenarios';

const execute = promisify(execFile);
const archive = fileURLToPath(new URL('../src/archive.mjs', import.meta.url));

for (const defect of ['none', 'missing-target', 'wrong-status', 'smoke-duration'] as const) {
  test(`archive rejects incomplete evidence: ${defect}`, { timeout: 20_000 }, async () => {
    // Given: synthetic test data, never published as measurement evidence.
    const directory = await mkdtemp(join(tmpdir(), 'fluo-baseline-archive-'));
    const sample = {
      result: { errors: 0, timeouts: 0, non2xx: 0, mismatches: 0, requests: { total: 100, average: 10 } },
      statusMismatches: 0, latencyPercentilesMs: { p50: 1, p95: 2, p99: 3 },
      server: { samples: [{}, {}], peakRssBytes: 1024, cpuSeconds: 1 },
      coldStart: { processToReadyMs: 10, firstRequest: { result: { requests: { total: 1 } } } },
    };
    try {
      for (const configuration of ['default', 'equivalent']) {
        const sweeps = [1, 64].map((connections) => ({
          connections,
          rawRuns: Array.from({ length: 3 }, () => SCENARIOS.map((scenario) => ({
            name: scenario.name, targets: TARGETS.map((target) => ({ label: target.name, ...structuredClone(sample) })),
          }))),
        }));
        if (configuration === 'equivalent' && defect === 'missing-target') sweeps[0].rawRuns[0][0].targets.pop();
        if (configuration === 'equivalent' && defect === 'wrong-status') sweeps[0].rawRuns[0][0].targets[0].statusMismatches = 1;
        await writeFile(join(directory, `baseline-${configuration}.json`), JSON.stringify({
          schemaVersion: 3, configuration, runs: 3, warmupSeconds: 5, durationSeconds: defect === 'smoke-duration' ? 1 : 15,
          build: { freshWorkspaceBuild: true }, sweeps,
          environment: { benchmarkSource: { files: {}, sha256: createHash('sha256').update('{}').digest('hex') } },
        }));
      }
      for (const platform of ['fastify', 'bun']) for (const scenario of SCENARIOS) {
        await writeFile(join(directory, `mac-headroom-native-${platform}-${scenario.name}.json`), JSON.stringify({
          notPerformanceBaseline: true,
          observations: [1, 4, 4, 1, 1, 4].map((workers) => ({
            workers, requestsPerSecond: 10, samples: Array.from({ length: workers }, () => sample),
          })),
        }));
      }
      for (const name of ['nas-headroom-diagnostic.json', 'nas-generator-scaling.json']) {
        await writeFile(join(directory, name), JSON.stringify({ kind: 'test-only-diagnostic' }));
      }
      // When / Then: the real CLI must fail on the corrupted measurement.
      if (defect === 'none') {
        await execute(process.execPath, ['--import', 'tsx', archive, directory]);
        const manifest = JSON.parse(await readFile(join(directory, 'baseline-manifest.json'), 'utf8'));
        assert.equal(manifest.validMeasurements, 576);
      } else {
        await assert.rejects(execute(process.execPath, ['--import', 'tsx', archive, directory]), /AssertionError/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
