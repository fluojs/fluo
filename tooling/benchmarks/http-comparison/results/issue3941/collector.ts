import { spawn } from 'node:child_process';
import { mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { EvidenceJournal } from '../../src/evidence';
import { Issue3941 } from '../../src/issue3941';
import { object, sha256 } from '../../src/profile-report';
import { environmentSummary, sourceSnapshot, WORKSPACE_ROOT } from '../../src/provenance';
import type { TargetResult } from '../../src/report';
import { SCENARIOS } from '../../src/scenarios';
import { buildCommands, buildTarget, runCommand, TARGETS, WDIR } from '../../src/targets';
import { prepareTimingIdentity } from '../../src/timing-identity';
import { Issue3941Dependencies } from './dependencies';

type Plan = ReturnType<typeof Issue3941.freeze>;
type Artifacts = Readonly<Record<string, string>>;
const root = join(WDIR, 'results/issue3941');
const authored = ['collector.ts', 'generator.ts', 'dependencies.ts', 'frozen-policy-collector-integrity.json'];
const metrics = ['throughput', 'cpu', 'p95', 'p99', 'rss'] as const;
const fastify = () => {
  const target = TARGETS.find((item) => item.name === Issue3941.policy.target);
  if (!target) throw new TypeError('Missing Fastify target');
  return target;
};
const positive = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TypeError('Positive finite original metric required');
  return value;
};
const single = (value: unknown): unknown => {
  if (!Array.isArray(value) || value.length !== 1) throw new TypeError('Exactly one original arm required');
  return value[0];
};

