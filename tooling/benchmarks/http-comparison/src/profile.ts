import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceJournal } from './evidence';
import { load } from './load';
import {
  type CaptureStatus, 
  object, PROFILE_MODES, type ProfileCapture, type ProfileCondition, ProfileFailure, type ProfileMode, type ProfileRun,profileCompleteness, profileSummary, sha256, validateCapture,
} from './profile-report';
import { RawCapture, RuntimeCapture } from './profiling';
import { type EnvironmentSummary, environmentSummary } from './provenance';
import { monitorServer } from './resources';
import type { ScenarioConfig } from './scenarios';
import { selectSuite } from './suites';
import { buildTarget, startTargets, stopTargets, TARGETS, type TargetConfig, type TargetLaunchOptions, targetLaunch, WDIR, waitForTarget } from './targets';

export interface CapturePlan {
  readonly targets: readonly TargetConfig[];
  readonly scenarios: readonly ScenarioConfig[];
  readonly modes: readonly ProfileMode[];
  readonly configuration: 'default' | 'equivalent';
  readonly connections: number;
  readonly repeats: number;
  readonly warmupSeconds: number;
  readonly durationSeconds: number;
  readonly controlSeconds: number;
  readonly portBase: number;
  readonly inspectorPortBase: number;
  readonly outputDirectory: string;
}

export function selectProfileTargets(names?: readonly string[]): readonly TargetConfig[] {
  if (!names) return TARGETS;
  if (names.length === 0 || new Set(names).size !== names.length || names.some((name) => !TARGETS.some((target) => target.name === name))) {
    throw new ProfileFailure('selection', 'Profile targets must be unique known TARGETS', names);
  }
  return TARGETS.filter((target) => names.includes(target.name));
}

function withPort(target: TargetConfig, port: number): TargetConfig {
  const args = [...target.args];
  const flag = args.indexOf('--port');
  if (flag >= 0) args[flag + 1] = String(port);
  if (target.platform === 'deno') args[args.length - 1] = String(port);
  return { ...target, port, args };
}

