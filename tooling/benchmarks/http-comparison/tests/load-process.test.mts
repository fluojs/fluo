import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, relative } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { LoadProcessFailure, LocalLoadSession } from '../src/load';
import { sourceSnapshot } from '../src/provenance';
import { runScenario } from '../src/run';
import { WDIR } from '../src/targets';
import { TrafficFailure } from '../src/traffic';
import { httpFixture, options, scenarioFixture, stopped } from './fixtures/load-session-support-3914.mjs';

let directory: string;
let entry: string;
before(async () => {
  const generatedRoot = fileURLToPath(new URL('../dist/', import.meta.url));
  await mkdir(generatedRoot, { recursive: true });
  directory = await mkdtemp(join(generatedRoot, 'load-session-generated-3914-'));
  entry = join(directory, 'load-client.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/load-client.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: entry });
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('load session fixture: generated client -> stays outside serving source attestation', async () => {
  const snapshot = await sourceSnapshot(WDIR);

  assert.equal(Object.hasOwn(snapshot, relative(WDIR, entry)), false);
});

test('runScenario: finite fresh servers -> same phase generator and distinct next session', { timeout: 30_000 }, async () => {
  const { target, samples, path, journal, scenario } = await scenarioFixture(directory, 'success');
  const previous = process.env.BENCH_LOAD_PROCESS;
  process.env.BENCH_LOAD_PROCESS = '1';
  try {
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await runScenario(scenario, { index: 0, repeat, targets: [target], connections: 1, samples, journal, amount: 3, loadClientEntry: entry });
    }
    journal.finish();

    const evidence = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(evidence.invalidAttempts.length, 0);
    const identities = evidence.samples.map((sample: {
      generator: { pid: number; nonce: string; protocol: string; node: string; executable: string; hostname: string };
      coldStart: { firstRequest: { generator: unknown } };
      warmup: { generator: unknown };
      servingIdentity: { pid: number };
      server: { samples: { processes: { pid: number }[] }[] };
    }) => {
      assert.deepEqual(sample.coldStart.firstRequest.generator, sample.generator);
      assert.deepEqual(sample.warmup.generator, sample.generator);
      assert.equal(sample.generator.protocol, 'local-session-v1');
      assert.equal(sample.generator.node, process.version);
      assert.equal(sample.generator.executable, process.execPath);
      assert.ok(sample.generator.hostname);
      assert.notEqual(sample.generator.pid, process.pid);
      assert.notEqual(sample.generator.pid, sample.servingIdentity.pid);
      assert.ok(sample.server.samples.every((row) => row.processes.every((process) => process.pid !== sample.generator.pid)));
      stopped(sample.generator.pid);
      stopped(sample.servingIdentity.pid);
      return sample.generator;
    });
    assert.notEqual(identities[0].pid, identities[1].pid);
    assert.notEqual(identities[0].nonce, identities[1].nonce);
    console.log(JSON.stringify({ correctnessOnly: true, sessions: identities }));
  } finally {
    if (previous === undefined) delete process.env.BENCH_LOAD_PROCESS;
    else process.env.BENCH_LOAD_PROCESS = previous;
    journal.finish();
  }
});

for (const defect of ['measurement', 'cleanup', 'measurement-cleanup'] as const) {
  test(`runScenario: generator ${defect} failure -> retains diagnostics and closes generator plus server`, { timeout: 20_000 }, async (context) => {
    const { target, samples, path, journal, scenario } = await scenarioFixture(directory, defect);
    const previous = process.env.BENCH_LOAD_PROCESS;
    process.env.BENCH_LOAD_PROCESS = '1';
    const close = LocalLoadSession.prototype.close;
    if (defect.includes('cleanup')) {
      context.mock.method(LocalLoadSession.prototype, 'close', async function (this: LocalLoadSession) {
        await close.call(this);
        throw new Error('fixture cleanup failure');
      });
    }
    try {
      await assert.rejects(runScenario(scenario, {
        index: 0, repeat: 0, targets: [{ ...target, args: [...target.args, ...(defect.startsWith('measurement') ? ['fail-measurement'] : [])] }],
        connections: 1, samples, journal, amount: 3, loadClientEntry: entry,
      }));
      journal.finish();

      const evidence = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(evidence.invalidAttempts.length, 1);
      const attempt = evidence.invalidAttempts[0];
      const sample = defect.startsWith('measurement') ? attempt.condition : evidence.samples[0];
      const generator = defect.startsWith('measurement') ? sample.firstRequest.generator : sample.generator;
      stopped(generator.pid);
      stopped(sample.servingIdentity.pid);
      if (defect.startsWith('measurement')) {
        assert.equal(evidence.samples.length, 0);
        assert.equal(sample.warmup.result.requests.total, 3);
        const loadFailure = defect === 'measurement-cleanup' ? attempt.error.cause.cause : attempt.error.cause;
        assert.ok(loadFailure.cause.traffic.result.non2xx > 0);
        assert.match(loadFailure.stdout, /local-session-v1/);
        if (defect === 'measurement-cleanup') assert.match(loadFailure.stderr, /fixture cleanup failure/);
      } else assert.match(attempt.error.message, /teardown failed/);
    } finally {
      context.mock.restoreAll();
      if (previous === undefined) delete process.env.BENCH_LOAD_PROCESS;
      else process.env.BENCH_LOAD_PROCESS = previous;
      journal.finish();
    }
  });
}

for (const defect of ['status', 'body'] as const) {
  test(`LocalLoadSession: real HTTP ${defect} failure -> preserves shoot diagnostics and closes child`, { timeout: 10_000 }, async () => {
    const fixture = await httpFixture(defect);
    const session = await LocalLoadSession.open(entry);
    try {
      const good = await session.load(options(fixture.url, '/ok'), 'cold');

      await assert.rejects(session.load(options(fixture.url), defect), (error: unknown) => {
        assert.ok(error instanceof LoadProcessFailure);
        assert.ok(error.cause instanceof TrafficFailure);
        assert.ok(error.cause.diagnostics.result);
        if (defect === 'status') assert.ok(error.cause.diagnostics.statusMismatches > 0);
        else assert.ok(error.cause.diagnostics.result.mismatches > 0);
        const wire = JSON.parse(error.stdout.trim().split('\n').at(-1) ?? '');
        assert.deepEqual(wire.generator, good.generator);
        stopped(good.generator.pid);
        return true;
      });
    } finally {
      await session.close();
      await fixture.close();
    }
  });
}

const failureEntry = fileURLToPath(new URL('./fixtures/load-session-failure-3914.mjs', import.meta.url));
test('LocalLoadSession.open: missing ready response -> times out and closes owned child', { timeout: 10_000 }, async (context) => {
  const previous = { defect: process.env.LOAD_SESSION_DEFECT, signal: process.env.LOAD_SESSION_SIGNAL };
  process.env.LOAD_SESSION_DEFECT = 'ready-hang';
  process.env.LOAD_SESSION_SIGNAL = join(directory, 'ready-hang-signal');
  const watcher = watch(directory);
  const signaled = once(watcher, 'change', { signal: AbortSignal.timeout(5_000) });
  context.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const opening = LocalLoadSession.open(failureEntry);
    const rejected = assert.rejects(opening, (error: unknown) => {
      assert.ok(error instanceof LoadProcessFailure);
      assert.match(error.message, /request 0 timed out/);
      assert.match(error.stderr, /fixture diagnostic/);
      const pid = error.stdout.match(/FIXTURE_PID=(\d+)/);
      assert.ok(pid);
      stopped(Number(pid[1]));
      return true;
    });
    await signaled;

    context.mock.timers.tick(120_001);
    await rejected;
  } finally {
    context.mock.timers.reset();
    watcher.close();
    if (previous.defect === undefined) delete process.env.LOAD_SESSION_DEFECT;
    else process.env.LOAD_SESSION_DEFECT = previous.defect;
    if (previous.signal === undefined) delete process.env.LOAD_SESSION_SIGNAL;
    else process.env.LOAD_SESSION_SIGNAL = previous.signal;
  }
});

for (const defect of ['ready-exit', 'ready-malformed', 'exit', 'malformed', 'wrong-id', 'bad-payload', 'nonzero-traffic', 'hang', 'buffer'] as const) {
  test(`LocalLoadSession: IPC ${defect} -> bounded rejection preserves diagnostics and owned cleanup`, { timeout: 10_000 }, async (context) => {
    const previous = process.env.LOAD_SESSION_DEFECT;
    process.env.LOAD_SESSION_DEFECT = defect;
    let session: LocalLoadSession | undefined;
    try {
      if (!defect.startsWith('ready-')) session = await LocalLoadSession.open(failureEntry);
      if (defect === 'hang') context.mock.timers.enable({ apis: ['setTimeout'] });

      const operation = session ? session.load(options('http://127.0.0.1:1'), defect) : LocalLoadSession.open(failureEntry);
      const rejected = assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof LoadProcessFailure);
        assert.match(error.stderr, /fixture diagnostic/);
        const pid = error.stdout.match(/FIXTURE_PID=(\d+)/);
        assert.ok(pid);
        stopped(Number(pid[1]));
        if (defect === 'hang') assert.match(error.message, /timed out/);
        return true;
      });
      if (defect === 'hang') context.mock.timers.tick(121_001);
      await rejected;
    } finally {
      context.mock.timers.reset();
      await session?.close();
      if (previous === undefined) delete process.env.LOAD_SESSION_DEFECT;
      else process.env.LOAD_SESSION_DEFECT = previous;
    }
  });
}

