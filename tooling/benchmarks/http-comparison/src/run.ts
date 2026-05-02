import autocannon, { type Request as AutocannonRequest, type Result } from 'autocannon';
import { spawn, type ChildProcess } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { arch, cpus, platform } from 'node:os';
import { join } from 'node:path';

import { printReport, type EnvironmentSummary, type MetricSnapshot, type ScenarioResult, type TargetResult } from './report';
import {
  QUOTE_REQUEST_BODY,
  QUOTE_RESPONSE,
  READ_SEARCH_PATH,
  READ_SEARCH_RESPONSE,
  ROUTE_MIX_PATHS,
  ROUTE_MIX_REQUEST_BODY,
  ROUTE_MIX_RESPONSES,
} from './shared/workloads';

const FLUO_FASTIFY_PORT = 3001;
const NESTJS_PORT = 3002;
const FLUO_BUN_PORT = 3003;
const WDIR = process.cwd();
const FLUO_FASTIFY_BUILD_DIR = join(WDIR, 'dist/fluo-fastify');
const FLUO_BUN_BUILD_DIR = join(WDIR, 'dist/fluo-bun');
const NESTJS_BUILD_DIR = join(WDIR, 'dist/nestjs');

type TargetName = 'nestjs-fastify' | 'fluo-fastify' | 'fluo-bun';
type AppShape = 'read-search-local' | 'json-command-local' | 'rest-route-mix-local';

interface ScenarioRequestTemplate {
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: 'GET' | 'POST';
  readonly path?: string;
}

interface TargetConfig {
  name: TargetName;
  label: string;
  port: number;
  command: string;
  args: string[];
}

interface ScenarioConfig {
  readonly appShape: AppShape;
  readonly description: string;
  readonly expectedBodies: readonly string[];
  readonly name: string;
  readonly path?: string;
  readonly paths?: readonly string[];
  readonly request?: ScenarioRequestTemplate;
  readonly requestSequence?: readonly ScenarioRequestTemplate[];
}

const TARGETS: TargetConfig[] = [
  {
    name: 'nestjs-fastify',
    label: 'Nest+Fastify',
    port: NESTJS_PORT,
    command: 'node',
    args: ['dist/nestjs/nestjs/server.js'],
  },
  {
    name: 'fluo-fastify',
    label: 'fluo+Fastify',
    port: FLUO_FASTIFY_PORT,
    command: 'node',
    args: ['dist/fluo-fastify/fluo/server.js'],
  },
  {
    name: 'fluo-bun',
    label: 'fluo+Bun',
    port: FLUO_BUN_PORT,
    command: 'bun',
    args: ['run', 'dist/fluo-bun/fluo-bun/server.js'],
  },
];

const SCENARIOS: readonly ScenarioConfig[] = [
  {
    name: 'read-search-local',
    description: 'Read-heavy tenant user search: path param + query parsing + DI service + deterministic in-memory filtering',
    appShape: 'read-search-local',
    path: READ_SEARCH_PATH,
    expectedBodies: [READ_SEARCH_RESPONSE],
  },
  {
    name: 'json-command-local',
    description: 'JSON command endpoint: body materialization + quote calculation + deterministic response serialization',
    appShape: 'json-command-local',
    path: '/orders/quote',
    expectedBodies: [QUOTE_RESPONSE],
    request: {
      body: QUOTE_REQUEST_BODY,
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  },
  {
    name: 'rest-route-mix-local',
    description: 'Mixed REST surface: project detail, task list/detail, POST preview, and comment summary over one deterministic route cycle',
    appShape: 'rest-route-mix-local',
    expectedBodies: ROUTE_MIX_RESPONSES,
    requestSequence: ROUTE_MIX_PATHS.map((path) => (path.endsWith('/preview')
      ? { body: ROUTE_MIX_REQUEST_BODY, headers: { 'content-type': 'application/json' }, method: 'POST', path }
      : { method: 'GET', path })),
  },
];

const WARMUP_SEC = readPositiveIntegerEnv('BENCH_WARMUP_SEC', 10);
const MEASURE_SEC = readPositiveIntegerEnv('BENCH_MEASURE_SEC', 40);
const CONNECTIONS = readPositiveIntegerEnv('BENCH_CONNECTIONS', 100);
const RUNS = readPositiveIntegerEnv('BENCH_RUNS', 5);
const OUTPUT_JSON = process.env.BENCH_OUTPUT_JSON ?? join(WDIR, 'benchmark-results.json');

function readScenarioFilter(): Set<string> | undefined {
  const raw = process.env.BENCH_SCENARIOS;
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }

  return new Set(raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0));
}

