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
}

export interface TrafficOptions {
  readonly url: string;
  readonly duration: number;
  readonly connections: number;
  readonly requests: readonly ScenarioRequest[];
  readonly amount?: number;
}

export function shoot(options: TrafficOptions, label: string): Promise<Measurement> {
  return new Promise((resolve, reject) => {
    let bodyMismatches = 0;
    let statusMismatches = 0;
    const cpuStart = process.cpuUsage();
    const wallStart = process.hrtime.bigint();
    autocannon({
      url: options.url,
      connections: options.connections,
      duration: options.duration,
      ...(options.amount === undefined ? {} : { amount: options.amount }),
      pipelining: 1,
      bailout: 1,
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
      if (error) { reject(error); return; }
      if (!result) { reject(new Error(`${label}: autocannon returned no result`)); return; }
      const usage = process.cpuUsage(cpuStart);
      const wallMicros = Number(process.hrtime.bigint() - wallStart) / 1_000;
      const checkedResult = { ...result, mismatches: result.mismatches + bodyMismatches };
      const failures = Object.entries({
        errors: result.errors, timeouts: result.timeouts, non2xx: result.non2xx,
        mismatches: checkedResult.mismatches, statusMismatches,
      }).filter(([, count]) => count !== 0);
      if (failures.length > 0 || result.requests.total === 0) {
        reject(new Error(`${label} returned invalid benchmark traffic: ${JSON.stringify(Object.fromEntries(failures))}; completed=${result.requests.total}`));
        return;
      }
      resolve({
        result: checkedResult,
        statusMismatches,
        clientCpu: {
          userMicros: usage.user, systemMicros: usage.system, wallMicros,
          coreEquivalentPercent: (usage.user + usage.system) / wallMicros * 100,
        },
      });
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
