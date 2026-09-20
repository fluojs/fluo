import type { EnvironmentSummary } from './provenance';
import type { Measurement } from './traffic';

export interface TargetResult extends Measurement { readonly label: string }
export interface ScenarioResult {
  readonly name: string;
  readonly description: string;
  readonly targets: readonly TargetResult[];
}

export function metricSnapshot(target: Measurement) {
  const result = target.result;
  return {
    errors: result.errors, timeouts: result.timeouts, non2xx: result.non2xx,
    mismatches: result.mismatches, statusMismatches: target.statusMismatches,
    requestsAverage: result.requests.average, throughputAverage: result.throughput.average,
    latencyAverage: result.latency.average, latencyP50: result.latency.p50,
    latencyP97_5: result.latency.p97_5, latencyP99: result.latency.p99,
    clientCpu: target.clientCpu,
  };
}

export function summarize(values: readonly number[]) {
  if (values.length === 0) throw new Error('Cannot summarize an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  return {
    count: values.length, mean,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    min: sorted[0], max: sorted[sorted.length - 1],
    standardDeviation: values.length === 1 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)),
  };
}

export function summarizeRuns(runs: readonly (readonly ScenarioResult[])[]) {
  const first = runs[0];
  if (!first) throw new Error('Cannot summarize an empty run set');
  return first.map((scenario) => ({
    name: scenario.name, description: scenario.description,
    targets: scenario.targets.map((target) => {
      const samples = runs.map((run) => {
        const sample = run.find((item) => item.name === scenario.name)?.targets.find((item) => item.label === target.label);
        if (!sample) throw new Error(`Missing ${target.label} sample for ${scenario.name}`);
        return metricSnapshot(sample);
      });
      return {
        label: target.label, samples,
        requestsPerSecond: summarize(samples.map((sample) => sample.requestsAverage)),
        bytesPerSecond: summarize(samples.map((sample) => sample.throughputAverage)),
        // Arithmetic mean of independently measured run percentiles, NOT a
        // percentile of pooled requests. Keep that distinction in the schema.
        meanOfRunLatencyMs: {
          average: summarize(samples.map((sample) => sample.latencyAverage)).mean,
          p50: summarize(samples.map((sample) => sample.latencyP50)).mean,
          p97_5: summarize(samples.map((sample) => sample.latencyP97_5)).mean,
          p99: summarize(samples.map((sample) => sample.latencyP99)).mean,
        },
        clientCpuCoreEquivalentPercent: summarize(samples.map((sample) => sample.clientCpu.coreEquivalentPercent)),
      };
    }),
  }));
}

export interface ReportOptions {
  readonly connections: number;
  readonly duration: number;
  readonly environment: EnvironmentSummary;
  readonly outputJson: string;
  readonly runs: number;
  readonly warmup: number;
}

function n(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function printReport(results: ReturnType<typeof summarizeRuns>, options: ReportOptions): void {
  console.log(`\nHTTP runtime benchmark: c=${options.connections} warmup=${options.warmup}s d=${options.duration}s runs=${options.runs}`);
  console.log(`node=${options.environment.node} bun=${options.environment.bun ?? 'unavailable'} ${options.environment.platform}/${options.environment.arch} ${options.environment.cpuModel} x${options.environment.cpuCount}`);
  console.log(`git=${options.environment.git.sha} dirty=${options.environment.git.dirty}; provenance and raw samples: ${options.outputJson}`);
  console.log('Latency percentiles below are mean-of-run percentiles, not pooled percentiles. Deltas are descriptive, not winner/significance verdicts.');
  for (const scenario of results) {
    console.log(`\n${scenario.name}: ${scenario.description}`);
    const baseline = scenario.targets.find((target) => target.label === 'Nest+Fastify');
    for (const target of scenario.targets) {
      const stats = target.requestsPerSecond;
      const delta = baseline && baseline.requestsPerSecond.mean !== 0
        ? `${n((stats.mean / baseline.requestsPerSecond.mean - 1) * 100)}%` : 'N/A';
      console.log(`  ${target.label}: req/s mean=${n(stats.mean)} median=${n(stats.median)} sample SD=${stats.standardDeviation === null ? 'N/A' : n(stats.standardDeviation)} range=${n(stats.min)}..${n(stats.max)} n=${stats.count}; delta mean vs Nest=${delta}`);
      const latency = target.meanOfRunLatencyMs;
      console.log(`    MB/s mean=${n(target.bytesPerSecond.mean / 1_048_576)}; mean-of-run latency ms: average=${n(latency.average)} p50=${n(latency.p50)} p97.5=${n(latency.p97_5)} p99=${n(latency.p99)}`);
      const cpu = target.clientCpuCoreEquivalentPercent;
      console.log(`    client CPU/core: mean=${n(cpu.mean)}% range=${n(cpu.min)}..${n(cpu.max)}%; errors/timeouts/non2xx/body/status mismatches=0 (validated)`);
      if (cpu.max >= 100) console.log('    Potential load-generator saturation: client CPU consumed at least one core in a run; this is a diagnostic flag, not proof or a performance verdict.');
    }
  }
  console.log('Client CPU is process user+system time / elapsed wall time (100%=one core), including GC/helper threads and result collection. Near-one-core use can limit the single-threaded generator; lower averages do not rule out bursts. Client and servers share this machine; confirm headroom on a separate load host before attributing a throughput ceiling to a server.');
}