function selectedScenarios(): readonly ScenarioConfig[] {
  const filter = readScenarioFilter();
  if (!filter) {
    return SCENARIOS;
  }

  const selected = SCENARIOS.filter((scenario) => filter.has(scenario.name));
  const knownNames = new Set(SCENARIOS.map((scenario) => scenario.name));
  const unknown = [...filter].filter((name) => !knownNames.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown BENCH_SCENARIOS entries: ${unknown.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('BENCH_SCENARIOS did not select any scenarios.');
  }

  return selected;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }

  return value;
}

function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = (): void => {
      const sock = createConnection({ port, host: '127.0.0.1' });
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`port ${port} not ready within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

function assertCleanResult(label: string, result: Result): void {
  const failures = [
    ['errors', result.errors],
    ['timeouts', result.timeouts],
    ['non2xx', result.non2xx],
    ['mismatches', result.mismatches],
  ].filter(([, count]) => count !== 0);

  if (failures.length > 0) {
    const details = failures.map(([name, count]) => `${name}=${count}`).join(', ');
    throw new Error(`${label} returned invalid benchmark traffic: ${details}`);
  }
}

function createDeterministicPathSequence(paths: readonly string[]): () => string {
  let index = 0;
  return () => {
    const path = paths[index % paths.length] ?? paths[0] ?? '/';
    index += 1;
    return path;
  };
}

function createDeterministicRequestSequence(requests: readonly ScenarioRequestTemplate[]): () => ScenarioRequestTemplate {
  let index = 0;
  return () => {
    const request = requests[index % requests.length] ?? requests[0] ?? {};
    index += 1;
    return request;
  };
}

function shoot(
  url: string,
  duration: number,
  expectedBodies: readonly string[],
  label: string,
  requestTemplate: ScenarioRequestTemplate = {},
  paths?: readonly string[],
  requestSequence?: readonly ScenarioRequestTemplate[],
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const nextPath = paths ? createDeterministicPathSequence(paths) : undefined;
    const nextRequest = requestSequence ? createDeterministicRequestSequence(requestSequence) : undefined;
    const hasCustomRequest = nextPath !== undefined
      || nextRequest !== undefined
      || requestTemplate.method !== undefined
      || requestTemplate.body !== undefined
      || requestTemplate.headers !== undefined;

    autocannon({
      url,
      connections: CONNECTIONS,
      duration,
      verifyBody: (body: unknown) => expectedBodies.includes(String(body)),
      bailout: 1,
      ...(hasCustomRequest
        ? {
            requests: [{
              setupRequest(request: AutocannonRequest, _context: object) {
                const sequenceRequest = nextRequest?.();
                const template = sequenceRequest ?? requestTemplate;
                request.path = template.path ?? nextPath?.() ?? request.path;
                request.method = template.method ?? request.method;
                request.body = template.body ?? request.body;
                request.headers = template.headers
                  ? { ...(request.headers ?? {}), ...template.headers }
                  : request.headers;
                return request;
              },
            }],
          }
        : {}),
    }, (err: Error | null, result: Result | undefined) => {
      if (err) {
        reject(err);
        return;
      }

      assertCleanResult(label, result!);
      resolve(result!);
    });
  });
}

async function measure(
  label: string,
  url: string,
  expectedBodies: readonly string[],
  requestTemplate: ScenarioRequestTemplate = {},
  paths?: readonly string[],
  requestSequence?: readonly ScenarioRequestTemplate[],
): Promise<Result> {
  process.stdout.write(`  measuring ${label.padEnd(6)} (${MEASURE_SEC}s)...`);
  const result = await shoot(url, MEASURE_SEC, expectedBodies, label, requestTemplate, paths, requestSequence);
  process.stdout.write(' done\n');
  return result;
}

async function runScenario(s: ScenarioConfig, index: number): Promise<ScenarioResult> {
  const processes = startTargets(s.appShape);

  try {
    await Promise.all(TARGETS.map((target) => waitForPort(target.port)));

    const scenarioTargets = rotationFor(index).map((target) => ({
      target,
      url: `http://127.0.0.1:${target.port}${s.path ?? ''}`,
    }));

    process.stdout.write(`  [${s.name}] warm-up (${WARMUP_SEC}s)...`);
    await Promise.all(scenarioTargets.map(({ target, url }) => (
      shoot(url, WARMUP_SEC, s.expectedBodies, `${s.name}/${target.label} warm-up`, s.request, s.paths, s.requestSequence)
    )));
    process.stdout.write(' done\n');

    const measured: TargetResult[] = [];
    for (const { target, url } of scenarioTargets) {
      measured.push({
        label: target.label,
        result: await measure(target.label, url, s.expectedBodies, s.request, s.paths, s.requestSequence),
      });
    }

    const targets = TARGETS.map((target) => {
      const result = measured.find((item) => item.label === target.label);
      if (!result) {
        throw new Error(`missing result for ${target.label}`);
      }
      return result;
    });

    return { name: s.name, description: s.description, targets };
  } finally {
    await stopTargets(processes);
  }
}

