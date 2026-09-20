import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { environmentSummary, WORKSPACE_ROOT } from './provenance';
import { printReport, type ScenarioResult, summarizeRuns } from './report';
import { SCENARIOS, type ScenarioConfig } from './scenarios';
import { buildCommands, buildTarget, runCommand, startTargets, stopTargets, TARGETS, type TargetConfig, WDIR, waitForTarget } from './targets';
import { measureTargets, shoot } from './traffic';

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

async function runScenario(scenario: ScenarioConfig, index: number, targets: readonly TargetConfig[]): Promise<ScenarioResult> {
  const processes = startTargets(scenario.appShape, targets);
  try {
    await Promise.all(processes.map(waitForTarget));
    const offset = index % targets.length;
    const rotated = [...targets.slice(offset), ...targets.slice(0, offset)];
    const traffic = (target: TargetConfig, duration: number) => ({
      url: `http://127.0.0.1:${target.port}`,
      duration, connections: CONNECTIONS, requests: scenario.requests,
    });
    const measured = await measureTargets(rotated, {
      warmup: async (target) => {
        process.stdout.write(`  warming ${target.label} (${WARMUP_SEC}s)...`);
        await shoot(traffic(target, WARMUP_SEC), `${scenario.name}/${target.label} warm-up`);
        process.stdout.write(' done\n');
      },
      measure: async (target) => {
        process.stdout.write(`  measuring ${target.label} (${MEASURE_SEC}s)...`);
        const result = await shoot(traffic(target, MEASURE_SEC), `${scenario.name}/${target.label}`);
        process.stdout.write(' done\n');
        return { label: target.label, ...result };
      },
    });
    return {
      name: scenario.name, description: scenario.description,
      targets: targets.map((target) => {
        const sample = measured.find((item) => item.label === target.label);
        if (!sample) throw new Error(`Missing measurement for ${target.label}`);
        return sample;
      }),
    };
  } finally {
    await stopTargets(processes);
  }
}

async function main(): Promise<void> {
  const targets = selectedTargets();
  const scenarios = selectedScenarios();
  // Use the existing root build path, including each package's clean prebuild.
  // No reuse/skip flag: linked package dist must belong to this invocation.
  await runCommand('pnpm', ['--dir', WORKSPACE_ROOT, 'build']);
  await Promise.all(targets.map(buildTarget));
  const environment = await environmentSummary();
  const rawRuns: ScenarioResult[][] = [];
  for (let run = 0; run < RUNS; run += 1) {
    console.log(`Run ${run + 1} of ${RUNS}`);
    const results: ScenarioResult[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      console.log(`Scenario: ${scenario.name}`);
      results.push(await runScenario(scenario, index + run, targets));
    }
    rawRuns.push(results);
  }
  const summary = summarizeRuns(rawRuns);
  await writeFile(OUTPUT_JSON, `${JSON.stringify({
    schemaVersion: 2, benchmark: 'http-comparison',
    connections: CONNECTIONS, durationSeconds: MEASURE_SEC, warmupSeconds: WARMUP_SEC, runs: RUNS,
    environment, build: { workspaceRoot: WORKSPACE_ROOT, commands: buildCommands, freshWorkspaceBuild: true },
    traffic: scenarios, rawRuns, scenarios: summary,
  }, null, 2)}\n`);
  printReport(summary, {
    connections: CONNECTIONS, duration: MEASURE_SEC, environment,
    outputJson: OUTPUT_JSON, runs: RUNS, warmup: WARMUP_SEC,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