export async function captureCondition(input: {
  readonly plan: CapturePlan;
  readonly target: TargetConfig;
  readonly scenario: ScenarioConfig;
  readonly condition: ProfileCondition;
  readonly environment: EnvironmentSummary;
  readonly provenanceSha256: string;
  readonly journal: EvidenceJournal;
}): Promise<ProfileCapture> {
  const { plan, scenario, condition, journal } = input;
  const index = TARGETS.findIndex((target) => target.name === input.target.name);
  const target = withPort(input.target, plan.portBase + index);
  const directory = join(plan.outputDirectory, `${condition.target}-${condition.scenario}-${condition.mode}-${condition.repeat}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const raw = new RawCapture(plan.outputDirectory, directory);
  raw.save('build', 'provenance.json', input.environment);
  const runs: ProfileRun[] = [];
  let session: RuntimeCapture | null = null;
  let status: CaptureStatus = 'supported';
  let reason: string | null = null;
  let profilePath: string | null = null;
  const limitations = [
    'Development capture controls are not capacity, budget, or full-matrix evidence.',
    'Process-tree CPU includes host/control descendants; not per-request isolate CPU.',
    'Clock anchors bracket a serving monotonic read; no unsynchronized clock subtraction.',
    'Generated frames remain unresolved unless a source map is separately validated.',
    'V8 sampling includes collected objects; sampled bytes are not exact allocation counts/rates.',
    'Reused target builds are hashed; this invocation does not claim a fresh root build.',
    'workerd Tracing.start rejection proves only that protocol unsupported; passive isolate GC capture remains blocked/unproven.',
  ];
  try {
    if (target.platform === 'nextjs') {
      const traceBytes = await readFile(join(WDIR, 'nextjs', target.product, '.next/trace'), 'utf8');
      const trace = traceBytes.split('\n').filter(Boolean).flatMap((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!Array.isArray(parsed)) throw new ProfileFailure('build', 'Malformed canonical Next build trace');
        return parsed.map(object);
      });
      if (!trace.some((event) => event.name === 'next-build' && object(event.tags).bundler === 'turbopack')) {
        throw new ProfileFailure('build', 'Canonical production Next requires Turbopack build evidence');
      }
      raw.save('build', 'next-build.json', { buildId: await readFile(join(WDIR, 'nextjs', target.product, '.next/BUILD_ID'), 'utf8'), trace });
    }
    const entry = target.platform === 'workers' ? target.args[2]
      : target.platform === 'nextjs' ? `nextjs/${target.product}/.next/server/app/[[...path]]/route.js`
      : target.platform === 'deno' ? target.args[target.args.length - 2] : target.args[target.args.length - 1];
    raw.save('build', 'entry.json', { path: entry, sha256: sha256(await readFile(join(WDIR, entry))) });
    for (const phase of ['control-before', 'capture', 'control-after'] as const) {
      const instrumented = phase === 'capture';
      const options: TargetLaunchOptions = {
        env: { BENCH_CONFIGURATION: plan.configuration },
        ...(instrumented ? { inspectorPort: plan.inspectorPortBase + index, gcTrace: condition.mode === 'gc-eventloop' } : {}),
        quiet: true,
        onOutput: (_target, stream, bytes) => raw.append(stream, `${phase}.${stream}.log`, bytes),
      };
      const launch = targetLaunch(target, scenario.appShape, options);
      const processes = startTargets(scenario.appShape, [target], options);
      const child = processes[0];
      let measured: Awaited<ReturnType<typeof monitorServer<Awaited<ReturnType<typeof load>>>>> | undefined;
      let startedMs = 0;
      let endedMs = 0;
      try {
        journal.current = { ...condition, phase, step: 'startup', directory };
        await waitForTarget(child);
        const pid = child.pid;
        if (pid === undefined) throw new ProfileFailure('subject', 'Missing launcher PID');
        const traffic = { url: `http://${process.env.BENCH_SERVER_HOST ?? '127.0.0.1'}:${target.port}`, connections: plan.connections, requests: scenario.requests };
        await load({ ...traffic, duration: 1, connections: 1, amount: 1 }, `${target.name}/profile-cold`);
        await load({ ...traffic, duration: plan.warmupSeconds }, `${target.name}/profile-warmup`);
        if (instrumented) {
          session = await RuntimeCapture.connect(target, pid, plan.inspectorPortBase + index, raw);
          try { await session.start(condition.mode); }
          catch (error) {
            if (error instanceof ProfileFailure && target.platform === 'workers' && condition.mode === 'gc-eventloop'
              && error.phase === 'protocol' && object(error.detail).code === -32601) {
              status = 'unsupported';
              reason = `Application inspector Tracing.start unsupported: ${error.message}`;
              session.close();
            } else throw error;
          }
        }
        journal.current = { ...condition, phase, step: 'traffic', directory };
        startedMs = performance.now();
        measured = await monitorServer(pid, () => load({ ...traffic, duration: instrumented ? plan.durationSeconds : plan.controlSeconds }, `${target.name}/${condition.mode}/${phase}`));
        endedMs = performance.now();
        if (instrumented && status === 'supported') profilePath = await session?.stop(condition.mode) ?? null;
        if (raw.failure) throw raw.failure;
      } finally {
        if (instrumented) session?.close();
        await stopTargets(processes);
        if (measured) runs.push({
          ...measured, phase, instrumentation: instrumented ? condition.mode : 'none',
          launcherPid: child.pid ?? 0, startedMs, endedMs,
          launch: { command: launch.command, args: launch.args, cwd: launch.cwd, env: { BENCH_CONFIGURATION: plan.configuration, BENCH_APP_SHAPE: scenario.appShape, PORT: String(target.port), NEXT_TELEMETRY_DISABLED: '1', WRANGLER_SEND_METRICS: 'false' } },
          exit: { code: child.exitCode, signal: child.signalCode },
        });
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    status = error instanceof ProfileFailure && ['discovery', 'build', 'subject'].includes(error.phase) ? 'blocked' : 'failed';
    reason = `${error.name}: ${error.message}`;
    journal.fail(error);
    raw.save('diagnostics', 'failure.json', { phase: journal.current, name: error.name, message: error.message, detail: error instanceof ProfileFailure ? error.detail : null });
  }
  const capture: ProfileCapture = {
    condition, status, reason, subject: session?.subject ?? null, format: session?.format ?? null,
    anchors: session?.anchors ?? [], identityPath: session?.identityPath ?? null, profilePath, runs,
    artifacts: await raw.artifacts(), provenanceSha256: input.provenanceSha256, limitations,
  };
  if (status === 'supported') {
    const bytes = new Map(await Promise.all(capture.artifacts.map(async (artifact) => [artifact.path, await readFile(join(plan.outputDirectory, artifact.path))] as const)));
    const errors = validateCapture(capture, bytes);
    if (errors.length > 0) {
      const failure = new ProfileFailure('validity', errors.join(', '));
      journal.fail(failure);
      return { ...capture, status: 'failed', reason: failure.message };
    }
  }
  journal.current = null;
  return capture;
}