test('LocalLoadSession.close: prior external exit -> rejects instead of claiming owned shutdown', { timeout: 10_000 }, async (context) => {
  const previous = process.env.LOAD_SESSION_DEFECT;
  process.env.LOAD_SESSION_DEFECT = 'hang';
  const fork = childProcess.fork;
  let child: ReturnType<typeof fork> | undefined;
  let closed: ReturnType<typeof once> | undefined;
  context.mock.method(childProcess, 'fork', (...args: Parameters<typeof fork>) => {
    child = fork(...args);
    closed = once(child, 'close', { signal: AbortSignal.timeout(5_000) });
    return child;
  });
  syncBuiltinESMExports();
  let session: LocalLoadSession | undefined;
  try {
    session = await LocalLoadSession.open(failureEntry);
    assert.ok(child && closed);
    child.kill('SIGTERM');
    const [, signal] = await closed;
    assert.equal(signal, 'SIGTERM');

    await assert.rejects(session.close(), (error: unknown) => {
      assert.ok(error instanceof LoadProcessFailure);
      assert.match(error.message, /SIGTERM/);
      assert.match(error.stderr, /fixture diagnostic/);
      return true;
    });
  } finally {
    await session?.close();
    context.mock.restoreAll();
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.LOAD_SESSION_DEFECT;
    else process.env.LOAD_SESSION_DEFECT = previous;
  }
});

test('LocalLoadSession: overlapping request -> rejects without a second HTTP phase', { timeout: 10_000 }, async () => {
  const fixture = await httpFixture('body');
  const session = await LocalLoadSession.open(entry);
  try {
    const first = session.load(options(fixture.url, '/ok'), 'first');
    const firstRejected = assert.rejects(first, LoadProcessFailure);

    await assert.rejects(session.load(options(fixture.url, '/ok'), 'overlap'), LoadProcessFailure);
    await firstRejected;
  } finally {
    await session.close();
    await fixture.close();
  }
});
