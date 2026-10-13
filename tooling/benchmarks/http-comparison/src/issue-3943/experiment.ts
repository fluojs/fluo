import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceJournal } from '../evidence';
import { load } from '../load';
import { object, sha256 } from '../profile-report';
import { RawCapture } from '../profiling';
import { environmentSummary } from '../provenance';
import { monitorServer } from '../resources';
import { SCENARIOS, STAGE_SCENARIOS } from '../scenarios';
import { startTargets, stopTargets, TARGETS, waitForTarget, WDIR } from '../targets';
import { authenticateTimingIdentity, prepareTimingIdentity } from '../timing-identity';
import { armMetrics, type Observation, phaseVerdict } from './analysis';
import { retainCondition } from './condition';
import { type Arm, DESIGN, diagnosticArms } from './design';
import { authenticateGenerator, type GeneratorRequest } from './generator-identity';
import { authenticateFrozenInput, parseFrozenInput, type FrozenInput } from './identity';
import { assertTransport } from './transport';

async function collectArm(input: FrozenInput, arm: Arm, raw: RawCapture, journal: EvidenceJournal) {
  const selected = TARGETS.find((item) => item.name === DESIGN.target);
  const scenario = [...SCENARIOS, ...STAGE_SCENARIOS].find((item) => item.name === arm.workload);
  if (!selected || !scenario) throw new Error('Frozen Workers target/workload unavailable');
  const target = { ...selected, port: input.transport.serverPort };
  const name = `${arm.phase}-${arm.workload}-${arm.connections}-${arm.pair}-${arm.label}`;
  journal.current = { arm, step: 'identity' };
  const prepared = await prepareTimingIdentity(target, scenario.appShape);
  await authenticateFrozenInput(input);
  raw.save('identity', `${name}.prepared.json`, prepared);
  let stdout = '';
  const children = startTargets(scenario.appShape, [target], {
    env: { BENCH_CONFIGURATION: DESIGN.configuration }, quiet: true,
    onOutput: (_target, stream, bytes) => {
      raw.append(stream, `${name}.${stream}.log`, bytes);
      if (stream === 'stdout') stdout += bytes.toString();
    },
  });
  const observedNonces = new Set<string>();
  return retainCondition(async () => {
    await waitForTarget(children[0]);
    const pid = children[0].pid;
    if (pid === undefined) throw new Error('Missing direct workerd PID');
    raw.save('identity', `${name}.identity-before.json`,
      await authenticateTimingIdentity(prepared, stdout, pid, target.port, input.transport.serverHost));
    const options = {
      url: `http://${input.transport.serverHost}:${target.port}`,
      requests: scenario.requests, connections: arm.connections / arm.workers,
    };
    // Persist each original as soon as it completes, including first request and
    // warmup. Promise.allSettled retains sibling outcomes when a generator fails.
    const traffic = async (step: string, duration: number, amount?: number) => {
      journal.current = { arm, step };
      assertTransport(input.transport);
      const outcomes = await Promise.allSettled(Array.from({ length: arm.workers }, async (_value, index) => {
        const request: GeneratorRequest = {
          ...options, duration, ...(amount === undefined ? {} : { amount, connections: 1 }),
          issue3943: { token: randomUUID() },
        };
        raw.save('identity', `${name}.${step}-${index}.request.json`, request);
        const measured = await load(request, `${name}/${step}/${index}`);
        raw.save('diagnostics', `${name}.${step}-${index}.json`, measured);
        const generator = authenticateGenerator(input.generator, object(measured).generator, request);
        assertTransport(input.transport);
        if (observedNonces.has(generator.nonce)) throw new Error('Remote generator response nonce was reused');
        observedNonces.add(generator.nonce);
        return { ...measured, generator };
      }));
      const values = [];
      for (const outcome of outcomes) {
        switch (outcome.status) {
          case 'fulfilled': values.push(outcome.value); break;
          case 'rejected': journal.fail(outcome.reason); break;
        }
      }
      journal.flush();
      if (outcomes.some((outcome) => outcome.status === 'rejected')) throw new Error('Traffic phase failed; originals retained');
      return values;
    };
    await traffic('first-request', 1, 1);
    await traffic('warmup', arm.warmupSeconds);
    await authenticateFrozenInput(input);
    const measurement = await monitorServer(pid, () => traffic('ordinary', arm.captureSeconds));
    raw.save('diagnostics', `${name}.resources.json`, measurement);
    raw.save('identity', `${name}.identity-after.json`,
      await authenticateTimingIdentity(prepared, stdout, pid, target.port, input.transport.serverHost));
    await authenticateFrozenInput(input);
    const observation = { arm, measurement };
    armMetrics(observation);
    if (raw.failure) throw raw.failure;
    return observation;
  }, async () => {
    const cleanup = await Promise.allSettled([
      stopTargets(children).then((receipts) => { raw.save('identity', `${name}.shutdown.json`, receipts); }),
    ]);
    const failures: unknown[] = [];
    for (const outcome of cleanup) {
      if (outcome.status === 'rejected') {
        failures.push(outcome.reason);
        journal.fail(outcome.reason);
      }
    }
    if (raw.failure) {
      failures.push(raw.failure);
      journal.fail(raw.failure);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Condition cleanup failed');
  }, journal);
}

async function main(): Promise<void> {
  const [freezePath, runId, ...extra] = process.argv.slice(2);
  if (!freezePath || !runId || extra.length || !/^[a-zA-Z0-9-]+$/.test(runId)) {
    throw new TypeError('Usage: node --import tsx src/issue-3943/experiment.ts <frozen.json> <unique-run-id>');
  }
  if (process.env.BENCH_CONFIGURATION && process.env.BENCH_CONFIGURATION !== 'default') throw new Error('Only default configuration is authorized');
  if (process.env.NODE_OPTIONS || process.execArgv.some((arg) => /inspect|profiler/.test(arg))) {
    throw new Error('Instrumented ordinary processes are not authorized');
  }
  const root = join(WDIR, 'results/issue-3943');
  await mkdir(root, { recursive: true });
  const directory = join(root, runId);
  await mkdir(directory); // EEXIST fails: a run ID is never reused or overwritten.
  const raw = new RawCapture(directory, directory);
  const observations: Observation[] = [];
  const verdicts: unknown[] = [];
  const journal = new EvidenceJournal(join(directory, 'manifest.json'), () => ({
    issue: 3943, design: DESIGN, observations, verdicts,
    performance: 'NOT_ESTABLISHED', adoption: 'BLOCKED', issueClosure: 'BLOCKED',
    profiles: { status: 'BLOCKED', reason: 'Parent must release profiles after independent capacity and A/A review; no fallback.' },
  }));
  try {
    journal.current = { step: 'freeze' };
    const bytes = await readFile(resolve(freezePath));
    raw.save('build', 'frozen-input.json', { path: resolve(freezePath), sha256: sha256(bytes), original: bytes.toString('utf8') });
    const input = parseFrozenInput(JSON.parse(bytes.toString('utf8')));
    assertTransport(input.transport);
    raw.save('build', 'environment.json', await environmentSummary());
    await authenticateFrozenInput(input);
    for (const arm of diagnosticArms().filter((item) => item.phase === input.phase)) {
      await journal.record(arm, observations, async (complete) => {
        complete(await collectArm(input, arm, raw, journal));
      });
      journal.flush();
    }
    verdicts.push(phaseVerdict(observations, input.phase));
    journal.flush();
  } catch (error) {
    journal.fail(error);
    throw error;
  } finally {
    try { raw.save('diagnostics', 'artifacts.json', await raw.artifacts()); }
    finally { journal.finish(); }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
import { randomUUID } from 'node:crypto';
