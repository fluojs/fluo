import { StringDecoder } from 'node:string_decoder';
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
  readonly driftDiagnostic?: ReturnType<DriftLatencyWindows['finish']>;
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
  readonly driftDiagnostic?: ReturnType<DriftLatencyWindows['finish']>;
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

// One accumulator per shoot: phases never share latency counters.
export class DriftLatencyWindows {
  private readonly bins = new Map<number, Map<number, number>>();

  constructor(private readonly label: string, private readonly startedAtEpochMs: number) {}

  record(epochMs: number, latencyMicros: number): void {
    const start = Math.floor(epochMs / 10_000) * 10_000;
    const histogram = this.bins.get(start) ?? new Map<number, number>();
    histogram.set(latencyMicros, (histogram.get(latencyMicros) ?? 0) + 1);
    this.bins.set(start, histogram);
  }

  finish(endedAtEpochMs: number) {
    const windows = [];
    for (let start = Math.floor(this.startedAtEpochMs / 10_000) * 10_000;
      start <= Math.floor(endedAtEpochMs / 10_000) * 10_000; start += 10_000) {
      const histogram = [...(this.bins.get(start) ?? new Map<number, number>())];
      windows.push({
        startedAtEpochMs: start, endedAtEpochMs: start + 10_000,
        observedStartedAtEpochMs: Math.max(start, this.startedAtEpochMs),
        observedEndedAtEpochMs: Math.min(start + 10_000, endedAtEpochMs),
        responseCount: histogram.reduce((sum, [, count]) => sum + count, 0),
        latencyHistogramMicros: histogram,
      });
    }
    return { purpose: 'diagnostic-only' as const, label: this.label, windowMs: 10_000,
      startedAtEpochMs: this.startedAtEpochMs, endedAtEpochMs, windows };
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
    const drift = process.env.BENCH_DIAGNOSTIC_DRIFT === '1' ? new DriftLatencyWindows(label, Date.now()) : undefined;
    const cpuStart = process.cpuUsage();
    const wallStart = process.hrtime.bigint();
    const instance = autocannon({
      url: options.url,
      connections: options.connections,
      duration: options.duration,
      ...(options.amount === undefined ? {} : { amount: options.amount }),
      pipelining: 1,
      bailout: 1,
      setupClient(client) {
        // Pinned autocannon 7.15 calls setupClient before connecting. Correct
        // only this client's queue: never mutate installed modules/prototypes.
        const queue: unknown = Reflect.get(client, 'pipelinedRequests');
        if (typeof queue !== 'object' || queue === null) throw new Error('Missing autocannon response queue');
        const peek: unknown = Reflect.get(queue, 'peek');
        const terminate: unknown = Reflect.get(queue, 'terminateRequest');
        if (typeof peek !== 'function' || typeof terminate !== 'function') throw new Error('Unsupported autocannon response queue');
        const decoders = new WeakMap<object, StringDecoder>();
        Reflect.set(queue, 'addBody', (bytes: Buffer) => {
          const pending: unknown = Reflect.apply(peek, queue, []);
          if (typeof pending !== 'object' || pending === null) return;
          const decoder = decoders.get(pending) ?? new StringDecoder('utf8');
          decoders.set(pending, decoder);
          const body: unknown = Reflect.get(pending, 'body');
          if (typeof body !== 'string') throw new Error('Unsupported autocannon body accumulator');
          Reflect.set(pending, 'body', body + decoder.write(bytes));
        });
        Reflect.set(queue, 'terminateRequest', () => {
          const pending: unknown = Reflect.apply(peek, queue, []);
          if (typeof pending === 'object' && pending !== null) {
            const decoder = decoders.get(pending);
            if (decoder) {
              Reflect.set(pending, 'body', String(Reflect.get(pending, 'body')) + decoder.end());
              decoders.delete(pending);
            }
          }
          return Reflect.apply(terminate, queue, []);
        });
      },
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
      const diagnostic = drift ? { driftDiagnostic: drift.finish(Date.now()) } : {};
      if (error || !result) {
        reject(new TrafficFailure(`${label}: ${error?.message ?? 'autocannon returned no result'}`, {
          result: result ?? null, statusMismatches, clientCpu, latencyHistogramMicros: [...latencyCounts], ...diagnostic,
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
          result: checkedResult, statusMismatches, clientCpu, latencyHistogramMicros: [...latencyCounts], ...diagnostic,
        }));
        return;
      }
      resolve({
        ...diagnostic,
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
      drift?.record(Date.now(), micros);
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
