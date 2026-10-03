import autocannon, { type Result } from 'autocannon';

export interface ScenarioRequest {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly expectedBody: string;
  readonly expectedStatus: number;
}

export interface ClientCpu {
  readonly userMicros: number;
  readonly systemMicros: number;
  readonly wallMicros: number;
  // 100% means one CPU core, not the entire machine. Includes client GC/threads.
  readonly coreEquivalentPercent: number;
}

export interface Measurement {
  readonly result: Result;
  readonly statusMismatches: number;
  readonly clientCpu: ClientCpu;
  readonly latencyHistogramMicros: readonly (readonly [number, number])[];
  readonly latencyPercentilesMs: { readonly p50: number; readonly p95: number; readonly p99: number };
}

export interface TrafficOptions {
  readonly url: string;
  readonly duration: number;
  readonly connections: number;
  readonly requests: readonly ScenarioRequest[];
  readonly amount?: number;
  readonly timeout?: number;
}

export interface TrafficDiagnostics {
  readonly result: Result | null;
  readonly statusMismatches: number;
  readonly latencyHistogramMicros: readonly (readonly [number, number])[];
  readonly clientCpu: ClientCpu;
}

export class TrafficFailure extends Error {
  constructor(message: string, readonly diagnostics: TrafficDiagnostics) {
    super(message);
    this.name = 'TrafficFailure';
  }
}

export function histogramPercentile(histogram: readonly (readonly [number, number])[], percentile: number): number {
  const total = histogram.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) throw new Error('Cannot compute a percentile of zero completed responses');
  const rank = Math.ceil(total * percentile / 100);
  let cumulative = 0;
  for (const [micros, count] of [...histogram].sort(([left], [right]) => left - right)) {
    cumulative += count;
    if (cumulative >= rank) return micros / 1_000;
  }
  throw new Error('Invalid latency histogram');
}

export function shoot(options: TrafficOptions, label: string): Promise<Measurement> {
  return new Promise((resolve, reject) => {
    let bodyMismatches = 0;
    let statusMismatches = 0;
    const latencyCounts = new Map<number, number>();
    const cpuStart = process.cpuUsage();
    const wallStart = process.hrtime.bigint();
    const instance = autocannon({
      url: options.url,
      connections: options.connections,
      duration: options.duration,
      ...(options.amount === undefined ? {} : { amount: options.amount }),
      pipelining: 1,
      bailout: 1,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      // Each connection cycles its own immutable request list. onResponse is
      // attached to the actual queued request (autocannon 7.15), unlike the
      // global, body-only verifyBody callback that runs after the next send.
      requests: options.requests.map((request) => ({
        method: request.method,
        path: request.path,
        body: request.body ?? '',
        headers: { ...request.headers },
        onResponse(status, body) {
          if (body !== request.expectedBody) bodyMismatches += 1;
          if (status !== request.expectedStatus) statusMismatches += 1;
        },
      })),
    }, (error, result) => {
      const usage = process.cpuUsage(cpuStart);
      const wallMicros = Number(process.hrtime.bigint() - wallStart) / 1_000;
      const clientCpu = {
        userMicros: usage.user, systemMicros: usage.system, wallMicros,
        coreEquivalentPercent: (usage.user + usage.system) / wallMicros * 100,
      };
      if (error || !result) {
        reject(new TrafficFailure(`${label}: ${error?.message ?? 'autocannon returned no result'}`, {
          result: result ?? null, statusMismatches, clientCpu, latencyHistogramMicros: [...latencyCounts],
        }));
        return;
      }
      const checkedResult = { ...result, mismatches: result.mismatches + bodyMismatches };
      const failures = Object.entries({
        errors: result.errors, timeouts: result.timeouts, non2xx: result.non2xx,
        mismatches: checkedResult.mismatches, statusMismatches,
      }).filter(([, count]) => count !== 0);
      if (failures.length > 0 || result.requests.total === 0) {
        reject(new TrafficFailure(`${label} returned invalid benchmark traffic: ${JSON.stringify(Object.fromEntries(failures))}; completed=${result.requests.total}`, {
          result: checkedResult, statusMismatches, clientCpu, latencyHistogramMicros: [...latencyCounts],
        }));
        return;
      }
      resolve({
        result: checkedResult,
        statusMismatches,
        latencyHistogramMicros: [...latencyCounts],
        latencyPercentilesMs: {
          p50: histogramPercentile([...latencyCounts], 50),
          p95: histogramPercentile([...latencyCounts], 95),
          p99: histogramPercentile([...latencyCounts], 99),
        },
        clientCpu,
      });
    });
    instance.on('response', (_client, _status, _bytes, responseTime) => {
      const micros = Math.round(responseTime * 1_000);
      latencyCounts.set(micros, (latencyCounts.get(micros) ?? 0) + 1);
    });
  });
}

export async function measureTargets<T, R>(targets: readonly T[], phases: {
  readonly warmup: (target: T) => Promise<unknown>;
  readonly measure: (target: T) => Promise<R>;
}): Promise<R[]> {
  const measured: R[] = [];
  for (const target of targets) {
    await phases.warmup(target);
    measured.push(await phases.measure(target));
  }
  return measured;
}