export async function runProfiles(plan: CapturePlan) {
  const root = join(WDIR, 'results/profiling');
  const within = relative(root, plan.outputDirectory);
  if (within.startsWith('..') || within.startsWith('/')) throw new ProfileFailure('output', 'Profile output must be contained in results/profiling');
  if (plan.targets.length === 0 || plan.scenarios.length === 0 || plan.modes.length === 0) throw new ProfileFailure('selection', 'Empty profile plan');
  await mkdir(plan.outputDirectory, { recursive: true });
  const environment = await environmentSummary();
  const provenance = JSON.stringify(environment);
  const provenanceSha256 = sha256(provenance);
  const top = new RawCapture(plan.outputDirectory, plan.outputDirectory);
  top.save('build', 'provenance.json', environment);
  const captures: ProfileCapture[] = [];
  const required = plan.targets.flatMap((target) => plan.scenarios.flatMap((scenario) => plan.modes.flatMap((mode) =>
    Array.from({ length: plan.repeats }, (_, repeat): ProfileCondition => ({ target: target.name, platform: target.platform, scenario: scenario.name, configuration: plan.configuration, connections: plan.connections, repeat, mode })))));
  const journal = new EvidenceJournal(join(plan.outputDirectory, 'manifest.json'), () => ({
    schemaVersion: 1, kind: 'http-profile-captures', plan, provenanceSha256, captures, required,
    acceptanceStatus: 'incomplete', limitations: ['Subset captures do not satisfy the full issue3910 timing/profile matrix.'],
  }));
  try {
    for (const condition of required) {
      const target = plan.targets.find((item) => item.name === condition.target);
      const scenario = plan.scenarios.find((item) => item.name === condition.scenario);
      if (!target || !scenario) throw new ProfileFailure('selection', 'Unknown profile condition');
      captures.push(await captureCondition({ plan, target, scenario, condition, environment, provenanceSha256, journal }));
      journal.flush();
    }
    const raw = new Map(await Promise.all(captures.flatMap((capture) => capture.artifacts).map(async (artifact) =>
      [artifact.path, await readFile(join(plan.outputDirectory, artifact.path))] as const)));
    const coverage = profileCompleteness(captures, required, raw);
    top.save('diagnostics', 'report.json', { coverage, acceptanceStatus: 'incomplete', captures: captures.map(profileSummary) });
    return { captures, coverage, outputDirectory: plan.outputDirectory };
  } finally { journal.finish(); }
}

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ProfileFailure('configuration', `${name} must be a positive integer`);
  return value;
}
async function main(): Promise<void> {
  const targets = selectProfileTargets(process.env.BENCH_TARGETS?.split(','));
  const scenarios = selectSuite().filter((scenario) => !process.env.BENCH_SCENARIOS || process.env.BENCH_SCENARIOS.split(',').includes(scenario.name));
  const configuration = process.env.BENCH_CONFIGURATION ?? 'equivalent';
  if (configuration !== 'default' && configuration !== 'equivalent') throw new ProfileFailure('configuration', 'Invalid BENCH_CONFIGURATION');
  const modes = PROFILE_MODES.filter((mode) => !process.env.BENCH_PROFILE_MODES || process.env.BENCH_PROFILE_MODES.split(',').includes(mode));
  if (process.env.BENCH_PROFILE_BUILD === '1') for (const target of targets) await buildTarget(target);
  const result = await runProfiles({
    targets, scenarios, modes, configuration, connections: positive('BENCH_CONNECTIONS', 64),
    repeats: positive('BENCH_PROFILE_RUNS', 1), warmupSeconds: positive('BENCH_WARMUP_SEC', 5),
    durationSeconds: positive('BENCH_MEASURE_SEC', 15), controlSeconds: positive('BENCH_CONTROL_SEC', 15),
    portBase: positive('BENCH_PROFILE_PORT_BASE', 35111), inspectorPortBase: positive('BENCH_INSPECTOR_PORT_BASE', 35211),
    outputDirectory: join(WDIR, 'results/profiling', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`),
  });
  console.log(JSON.stringify({ outputDirectory: result.outputDirectory, coverage: result.coverage }));
  if (result.coverage.status !== 'complete') process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