function rotationFor(index: number): TargetConfig[] {
  const offset = index % TARGETS.length;
  return [...TARGETS.slice(offset), ...TARGETS.slice(0, offset)];
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: WDIR,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    child.on('error', reject);
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

function startTargets(appShape: AppShape): ChildProcess[] {
  return TARGETS.map((target) => {
    const child = spawn(target.command, target.args, {
      cwd: WDIR,
      detached: true,
      env: { ...process.env, BENCH_APP_SHAPE: appShape, PORT: String(target.port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${target.name}] ${String(d)}`));
    return child;
  });
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout | undefined;
    const settle = (): void => {
      if (timeout) {
        clearTimeout(timeout);
      }

      child.removeListener('exit', settle);
      resolve();
    };

    timeout = setTimeout(settle, timeoutMs);
    child.once('exit', settle);
  });
}

function signalTarget(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopTargets(processes: readonly ChildProcess[]): Promise<void> {
  for (const child of processes) {
    signalTarget(child, 'SIGTERM');
  }

  await Promise.all(processes.map((child) => waitForChildExit(child, 1_500)));

  for (const child of processes) {
    signalTarget(child, 'SIGKILL');
  }

  await Promise.all(processes.map((child) => waitForChildExit(child, 1_000)));
}

async function buildBunTarget(): Promise<void> {
  await rm(FLUO_BUN_BUILD_DIR, { force: true, recursive: true });
  await runCommand('pnpm', [
    'exec',
    'tsc',
    'src/fluo-bun/server.ts',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--strict',
    '--skipLibCheck',
    '--outDir',
    'dist/fluo-bun',
  ]);
}

async function buildFluoFastifyTarget(): Promise<void> {
  await rm(FLUO_FASTIFY_BUILD_DIR, { force: true, recursive: true });
  await runCommand('pnpm', [
    'exec',
    'tsc',
    'src/fluo/server.ts',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--strict',
    '--skipLibCheck',
    '--outDir',
    'dist/fluo-fastify',
  ]);
}

async function buildNestTarget(): Promise<void> {
  await rm(NESTJS_BUILD_DIR, { force: true, recursive: true });
  await runCommand('pnpm', ['exec', 'tsc', '-p', 'nestjs/tsconfig.json', '--outDir', 'dist/nestjs']);
  await writeFile(join(NESTJS_BUILD_DIR, 'package.json'), '{"type":"commonjs"}\n');
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricSnapshot(result: Result): MetricSnapshot {
  return {
    errors: result.errors,
    latencyAverage: result.latency.average,
    latencyP50: result.latency.p50,
    latencyP97_5: result.latency.p97_5,
    latencyP99: result.latency.p99,
    mismatches: result.mismatches,
    non2xx: result.non2xx,
    requestsAverage: result.requests.average,
    throughputAverage: result.throughput.average,
    timeouts: result.timeouts,
  };
}

function averageResult(results: readonly Result[]): Result {
  const first = results[0];
  if (!first) {
    throw new Error('Cannot average an empty result set.');
  }

  return {
    ...first,
    errors: Math.round(average(results.map((result) => result.errors))),
    mismatches: Math.round(average(results.map((result) => result.mismatches))),
    non2xx: Math.round(average(results.map((result) => result.non2xx))),
    requests: {
      ...first.requests,
      average: average(results.map((result) => result.requests.average)),
    },
    throughput: {
      ...first.throughput,
      average: average(results.map((result) => result.throughput.average)),
    },
    timeouts: Math.round(average(results.map((result) => result.timeouts))),
    latency: {
      ...first.latency,
      average: average(results.map((result) => result.latency.average)),
      p50: average(results.map((result) => result.latency.p50)),
      p97_5: average(results.map((result) => result.latency.p97_5)),
      p99: average(results.map((result) => result.latency.p99)),
    },
  };
}

function averageScenarioResults(runs: readonly ScenarioResult[][]): ScenarioResult[] {
  const firstRun = runs[0];
  if (!firstRun) {
    throw new Error('Cannot average an empty run set.');
  }

  return firstRun.map((scenario, scenarioIndex) => ({
    description: scenario.description,
    name: `${scenario.name} (${String(runs.length)}-run avg)`,
    targets: scenario.targets.map((target) => {
      const targetResults = runs.map((run) => {
        const matchingScenario = run[scenarioIndex];
        return matchingScenario?.targets.find((candidate) => candidate.label === target.label)?.result;
      }).filter((result): result is Result => result !== undefined);

      if (targetResults.length !== runs.length) {
        throw new Error(`Missing ${target.label} samples for ${scenario.name}: got ${String(targetResults.length)} of ${String(runs.length)}`);
      }

      return {
        label: target.label,
        result: averageResult(targetResults),
        samples: targetResults.map(metricSnapshot),
      };
    }),
  }));
}

function environmentSummary(): EnvironmentSummary {
  const cpu = cpus()[0];
  return {
    arch: arch(),
    cpuCount: cpus().length,
    cpuModel: cpu?.model ?? 'unknown',
    node: process.version,
    platform: platform(),
  };
}

async function writeBenchmarkOutput(rawRuns: readonly ScenarioResult[][], averaged: readonly ScenarioResult[], environment: EnvironmentSummary): Promise<void> {
  const compactRuns = rawRuns.map((run, runIndex) => ({
    run: runIndex + 1,
    scenarios: run.map((scenario) => ({
      description: scenario.description,
      name: scenario.name,
      targets: scenario.targets.map((target) => ({
        label: target.label,
        metrics: metricSnapshot(target.result),
      })),
    })),
  }));

  const compactAverage = averaged.map((scenario) => ({
    description: scenario.description,
    name: scenario.name,
    targets: scenario.targets.map((target) => ({
      label: target.label,
      metrics: metricSnapshot(target.result),
      samples: target.samples ?? [metricSnapshot(target.result)],
    })),
  }));

  await writeFile(OUTPUT_JSON, `${JSON.stringify({
    benchmark: 'http-comparison',
    connections: CONNECTIONS,
    durationSeconds: MEASURE_SEC,
    environment,
    runs: RUNS,
    rawRuns: compactRuns,
    scenarios: compactAverage,
    warmupSeconds: WARMUP_SEC,
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  await buildNestTarget();
  await buildFluoFastifyTarget();
  await buildBunTarget();

  const scenarios = selectedScenarios();
  const runs: ScenarioResult[][] = [];
  for (let run = 0; run < RUNS; run += 1) {
    if (RUNS > 1) {
      console.log(`Run ${String(run + 1)} of ${String(RUNS)}`);
    }

    const results: ScenarioResult[] = [];
    for (const [index, s] of scenarios.entries()) {
      console.log(`Scenario: ${s.name}`);
      results.push(await runScenario(s, index + run));
    }
    runs.push(results);
  }

  const averagedResults = RUNS === 1 ? runs[0] ?? [] : averageScenarioResults(runs);
  const environment = environmentSummary();
  await writeBenchmarkOutput(runs, averagedResults, environment);
  printReport(averagedResults, {
    connections: CONNECTIONS,
    duration: MEASURE_SEC,
    environment,
    outputJson: OUTPUT_JSON,
    runs: RUNS,
    warmup: WARMUP_SEC,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
