import type { Result } from 'autocannon';

export interface TargetResult {
  label: string;
  result: Result;
}

export interface ScenarioResult {
  name: string;
  description: string;
  targets: TargetResult[];
}

function throughputDelta(value: number, baseline: number): string {
  if (baseline === 0) return 'N/A';
  const v = ((value - baseline) / baseline) * 100;
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const better = v > 1;
  const worse = v < -1;
  return better ? `\x1b[32m${s}\x1b[0m` : worse ? `\x1b[31m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`;
}

function latencyDelta(value: number, baseline: number): string {
  if (baseline === 0) return 'N/A';
  const v = ((value - baseline) / baseline) * 100;
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const better = v < -1;
  const worse = v > 1;
  return better ? `\x1b[32m${s}\x1b[0m` : worse ? `\x1b[31m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`;
}

function countDelta(value: number, baseline: number): string {
  if (baseline === 0) {
    return value === 0 ? '0' : `+${value}`;
  }

  const v = ((value - baseline) / baseline) * 100;
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const better = value < baseline;
  const worse = value > baseline;
  return better ? `\x1b[32m${s}\x1b[0m` : worse ? `\x1b[31m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`;
}

function n(v: number, d = 0): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: d });
}

function row(cols: string[], widths: number[]): string {
  return '  ' + cols.map((c, i) => c.padEnd(widths[i])).join('  ');
}

export function printReport(results: ScenarioResult[]): void {
  const bar = '═'.repeat(112);
  const sep = '─'.repeat(108);
  const W = [22, 16, 14, 14, 18, 18];

  console.log('\n\n' + bar);
  console.log('  HTTP runtime benchmark  —  NestJS vs fluo across Fastify, Express, and Bun  —  c=100 d=40s');
  console.log(bar);

  for (const r of results) {
    const baseline = r.targets.find((target) => target.label === 'Nest+Fastify') ?? r.targets[0];

    console.log(`\n  ${r.name.toUpperCase()}  —  ${r.description}`);
    console.log('  ' + sep);
    console.log(row(['Target', 'req/s', 'MB/s', 'p50 ms', 'p97.5 ms', 'Δ req/s vs Nest'], W));
    console.log('  ' + sep);
    for (const target of r.targets) {
      console.log(row([
        target.label,
        n(target.result.requests.average),
        n(target.result.throughput.average / 1_048_576, 2),
        n(target.result.latency.p50, 2),
        n(target.result.latency.p97_5, 2),
        throughputDelta(target.result.requests.average, baseline.result.requests.average),
      ], W));
    }

    console.log('  ' + sep);
    console.log(row(['Target', 'p99 ms', 'errors', 'timeouts', 'non-2xx', 'mismatches'], W));
    console.log('  ' + sep);
    for (const target of r.targets) {
      console.log(row([
        target.label,
        `${n(target.result.latency.p99, 2)} (${latencyDelta(target.result.latency.p99, baseline.result.latency.p99)})`,
        `${target.result.errors} (${countDelta(target.result.errors, baseline.result.errors)})`,
        String(target.result.timeouts),
        String(target.result.non2xx),
        String(target.result.mismatches),
      ], W));
    }
  }

  console.log('\n' + bar + '\n');
}
