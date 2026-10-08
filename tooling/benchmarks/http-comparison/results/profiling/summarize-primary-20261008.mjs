import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const inputs = JSON.parse(await readFile(join(root, 'primary-inputs-20261008.json'), 'utf8'));
const summaries = [];
for (const directory of inputs.directories) {
  const manifest = JSON.parse(await readFile(join(root, directory, 'manifest.json'), 'utf8'));
  for (const capture of manifest.captures) {
    if (!['supported', 'unsupported'].includes(capture.status)) continue;
    const phases = capture.runs.map((run) => ({
      phase: run.phase, requests: run.value.result.requests.total,
      requestsPerSecond: run.value.result.requests.total / run.server.wallSeconds,
      latencyPercentilesMs: run.value.latencyPercentilesMs,
      cpuMicrosPerRequest: run.server.cpuSeconds * 1e6 / run.value.result.requests.total,
      cpuSeconds: run.server.cpuSeconds, wallSeconds: run.server.wallSeconds,
      peakRssBytes: run.server.peakRssBytes, clientCpu: run.value.clientCpu,
    }));
    const [before, measured, after] = phases;
    const controlRps = (before.requestsPerSecond + after.requestsPerSecond) / 2;
    const controlCpu = (before.cpuMicrosPerRequest + after.cpuMicrosPerRequest) / 2;
    let diagnostics = null;
    if (capture.status === 'supported' && capture.condition.mode !== 'cpu') {
      const profile = JSON.parse(await readFile(join(root, directory, capture.profilePath), 'utf8'));
      if (capture.format === 'v8-allocation') {
        diagnostics = {
          kind: 'v8-sampled-allocation',
          sampleCount: profile.samples.length,
          sumReportedSampleSizesBytes: profile.samples.reduce((sum, sample) => sum + sample.size, 0),
          interpretation: 'Reported sampling sizes including collected objects; not exact allocation counts or a retained-heap measurement.',
        };
      } else if (capture.format === 'jsc-heap') {
        diagnostics = {
          kind: 'jsc-retained-heap-snapshot',
          version: profile.version, type: profile.type,
          nodeArrayElements: profile.nodes.length, edgeArrayElements: profile.edges.length,
          interpretation: 'Raw flattened snapshot array lengths, not object counts, allocation bytes or allocation rate.',
        };
      } else {
        const traceArtifacts = capture.artifacts.filter((artifact) =>
          artifact.path.endsWith('/capture.stdout.log') || artifact.path.endsWith('/capture.stderr.log'));
        const traceLines = [];
        for (const artifact of traceArtifacts) {
          const lines = (await readFile(join(root, directory, artifact.path), 'utf8')).split('\n');
          traceLines.push(...lines.filter((line) => /\bms: (?:Scavenge|Mark-|Minor |Major |Incremental)/.test(line)));
        }
        diagnostics = {
          kind: 'gc-eventloop',
          wallDelayMaxMs: profile.wallDelayMaxMs, wallDelaySamples: profile.wallDelaySamples,
          elapsedMs: profile.elapsedMs, node: profile.node ?? null,
          gcNotifications: profile.gcEvents.length,
          gcNotificationSource: capture.condition.platform === 'bun' ? 'JSC Heap.garbageCollected' : null,
          gcPhaseTraceLines: traceLines.length,
          traceArtifacts: traceArtifacts.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256 })),
          interpretation: 'Wall delay is not CPU time or ELU. Phase stdout/stderr includes warmup and capture; GC line count is not steady-state-exclusive. JSC and V8 GC observations are not interchangeable.',
        };
      }
    }
    summaries.push({
      condition: capture.condition, status: capture.status, reason: capture.reason,
      directory, profilePath: capture.profilePath, provenanceSha256: capture.provenanceSha256,
      phases, diagnostics,
      overhead: capture.status === 'supported' ? {
        profiledToControlThroughputRatio: measured.requestsPerSecond / controlRps,
        profiledToControlCpuPerRequestRatio: measured.cpuMicrosPerRequest / controlCpu,
        afterToBeforeControlThroughputRatio: after.requestsPerSecond / before.requestsPerSecond,
      } : null,
    });
  }
}
console.log(JSON.stringify({
  schemaVersion: 1, kind: 'primary-profile-metrics', summaries,
  interpretation: 'Separate modes and before/after controls. Ratios measure instrumentation plus fresh-process variation, not an optimization or overhead budget pass.',
}));
console.log(`PRIMARY_METRICS_COMPLETE captures=${summaries.length}`);
