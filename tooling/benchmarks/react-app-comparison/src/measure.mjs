import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, cpus, platform, release, totalmem } from 'node:os';

export const FRAMEWORKS = ['fluo', 'next', 'react-router', 'tanstack-start'];
export const PROFILES = Object.freeze({
  desktop: Object.freeze({ cpuSlowdown: 1, latencyMs: 20, downloadBytesPerSecond: 1_250_000,
    uploadBytesPerSecond: 1_250_000, viewport: { width: 1440, height: 900 } }),
  tablet: Object.freeze({ cpuSlowdown: 4, latencyMs: 150, downloadBytesPerSecond: 200_000,
    uploadBytesPerSecond: 93_750, viewport: { width: 820, height: 1180 } }),
});
export const METRICS = [
  'coldTtfbMs', 'warmTtfbMs', 'shellArrivalMs', 'lcpMs', 'hydrationMainThreadMs',
  'interactionPendingP50Ms', 'interactionPendingP95Ms', 'interactionApprovedP50Ms',
  'interactionApprovedP95Ms', 'transferredJsBytes', 'compressedJsBytes',
  'transferredCssBytes', 'compressedCssBytes', 'requestCount',
  'throughputRequestsPerSecond', 'errorRate', 'cpuPercent', 'rssBytes',
  'devColdReadyMs', 'devReactEditVisibleMs', 'devCssEditVisibleMs',
  'devServerEditVisibleMs',
];

export function planMeasurements(config) {
  const device = config.profile?.split('-')[0];
  if (!Object.hasOwn(PROFILES, device) || config.profile !== `${device}-${config.mode}`) throw new RangeError(`unknown profile: ${config.profile}`);
  if (!['native', 'matched-cache'].includes(config.mode)) throw new RangeError(`unknown mode: ${config.mode}`);
  for (const [label, count] of [['warmupRuns', config.warmupRuns], ['measurementRuns', config.measurementRuns]]) {
    if (!Number.isSafeInteger(count) || count < (label === 'measurementRuns' ? 1 : 0)) throw new RangeError(`invalid ${label}`);
  }
  if (FRAMEWORKS.some((framework) => !config.apps?.[framework])) throw new RangeError('all four framework app URLs are required');
  return Array.from({ length: config.warmupRuns + config.measurementRuns }, (_, cycle) =>
    FRAMEWORKS.map((_, slot) => ({
      profile: config.profile, mode: config.mode, framework: FRAMEWORKS[(cycle + slot) % FRAMEWORKS.length],
      device,
      runId: `${config.profile}-${config.mode}-cycle-${cycle + 1}-slot-${slot + 1}`,
      warmup: cycle < config.warmupRuns, url: config.apps[FRAMEWORKS[(cycle + slot) % FRAMEWORKS.length]],
    }))).flat();
}

export async function collectMeasurements(config, driver, directory) {
  const plan = planMeasurements(config);
  await mkdir(directory, { recursive: true });
  const runs = [];
  const warmups = [];
  for (const item of plan) {
    const correctness = await driver.check(item, config);
    const observation = correctness.pass ? await driver.measure(item, config) : { metrics: {}, unavailable: {} };
    const metrics = observation.metrics ?? {};
    for (const [name, value] of Object.entries(metrics)) {
      if (!METRICS.includes(name) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`invalid measurement: ${name}`);
      }
    }
    const unavailable = Object.fromEntries(METRICS.filter((name) => !Object.hasOwn(metrics, name))
      .map((name) => [name, observation.unavailable?.[name] ?? (name.startsWith('dev') ? 'not measured in production-browser mode' : 'not observed')]));
    const trace = resolve(directory, `${item.runId}-${item.framework}.json`);
    await writeFile(trace, `${JSON.stringify({
      schemaVersion: 1, ...item, provenance: config.provenance, profileSettings: PROFILES[item.device],
      environment: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model,
        cpuCores: cpus().length, memoryBytes: totalmem(), runtimeVersion: process.version,
        browserVersion: driver.browserVersion ?? null },
      correctness, metrics, unavailable, requests: observation.requests ?? [], timings: observation.timings ?? {},
      artifacts: observation.artifacts ?? {},
    }, null, 2)}\n`);
    const run = {
      profile: item.profile, mode: item.mode, framework: item.framework, runId: item.runId,
      trace, warmupRuns: config.warmupRuns, correctness: correctness.pass ? 'pass' : 'fail', metrics,
    };
    (item.warmup ? warmups : runs).push(run);
  }
  return { schemaVersion: 1, provenance: config.provenance, profile: config.profile, mode: config.mode, warmups, runs };
}