async function files(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await files(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

export class Issue3941Collector {
  static assertDigest(bytes: string | Buffer, expected: unknown, label: string): void {
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new TypeError('Invalid artifact digest');
    if (sha256(bytes) !== expected) throw new TypeError(`Artifact hash drift: ${label}`);
  }

  static async assertArtifacts(artifacts: Artifacts): Promise<void> {
    if (Object.keys(artifacts).length === 0) throw new TypeError('Empty artifact inventory');
    for (const [path, expected] of Object.entries(artifacts)) {
      Issue3941Collector.assertDigest(await readFile(path), expected, path);
    }
  }

  static async inventory(): Promise<Artifacts> {
    const paths = new Set<string>([
      process.execPath, join(WORKSPACE_ROOT, 'pnpm-lock.yaml'), join(WDIR, 'pnpm-lock.yaml'),
      join(WORKSPACE_ROOT, 'node_modules/.pnpm/lock.yaml'), join(WDIR, 'node_modules/.pnpm/lock.yaml'),
      ...authored.map((name) => join(root, name)), join(root, 'generator/load-client.mjs'),
      join(WORKSPACE_ROOT, 'package.json'), join(WORKSPACE_ROOT, 'pnpm-workspace.yaml'),
      join(WORKSPACE_ROOT, 'tsconfig.base.json'), join(WORKSPACE_ROOT, 'tooling/babel/babel.config.cjs'),
      join(WORKSPACE_ROOT, 'tooling/scripts/clean-dist.mjs'),
    ]);
    for (const directory of [join(WORKSPACE_ROOT, 'packages'), WDIR]) {
      for (const path of Object.keys(await sourceSnapshot(directory))) paths.add(join(directory, path));
    }
    for (const entry of await readdir(join(WORKSPACE_ROOT, 'packages'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(WORKSPACE_ROOT, 'packages', entry.name, 'dist');
      try { for (const path of await files(directory)) paths.add(path); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        // Some workspace packages do not emit dist; their source is still bound.
      }
    }
    for (const path of await files(join(WDIR, 'dist/fluo-fastify'))) paths.add(path);
    const dependencies = await Issue3941Dependencies.capture(join(WDIR, 'package.json'),
      ['@fluojs/runtime', '@fluojs/platform-fastify', '@fluojs/core', '@fluojs/http', '@fluojs/validation', 'tsx', 'yaml', 'autocannon']);
    for (const path of Object.keys(dependencies)) paths.add(path);
    return Object.fromEntries(await Promise.all([...paths].sort().map(async (path) => [await realpath(path), sha256(await readFile(path))] as const)));
  }

  static async prepare(path: string): Promise<void> {
    const output = resolve(path);
    if (dirname(output) !== root || !output.endsWith('.json')) throw new TypeError('Use an issue-owned prepared build JSON');
    const reservation = await open(output, 'wx');
    await reservation.close();
    await runCommand('pnpm', ['--dir', WORKSPACE_ROOT, 'build']);
    await buildTarget(fastify());
    await runCommand('pnpm', ['exec', 'esbuild', 'results/issue3941/generator.ts', '--bundle', '--platform=node',
      '--format=esm', '--packages=external', '--outfile=results/issue3941/generator/load-client.mjs']);
    const environment = await environmentSummary();
    const timing = await prepareTimingIdentity(fastify());
    const body = {
      version: 1, preflightSha256: Issue3941.policy.preflightSha256,
      commands: [...buildCommands], capturedAt: new Date().toISOString(), environment,
      servingBuildSha256: timing.artifactsSha256,
      generatorClientSha256: sha256(await readFile(join(root, 'generator/load-client.mjs'))),
      packagesSha256: sha256(JSON.stringify(await sourceSnapshot(join(WORKSPACE_ROOT, 'packages')))),
      artifacts: await Issue3941Collector.inventory(),
    };
    await writeFile(output, `${JSON.stringify({ ...body, sha256: sha256(JSON.stringify(body)) }, null, 2)}\n`);
  }

  static parsePrepared(input: unknown) {
    const { sha256: digest, ...body } = object(input);
    Issue3941Collector.assertDigest(JSON.stringify(body), digest, 'prepared manifest');
    if (body.version !== 1 || body.preflightSha256 !== Issue3941.policy.preflightSha256
      || !Array.isArray(body.commands) || body.commands.length !== 3) throw new TypeError('Fresh prepared build receipt required');
    const commands = body.commands.map(object);
    if (commands[0].command !== 'pnpm' || !isDeepStrictEqual(commands[0].args, ['--dir', WORKSPACE_ROOT, 'build'])
      || commands[1].command !== 'pnpm' || !Array.isArray(commands[1].args)
      || !commands[1].args.includes('src/fluo/server.ts')
      || commands[2].command !== 'pnpm' || !Array.isArray(commands[2].args)
      || !commands[2].args.includes('results/issue3941/generator.ts')) throw new TypeError('Prepared build command drift');
    const artifacts: Record<string, string> = {};
    for (const [path, hash] of Object.entries(object(body.artifacts))) {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Invalid prepared artifact');
      artifacts[path] = hash;
    }
    return { digest, body, artifacts };
  }

  static async assertPrepared(plan: Plan, input: unknown): Promise<void> {
    const prepared = Issue3941Collector.parsePrepared(input);
    if (prepared.digest !== plan.identities.source.preparedSha256
      || prepared.body.servingBuildSha256 !== plan.identities.source.buildSha256
      || prepared.body.packagesSha256 !== plan.identities.source.packagesSha256
      || prepared.body.generatorClientSha256 !== plan.identities.source.generatorClientSha256) {
      throw new TypeError('Prepared cohort binding drift');
    }
    await Issue3941Collector.assertArtifacts(prepared.artifacts);
    const observed = await Issue3941Collector.inventory();
    Issue3941Collector.assertDigest(JSON.stringify(observed), sha256(JSON.stringify(prepared.artifacts)), 'prepared inventory');
    await Issue3941.assertCurrent(plan);
  }

  static output(plan: Plan, slot: number): string {
    const run = plan.runs[slot];
    if (!Number.isSafeInteger(slot) || !run || run.phase !== 'aa') throw new TypeError('Unknown finite A/A slot');
    return join(root, plan.sha256, `${slot}-aa-${run.scenario}-${run.configuration}-${run.connections}-${run.pair}-${run.arm}.json`);
  }

  static assertGenerator(plan: Plan, input: unknown): void {
    const generator = object(input);
    const expected = {
      protocol: 'issue3941-generator-v1', node: plan.identities.generator.runtime,
      executable: plan.identities.generator.executable, executableSha256: plan.identities.generator.executableSha256,
      lockSha256: plan.identities.source.generatorLockSha256, clientSha256: plan.identities.source.generatorClientSha256,
      installedLockSha256: plan.identities.source.generatorInstalledLockSha256,
      dependenciesSha256: plan.identities.source.generatorDependenciesSha256,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (generator[key] !== value) throw new TypeError(`Generator identity drift: ${key}`);
    }
  }

  static assertEnvironment(env: Readonly<Record<string, string | undefined>>, expected: Readonly<Record<string, string>>, execArgv: readonly string[]): void {
    if (env.NODE_OPTIONS || !isDeepStrictEqual(execArgv, ['--import', 'tsx'])
      || Object.keys(env).some((key) => key.startsWith('BENCH_') && !(key in expected))) {
      throw new TypeError('Unexpected arm instrumentation or inherited benchmark setting');
    }
    for (const [key, value] of Object.entries(expected)) {
      if (env[key] !== value) throw new TypeError(`Fresh arm environment drift: ${key}`);
    }
  }

  static checkTraffic(plan: Plan, input: unknown): void {
    const traffic = object(input);
    const result = object(traffic.result);
    if (['errors', 'timeouts', 'non2xx', 'mismatches'].some((key) => result[key] !== 0)
      || traffic.statusMismatches !== 0 || 'driftDiagnostic' in traffic) throw new TypeError('Invalid original traffic');
    positive(object(result.requests).total);
    positive(object(result.requests).average);
    if (!Array.isArray(traffic.latencyHistogramMicros) || traffic.latencyHistogramMicros.length === 0
      || !traffic.clientCpu) throw new TypeError('Missing original traffic resources/histogram');
    Issue3941Collector.assertGenerator(plan, traffic.generator);
  }

  static sample(plan: Plan, slot: number, input: unknown) {
    const raw = object(input);
    const run = plan.runs[slot];
    if (raw.schemaVersion !== 3 || raw.runs !== 1 || raw.configuration !== run.configuration
      || raw.durationSeconds !== Issue3941.policy.measurementSeconds || raw.warmupSeconds !== Issue3941.policy.warmupSeconds) {
      throw new TypeError('Original schema3 timing contract drift');
    }
    const cohort = object(raw.cohort);
    if (cohort.planSha256 !== plan.sha256 || cohort.slot !== slot || !isDeepStrictEqual(cohort.run, run)
      || cohort.preparedSha256 !== plan.identities.source.preparedSha256) throw new TypeError('Original finite slot identity drift');
    if (!Array.isArray(raw.invalidAttempts) || raw.invalidAttempts.length !== 0) throw new TypeError('Original invalidAttempts prevent calibration');
    const sweep = object(single(raw.sweeps));
    if (sweep.connections !== run.connections) throw new TypeError('Original concurrency drift');
    const scenario = object(single(single(sweep.rawRuns)));
    if (scenario.name !== run.scenario) throw new TypeError('Original workload drift');
    const target = object(single(scenario.targets));
    if (target.label !== Issue3941.policy.target) throw new TypeError('Original target drift');
    Issue3941Collector.checkTraffic(plan, target);
    Issue3941Collector.checkTraffic(plan, target.warmup);
    Issue3941Collector.checkTraffic(plan, object(target.coldStart).firstRequest);
    const identity = object(target.servingIdentity);
    // Timing attests process.versions.node; the frozen environment records process.version.
    const nodeVersion = object(identity.runtime).node;
    if (identity.status !== 'authenticated' || identity.instrumentation !== 'none'
      || identity.executable !== plan.identities.server.executable
      || identity.executableSha256 !== plan.identities.server.executableSha256
      || typeof nodeVersion !== 'string' || `v${nodeVersion}` !== plan.identities.server.runtime
      || identity.artifactsSha256 !== plan.identities.source.buildSha256) throw new TypeError('Original serving identity drift');
    const server = object(target.server);
    if (!Array.isArray(server.samples) || server.samples.length < 2) throw new TypeError('Missing original server resource samples');
    return {
      throughput: positive(object(object(target.result).requests).average),
      cpu: positive(server.cpuSeconds) / positive(object(object(target.result).requests).total),
      p95: positive(object(target.latencyPercentilesMs).p95), p99: positive(object(target.latencyPercentilesMs).p99),
      rss: positive(server.peakRssBytes),
    };
  }

  static evaluate(plan: Plan, rows: readonly { readonly slot: number; readonly raw: unknown }[]) {
    const slots = plan.runs.flatMap((run, slot) => run.phase === 'aa' ? [slot] : []);
    if (rows.length !== 120 || rows.some((row, index) => row.slot !== slots[index])) throw new TypeError('Complete finite A/A matrix in frozen order required');
    const samples = rows.map(({ slot, raw }) => ({ run: plan.runs[slot], metrics: Issue3941Collector.sample(plan, slot, raw) }));
    const conditions = Issue3941.policy.workloads.flatMap((scenario) => Issue3941.policy.configurations.flatMap((configuration) =>
      Issue3941.policy.connections.map((connections) => {
        const selected = samples.filter((sample) => sample.run.scenario === scenario && sample.run.configuration === configuration && sample.run.connections === connections);
        return {
          condition: `${scenario}/${configuration}/${connections}`,
          metrics: metrics.map((metric) => {
            const pairs = Array.from({ length: Issue3941.policy.pairs }, (_, pair) => {
              const left = selected.find((sample) => sample.run.pair === pair && sample.run.arm === 'A1');
              const right = selected.find((sample) => sample.run.pair === pair && sample.run.arm === 'A2');
              if (!left || !right) throw new TypeError('Missing original pair');
              return { left: left.metrics[metric], right: right.metrics[metric] };
            });
            return { metric, pairs, ...Issue3941.calibration(pairs, metric === 'throughput' || metric === 'cpu' ? 0.03 : 0.05) };
          }),
        };
      })));
    const noiseEnvelope = Math.max(...conditions.flatMap((condition) => condition.metrics.filter((metric) => metric.metric === 'throughput')
      .flatMap((metric) => [Math.abs(metric.interval.lower), Math.abs(metric.interval.upper)])));
    return {
      status: conditions.every((condition) => condition.metrics.every((metric) => metric.status === 'PASS_NUMERIC_GATE_ONLY')) ? 'PASS_NUMERIC_GATE_ONLY' : 'FAIL',
      planSha256: plan.sha256, samples: rows.length, conditions, noiseEnvelope,
      remaining: ['independent generator headroom', 'concurrency-1 capacity/burst and server utilization evidence', 'real-request profiles', 'lead acceptance'],
    };
  }

  static async evaluateFiles(plan: Plan) {
    const rows: { slot: number; raw: unknown }[] = [];
    const artifacts: { path: string; sha256: string }[] = [];
    for (const [slot, run] of plan.runs.entries()) {
      if (run.phase !== 'aa') continue;
      const path = Issue3941Collector.output(plan, slot);
      const bytes = await readFile(path);
      const receipt: unknown = JSON.parse(await readFile(`${path}.receipt.json`, 'utf8'));
      Issue3941Collector.assertRaw(plan, slot, bytes, receipt);
      artifacts.push({ path, sha256: sha256(bytes) });
      rows.push({ slot, raw: JSON.parse(bytes.toString('utf8')) });
    }
    return { ...Issue3941Collector.evaluate(plan, rows), artifacts };
  }

  static assertRaw(plan: Plan, slot: number, bytes: Buffer, input: unknown): void {
    const receipt = object(input);
    if (receipt.planSha256 !== plan.sha256 || receipt.slot !== slot || receipt.preparedSha256 !== plan.identities.source.preparedSha256
      || receipt.path !== Issue3941Collector.output(plan, slot)) throw new TypeError('Original artifact receipt binding drift');
    Issue3941Collector.assertDigest(bytes, receipt.sha256, 'original schema3 arm');
  }

  static async assertOrder(plan: Plan, slot: number): Promise<void> {
    const slots = plan.runs.flatMap((run, index) => run.phase === 'aa' ? [index] : []);
    const index = slots.indexOf(slot);
    if (index < 0) throw new TypeError('Unknown finite A/A slot');
    if (index === 0) {
      const names = await readdir(dirname(Issue3941Collector.output(plan, slot)));
      if (names.some((name) => /^\d+-aa-.*\.json(?:\.receipt\.json)?$/.test(name))) throw new TypeError('Frozen order forbids restarting an existing cohort');
      return;
    }
    const previous = slots[index - 1];
    const path = Issue3941Collector.output(plan, previous);
    const bytes = await readFile(path);
    Issue3941Collector.assertRaw(plan, previous, bytes, JSON.parse(await readFile(`${path}.receipt.json`, 'utf8')));
    Issue3941Collector.sample(plan, previous, JSON.parse(bytes.toString('utf8')));
  }

  static async arm(plan: Plan, prepared: unknown, slot: number): Promise<void> {
    const output = Issue3941Collector.output(plan, slot);
    const run = plan.runs[slot];
    const command = Issue3941.command(plan, slot);
    Issue3941Collector.assertEnvironment(process.env, command.env, process.execArgv);
    await mkdir(dirname(output), { recursive: true });
    await Issue3941Collector.assertOrder(plan, slot);
    const reservation = await open(output, 'wx');
    await reservation.close();
    const environment = await environmentSummary();
    const scenario = SCENARIOS.find((item) => item.name === run.scenario);
    if (!scenario) throw new TypeError('Missing frozen workload');
    const samples: TargetResult[] = [];
    const journal = new EvidenceJournal(output, () => ({
      schemaVersion: 3, benchmark: 'http-comparison', configuration: run.configuration,
      durationSeconds: Issue3941.policy.measurementSeconds, warmupSeconds: Issue3941.policy.warmupSeconds, runs: 1,
      environment, traffic: [scenario],
      build: { workspaceRoot: WORKSPACE_ROOT, freshWorkspaceBuild: false, preparedOnceBeforeCohort: true, receipt: prepared },
      cohort: { planSha256: plan.sha256, slot, run, preparedSha256: plan.identities.source.preparedSha256 },
      sweeps: [{ connections: run.connections, rawRuns: [[{ name: scenario.name, description: scenario.description, targets: samples }]] }],
      baselineStatus: 'inconclusive',
      limitations: ['Prepared dependency/server build authenticated before and after fresh arm; no per-arm workspace build.', 'A/A numerical gates are not headroom/profile/adoption acceptance.'],
    }));
    try {
      await journal.record({ slot, phase: 'prepared-build-before' }, [], async () => {
        await Issue3941Collector.assertPrepared(plan, prepared);
      });
      // Import after the fresh process receives the complete frozen environment.
      const { runScenario } = await import('../../src/run');
      await runScenario(scenario, { index: 0, repeat: run.pair, targets: [{ ...fastify(), command: plan.identities.server.executable }],
        connections: run.connections, samples, journal });
      await journal.record({ slot, phase: 'prepared-build-after' }, [], async () => {
        await Issue3941Collector.assertPrepared(plan, prepared);
        Issue3941Collector.checkTraffic(plan, samples[0]);
        Issue3941Collector.checkTraffic(plan, samples[0].warmup);
        // runScenario retains the cold request in its original extended result.
        Issue3941Collector.checkTraffic(plan, object(object(samples[0]).coldStart).firstRequest);
      });
    } finally {
      journal.finish();
      await writeFile(`${output}.receipt.json`, `${JSON.stringify({
        path: output, planSha256: plan.sha256, slot, preparedSha256: plan.identities.source.preparedSha256,
        sha256: sha256(await readFile(output)),
      }, null, 2)}\n`, { flag: 'wx' });
    }
  }

  static async collect(plan: Plan, dispatch: (slot: number) => Promise<void>): Promise<void> {
    for (const [slot, run] of plan.runs.entries()) if (run.phase === 'aa') await dispatch(slot);
  }

  static async run(plan: Plan, prepared: unknown, planPath: string, preparedPath: string): Promise<void> {
    await Issue3941Collector.assertPrepared(plan, prepared);
    const directory = join(root, plan.sha256);
    await mkdir(directory); // Existing partial cohorts are never resumed or overwritten.
    await Issue3941Collector.collect(plan, async (slot) => {
      const command = Issue3941.command(plan, slot, planPath, preparedPath);
      const stdout = await open(join(directory, `${slot}.stdout.log`), 'wx');
      const stderr = await open(join(directory, `${slot}.stderr.log`), 'wx');
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith('BENCH_') || key === 'NODE_OPTIONS') delete env[key];
      try {
        await new Promise<void>((complete, reject) => {
          const child = spawn(command.command, command.args, { cwd: command.cwd, env: { ...env, ...command.env },
            stdio: ['ignore', stdout.fd, stderr.fd] });
          const interrupt = () => { child.kill('SIGTERM'); };
          process.once('SIGINT', interrupt);
          process.once('SIGTERM', interrupt);
          process.once('exit', interrupt);
          child.once('error', reject);
          child.once('close', (code, signal) => {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', interrupt);
            process.removeListener('exit', interrupt);
            if (code === 0) complete();
            else reject(new Error(`Finite arm ${slot} failed: ${signal ?? code}`));
          });
        });
      } finally {
        await stdout.close();
        await stderr.close();
      }
    });
    const evaluation = await Issue3941Collector.evaluateFiles(plan);
    await writeFile(join(directory, 'aa-evaluation.json'), `${JSON.stringify(evaluation, null, 2)}\n`, { flag: 'wx' });
    if (evaluation.status !== 'PASS_NUMERIC_GATE_ONLY') throw new TypeError('Frozen A/A numeric gate failed; no automatic rerun');
  }
}

async function main(): Promise<void> {
  const [action, planPath, preparedPath, slot] = process.argv.slice(2);
  if (action === 'prepare') {
    await Issue3941Collector.prepare(planPath);
    return;
  }
  if (!['arm', 'run-aa', 'evaluate'].includes(action)) throw new TypeError('Use prepare, arm, run-aa or evaluate');
  const plan = Issue3941.parse(JSON.parse(await readFile(planPath, 'utf8')));
  const prepared: unknown = JSON.parse(await readFile(preparedPath, 'utf8'));
  if (action === 'arm') {
    await Issue3941Collector.arm(plan, prepared, Number(slot));
    return;
  }
  if (action === 'run-aa') {
    await Issue3941Collector.run(plan, prepared, planPath, preparedPath);
    return;
  }
  await Issue3941Collector.assertPrepared(plan, prepared);
  const evaluation = await Issue3941Collector.evaluateFiles(plan);
  process.stdout.write(`${JSON.stringify(evaluation, null, 2)}\n`);
  if (evaluation.status !== 'PASS_NUMERIC_GATE_ONLY') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
