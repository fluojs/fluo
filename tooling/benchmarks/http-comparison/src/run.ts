import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceJournal } from './evidence';
import { load } from './load';
import { environmentSummary, WORKSPACE_ROOT } from './provenance';
import { printReport, type ScenarioResult, summarizeRuns, type TargetResult } from './report';
import { monitorServer, type ProcessSample } from './resources';
import { SCENARIOS, type ScenarioConfig } from './scenarios';
import { buildCommands, buildTarget, runCommand, startTargets, stopTargets, TARGETS, type TargetConfig, WDIR, waitForTarget } from './targets';
import { measureTargets } from './traffic';

const WARMUP_SEC = readPositiveIntegerEnv('BENCH_WARMUP_SEC', 10);
const MEASURE_SEC = readPositiveIntegerEnv('BENCH_MEASURE_SEC', 40);
const CONNECTIONS = readPositiveIntegerEnv('BENCH_CONNECTIONS', 100);
const CONCURRENCY_SWEEP = process.env.BENCH_CONCURRENCY_SWEEP?.split(',').map(Number) ?? [CONNECTIONS];
if (CONCURRENCY_SWEEP.some((value) => !Number.isSafeInteger(value) || value < 1)
  || new Set(CONCURRENCY_SWEEP).size !== CONCURRENCY_SWEEP.length) {
  throw new Error('BENCH_CONCURRENCY_SWEEP must contain unique positive integers');
}
const RUNS = readPositiveIntegerEnv('BENCH_RUNS', 5);
const OUTPUT_JSON = process.env.BENCH_OUTPUT_JSON ?? join(WDIR, 'benchmark-results.json');
const CONFIGURATION = process.env.BENCH_CONFIGURATION ?? 'default';
if (CONFIGURATION !== 'default' && CONFIGURATION !== 'equivalent') {
  throw new Error('BENCH_CONFIGURATION must be default or equivalent');
}

function readScenarioFilter(): Set<string> | undefined {
  const raw = process.env.BENCH_SCENARIOS;
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }

  return new Set(raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0));
}

function readTargetFilter(): Set<string> | undefined {
  const raw = process.env.BENCH_TARGETS;
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

function selectedTargets(): readonly TargetConfig[] {
  const filter = readTargetFilter();
  if (!filter) {
    return TARGETS;
  }

  const selected = TARGETS.filter((target) => filter.has(target.name));
  const knownNames = new Set<string>(TARGETS.map((target) => target.name));
  const unknown = [...filter].filter((name) => !knownNames.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown BENCH_TARGETS entries: ${unknown.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('BENCH_TARGETS did not select any targets.');
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

async function runScenario(scenario: ScenarioConfig, run: {
  index: number; repeat: number; targets: readonly TargetConfig[]; connections: number;
  samples: TargetResult[]; journal: EvidenceJournal;
}): Promise<void> {
  const { index, targets, connections, samples, journal } = run;
  const offset = index % targets.length;
  const rotated = [...targets.slice(offset), ...targets.slice(0, offset)];
  for (const target of rotated) {
  const condition = { configuration: CONFIGURATION, scenario: scenario.name, target: target.name, connections, repeat: run.repeat };
  await journal.record({ ...condition, phase: 'startup' }, samples, async (complete) => {
  const start = performance.now();
  const processes = startTargets(scenario.appShape, [target]);
  try {
    await Promise.all(processes.map(waitForTarget));
    const processToReadyMs = performance.now() - start;
    const traffic = (target: TargetConfig, duration: number) => ({
      url: `http://${process.env.BENCH_SERVER_HOST ?? '127.0.0.1'}:${target.port}`,
      duration, connections, requests: scenario.requests,
    });
    journal.current = { ...condition, phase: 'cold-request', processToReadyMs };
    const firstRequest = await load({ ...traffic(target, 1), connections: 1, amount: 1 }, `${target.name} cold request`);
    const measured = await measureTargets([target], {
      warmup: async (target) => {
        journal.current = { ...condition, phase: 'warmup', processToReadyMs, firstRequest };
        process.stdout.write(`  warming ${target.label} (${WARMUP_SEC}s)...`);
        await load(traffic(target, WARMUP_SEC), `${scenario.name}/${target.label} warm-up`);
        process.stdout.write(' done\n');
      },
      measure: async (target) => {
        const serverSamples: ProcessSample[] = [];
        journal.current = { ...condition, phase: 'measurement', processToReadyMs, firstRequest, serverSamples };
        process.stdout.write(`  measuring ${target.label} (${MEASURE_SEC}s)...`);
        const pid = processes[0].pid;
        if (pid === undefined) throw new Error(`Missing server PID for ${target.name}`);
        const measured = await monitorServer(pid, () => load(traffic(target, MEASURE_SEC), `${scenario.name}/${target.label}`), serverSamples);
        process.stdout.write(' done\n');
        return {
          label: target.label, ...measured.value, server: measured.server,
          coldStart: { processToReadyMs, firstRequest, boundary: 'process-spawn-to-ready-and-first-http-request; not deployed isolate cold start' },
        };
      },
    });
    complete(measured[0]);
    journal.current = { ...condition, phase: 'teardown', measurementCompleted: true };
  } finally {
    await stopTargets(processes);
  }
  });
  }
}

async function main(): Promise<void> {
  const targets = selectedTargets();
  const scenarios = selectedScenarios();
  // Use the existing root build path, including each package's clean prebuild.
  // No reuse/skip flag: linked package dist must belong to this invocation.
  await runCommand('pnpm', ['--dir', WORKSPACE_ROOT, 'build']);
  if (process.env.BENCH_LOAD_PROCESS === '1') {
    await runCommand('pnpm', ['exec', 'esbuild', 'src/load-client.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--outfile=dist/load-client.mjs']);
  }
  for (const target of targets) await buildTarget(target);
  const environment = await environmentSummary();
  const sweeps: { connections: number; rawRuns: ScenarioResult[][] }[] = [];
  const journal = new EvidenceJournal(OUTPUT_JSON, () => ({
    schemaVersion: 3, benchmark: 'http-comparison', configuration: CONFIGURATION,
    durationSeconds: MEASURE_SEC, warmupSeconds: WARMUP_SEC, runs: RUNS,
    environment, build: { workspaceRoot: WORKSPACE_ROOT, commands: buildCommands, freshWorkspaceBuild: true },
    traffic: scenarios, sweeps, baselineStatus: 'inconclusive',
    limitations: ['Generator headroom and default/equivalent completeness require separate evidence; these samples alone do not establish a complete baseline.'],
  }));
  try {
  for (const connections of CONCURRENCY_SWEEP) {
  const rawRuns: ScenarioResult[][] = [];
  sweeps.push({ connections, rawRuns });
  for (let run = 0; run < RUNS; run += 1) {
    console.log(`Run ${run + 1} of ${RUNS}`);
    const results: ScenarioResult[] = [];
    rawRuns.push(results);
    for (const [index, scenario] of scenarios.entries()) {
      console.log(`Scenario: ${scenario.name}`);
      const samples: TargetResult[] = [];
      results.push({ name: scenario.name, description: scenario.description, targets: samples });
      await runScenario(scenario, { index: index + run, repeat: run, targets, connections, samples, journal });
    }
  }
  const summary = summarizeRuns(rawRuns);
  printReport(summary, {
    connections, duration: MEASURE_SEC, environment,
    outputJson: OUTPUT_JSON, runs: RUNS, warmup: WARMUP_SEC,
  });
  }
  } finally {
    journal.finish();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