export async function collectDevMeasurements(config, driver, directory) {
  const steps = {
    'cold-ready': 'devColdReadyMs', 'react-edit': 'devReactEditVisibleMs',
    'css-edit': 'devCssEditVisibleMs', 'server-edit': 'devServerEditVisibleMs',
  };
  return collectMeasurements(config, {
    browserVersion: driver.browserVersion,
    check: (item) => driver.check(item, config),
    async measure(item) {
      try {
        const metrics = {};
        const timings = {};
        for (const [kind, metric] of Object.entries(steps)) {
          if (kind !== 'cold-ready' && driver.restartDev) {
            const readiness = await driver.restartDev(item, config);
            if (!readiness.pass) throw new Error(`${item.framework} ${kind} dev startup failed: ${JSON.stringify(readiness.steps)}`);
            timings[`${kind}-ready`] = readiness;
          }
          const observation = await driver.measureDev(item, config, kind);
          if (!observation?.event || !Number.isFinite(observation.durationMs) || observation.durationMs < 0) {
            throw new RangeError(`invalid ${kind} observation`);
          }
          metrics[metric] = observation.durationMs;
          timings[kind] = observation;
        }
        return { metrics, timings, unavailable: Object.fromEntries(METRICS.filter((name) => !name.startsWith('dev'))
          .map((name) => [name, 'not measured in development mode'])) };
      } finally {
        await driver.closeDev?.(item);
      }
    },
  }, directory);
}

export async function mergeEvidence(production, development, directory) {
  await mkdir(directory, { recursive: true });
  const devRuns = new Map(development.runs.map((run) => [`${run.runId}:${run.framework}`, run]));
  const runs = [];
  for (const run of production.runs) {
    const dev = devRuns.get(`${run.runId}:${run.framework}`);
    if (!dev) throw new Error(`missing development evidence: ${run.runId}/${run.framework}`);
    const trace = resolve(directory, `${run.runId}-${run.framework}.json`);
    await writeFile(trace, `${JSON.stringify({
      schemaVersion: 1, sourceTraces: [run.trace, dev.trace],
      correctness: { production: run.correctness, development: dev.correctness },
    }, null, 2)}\n`);
    runs.push({ ...run, trace, correctness: run.correctness === 'pass' && dev.correctness === 'pass' ? 'pass' : 'fail',
      metrics: { ...run.metrics, ...dev.metrics } });
  }
  return { ...production, runs, developmentWarmups: development.warmups };
}

export async function verifyTraceFiles(runs, outputRoot) {
  const root = await realpath(outputRoot);
  async function verify(path, sources = false) {
    if (!path || !isAbsolute(path)) throw new Error(`invalid trace path: ${path}`);
    let actual;
    let record;
    try {
      actual = await realpath(path);
      const location = relative(root, actual);
      if (location.startsWith('..') || isAbsolute(location)) throw new Error('outside output root');
      record = JSON.parse(await readFile(actual, 'utf8'));
    } catch (error) {
      throw new Error(`invalid trace ${path}: ${error}`);
    }
    if (record.schemaVersion !== 1) throw new Error(`incomplete trace ${path}: schemaVersion`);
    if (sources) {
      if (!record.provenance || !record.environment || !record.correctness || !record.metrics || !record.unavailable
        || !record.profileSettings || !Array.isArray(record.requests)) {
        throw new Error(`incomplete raw trace ${path}`);
      }
    } else if (Array.isArray(record.sourceTraces)) {
      if (record.sourceTraces.length !== 2 || !record.correctness) throw new Error(`incomplete combined trace ${path}`);
      for (const source of record.sourceTraces) await verify(source, true);
    } else {
      await verify(path, true);
    }
  }
  for (const run of runs) await verify(run.trace);
}

async function main() {
  const flags = process.argv.slice(2);
  const configPath = flags[flags.indexOf('--config') + 1];
  const outputPath = flags[flags.indexOf('--output') + 1];
  if (!configPath || !outputPath || !flags.includes('--config') || !flags.includes('--output')) {
    throw new Error('usage: node src/measure.mjs --config <JSON> --output <JSON>');
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const { createBrowserDriver } = await import('./measure-browser.mjs');
  const output = resolve(outputPath);
  const devOnly = flags.includes('--dev');
  const driver = await createBrowserDriver(config, { devMode: devOnly });
  let result;
  try {
    result = devOnly
      ? await collectDevMeasurements(config, driver, join(dirname(output), 'dev-traces'))
      : await collectMeasurements(config, driver, join(dirname(output), 'traces'));
  } finally { await driver.close(); }
  if (!devOnly && config.dev) {
    const devDriver = await createBrowserDriver(config, { devMode: true });
    try {
      const development = await collectDevMeasurements(config, devDriver, join(dirname(output), 'dev-traces'));
      result = await mergeEvidence(result, development, join(dirname(output), 'combined-traces'));
    } finally { await devDriver.close(); }
  }
  await verifyTraceFiles([...result.runs, ...result.warmups, ...(result.developmentWarmups ?? [])], dirname(output));
  const baselinePath = flags[flags.indexOf('--baseline') + 1];
  if (flags.includes('--gate') && !baselinePath) throw new Error('--gate requires --baseline <JSON>');
  if (flags.includes('--gate')) {
    const { evaluatePerformance } = await import('./evaluate.ts');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    result = { ...result, evaluation: evaluatePerformance(baseline, result.runs) };
    if (result.evaluation.verdict !== 'pass') process.exitCode = 1;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  if (result.runs.some((run) => run.correctness === 'fail')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
