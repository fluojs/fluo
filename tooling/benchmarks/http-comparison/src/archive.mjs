import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SCENARIOS } from './scenarios.ts';
import { TARGETS } from './targets.ts';

const directory = `${process.argv[2] ?? fileURLToPath(new URL('../results/', import.meta.url))}/`;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const summary = (values) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length, mean, min: Math.min(...values), max: Math.max(...values),
    sampleStandardDeviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)),
  };
};
const manifest = {
  version: 1, kind: 'http-platform-baseline', status: 'complete',
  conditions: { configurations: ['default', 'equivalent'], connections: [1, 64], repeats: 3, warmupSeconds: 5, measureSeconds: 15 },
  artifacts: [], summaries: [], generatorControls: [], nasDiagnostics: [],
  limitations: [
    'Mac client and server share a host. Generator process scaling controls do not remove scheduler, thermal, or CPU-frequency confounders.',
    'NAS diagnostics are generator-limited and are not server capacity measurements.',
    'Three rotated repeats provide descriptive variability, not a significance or universal winner claim.',
    'Workers is local workerd and Next is a local production App Router host, not a deployed environment.',
    'Equivalent configuration adds the seven default Fluo security headers to native and Nest; other host features are not claimed identical.',
    'Nest fixture logging is disabled as in the prior harness. Cold-start comparisons include that configuration difference.',
  ],
};
let sourceDigest;
for (const configuration of manifest.conditions.configurations) {
  const name = `baseline-${configuration}.json`;
  const raw = await readFile(`${directory}${name}`);
  const value = JSON.parse(raw);
  assert.equal(value.schemaVersion, 3);
  assert.equal(value.configuration, configuration);
  assert.equal(value.runs, 3);
  assert.equal(value.warmupSeconds, 5);
  assert.equal(value.durationSeconds, 15);
  assert.equal(value.build.freshWorkspaceBuild, true);
  sourceDigest ??= value.environment.benchmarkSource.sha256;
  assert.equal(value.environment.benchmarkSource.sha256, sourceDigest);
  assert.equal(digest(JSON.stringify(value.environment.benchmarkSource.files)), sourceDigest);
  assert.deepEqual(value.sweeps.map((sweep) => sweep.connections), [1, 64]);
  for (const sweep of value.sweeps) {
    assert.equal(sweep.rawRuns.length, 3);
    for (const run of sweep.rawRuns) {
      assert.deepEqual(run.map((scenario) => scenario.name).sort(), SCENARIOS.map((scenario) => scenario.name).sort());
      for (const scenario of run) {
        assert.deepEqual(scenario.targets.map((target) => target.label).sort(), TARGETS.map((target) => target.name).sort());
        for (const target of scenario.targets) {
          for (const key of ['errors', 'timeouts', 'non2xx', 'mismatches']) assert.equal(target.result[key], 0);
          assert.equal(target.statusMismatches, 0);
          assert.ok(target.result.requests.total > 0);
          for (const key of ['p50', 'p95', 'p99']) assert.ok(Number.isFinite(target.latencyPercentilesMs[key]));
          assert.ok(target.server.samples.length > 1 && target.server.peakRssBytes > 0);
          assert.ok(Number.isFinite(target.server.cpuSeconds) && target.server.cpuSeconds >= 0);
          assert.ok(target.coldStart.processToReadyMs > 0 && target.coldStart.firstRequest.result.requests.total > 0);
        }
      }
    }
    for (const scenario of SCENARIOS) for (const target of TARGETS) {
      const samples = sweep.rawRuns.map((run) => run.find((item) => item.name === scenario.name).targets.find((item) => item.label === target.name));
      manifest.summaries.push({
        configuration, connections: sweep.connections, scenario: scenario.name, target: target.name,
        requestsPerSecond: summary(samples.map((sample) => sample.result.requests.average)),
        p95Ms: summary(samples.map((sample) => sample.latencyPercentilesMs.p95)),
        p99Ms: summary(samples.map((sample) => sample.latencyPercentilesMs.p99)),
        cpuMicrosPerRequest: summary(samples.map((sample) => sample.server.cpuSeconds * 1e6 / sample.result.requests.total)),
        peakRssBytes: summary(samples.map((sample) => sample.server.peakRssBytes)),
        processToReadyMs: summary(samples.map((sample) => sample.coldStart.processToReadyMs)),
      });
    }
  }
  const compressed = gzipSync(raw, { level: 9 });
  await writeFile(`${directory}${name}.gz`, compressed);
  manifest.artifacts.push({ path: `${name}.gz`, rawSha256: digest(raw), gzipSha256: digest(compressed), rawBytes: raw.length, gzipBytes: compressed.length });
}
for (const platform of ['fastify', 'bun']) for (const scenario of SCENARIOS) {
  const path = `mac-headroom-native-${platform}-${scenario.name}.json`;
  const raw = await readFile(`${directory}${path}`);
  const value = JSON.parse(raw);
  assert.equal(value.observations.length, 6);
  assert.equal(value.notPerformanceBaseline, true);
  const single = value.observations.filter((item) => item.workers === 1).map((item) => item.requestsPerSecond);
  const multiple = value.observations.filter((item) => item.workers === 4).map((item) => item.requestsPerSecond);
  assert.equal(single.length, 3);
  assert.equal(multiple.length, 3);
  for (const observation of value.observations) {
    assert.equal(observation.samples.length, observation.workers);
    for (const sample of observation.samples) {
      assert.equal(sample.result.errors, 0);
      assert.equal(sample.result.timeouts, 0);
      assert.equal(sample.result.mismatches, 0);
      assert.equal(sample.statusMismatches, 0);
    }
  }
  const compressed = gzipSync(raw, { level: 9 });
  await writeFile(`${directory}${path}.gz`, compressed);
  manifest.generatorControls.push({ path: `${path}.gz`, rawSha256: digest(raw), gzipSha256: digest(compressed), single: summary(single), multiple: summary(multiple) });
}
manifest.measuredSourceSha256 = sourceDigest;
manifest.validMeasurements = 576;
for (const path of ['nas-headroom-diagnostic.json', 'nas-generator-scaling.json']) {
  const raw = await readFile(`${directory}${path}`);
  const compressed = gzipSync(raw, { level: 9 });
  await writeFile(`${directory}${path}.gz`, compressed);
  manifest.nasDiagnostics.push({ path: `${path}.gz`, rawSha256: digest(raw), gzipSha256: digest(compressed), role: 'generator-limitation-only; not server capacity' });
}
await writeFile(`${directory}baseline-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: manifest.status, measurements: manifest.validMeasurements, archives: manifest.artifacts }));
