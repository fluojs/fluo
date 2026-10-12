import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { buildTarget, startTargets, stopTargets, TARGETS, waitForTarget } from '../src/targets';
import { authenticateTimingIdentity, prepareTimingIdentity } from '../src/timing-identity';
import { observeWorkerd, WorkerdFailure } from '../src/workerd';

function fixture(inspectorPort?: number) {
  const child = new ChildProcess();
  const pipe = new PassThrough();
  const signals: (NodeJS.Signals | number | undefined)[] = [];
  child.kill = (signal) => { signals.push(signal); return true; };
  Object.defineProperty(child, 'stdio', { value: [null, null, null, pipe] });
  const raw: string[] = [];
  const state = observeWorkerd(child, { command: 'workerd', args: ['serve'] }, {
    port: 12345, inspectorPort, timeoutMs: 50,
    onRaw: (bytes) => raw.push(String(bytes)),
  });
  return { child, pipe, raw, state, signals };
}

test('workerd readiness: fragmented and multiple control lines -> preserves raw events and late readiness', async () => {
  const { child, pipe, raw, state } = fixture(12346);
  try {
    const early = waitForTarget(child);
    pipe.write('{"event":"lis');
    pipe.write('ten","socket":"http","port":12345}\n{"event":"listen-inspector","port":12346}\n');
    await early;

    await waitForTarget(child);

    assert.equal(state.messages.length, 2);
    assert.equal(raw.length, 2);
    assert.deepEqual(state.raw, [
      '{"event":"listen","socket":"http","port":12345}',
      '{"event":"listen-inspector","port":12346}',
    ]);
  } finally { pipe.destroy(); child.emit('close', 0, null); }
});

for (const defect of ['malformed', 'wrong-port', 'wrong-socket', 'inspector', 'early-exit', 'closed-pipe', 'timeout'] as const) {
  test(`workerd readiness: ${defect} -> rejects instead of certifying a serving subject`, async () => {
    const { child, pipe, state, signals } = fixture();
    const readiness = assert.rejects(waitForTarget(child), WorkerdFailure);
    try {
      switch (defect) {
        case 'malformed': pipe.write('not-json\n'); break;
        case 'wrong-port': pipe.write('{"event":"listen","socket":"http","port":12344}\n'); break;
        case 'wrong-socket': pipe.write('{"event":"listen","socket":"foreign","port":12345}\n'); break;
        case 'inspector': pipe.write('{"event":"listen-inspector","port":12345}\n'); break;
        case 'early-exit': child.emit('exit', 1, null); break;
        case 'closed-pipe': pipe.end('{"event":'); break;
        case 'timeout': break; // Time is the behavior: the bounded control deadline must reject.
      }

      await readiness;

      assert.ok(state.failure);
      assert.ok(signals.includes('SIGTERM'), 'Readiness failure must stop the owned process');
    } finally { pipe.destroy(); child.emit('close', 0, null); }
  });
}

test('workerd readiness: duplicate listen after ready -> invalidates the retained subject', async () => {
  const { child, pipe, state } = fixture();
  try {
    pipe.write('{"event":"listen","socket":"http","port":12345}\n');
    await waitForTarget(child);

    pipe.write('{"event":"listen","socket":"http","port":12345}\n');

    assert.ok(state.failure instanceof WorkerdFailure);
  } finally { pipe.destroy(); child.emit('close', 0, null); }
});

test('workerd timing identity: real serving HTTP -> authenticates and rejects wrong process/config/bundle/endpoint', { timeout: 60_000 }, async () => {
  const target = TARGETS.find((item) => item.name === 'native-workers');
  assert.ok(target);
  await buildTarget(target);
  const prepared = await prepareTimingIdentity(target, 'stage-minimal');
  assert.ok(prepared.worker);
  let stdout = '';
  const children = startTargets('stage-minimal', [target], {
    quiet: true, onOutput: (_target, stream, bytes) => { if (stream === 'stdout') stdout += String(bytes); },
  });
  const bundle = await readFile(prepared.entry);
  try {
    await waitForTarget(children[0]);
    const pid = children[0].pid;
    assert.ok(pid);
    const response = await fetch(`http://127.0.0.1:${target.port}/stage`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');

    const identity = await authenticateTimingIdentity(prepared, stdout, pid, target.port);

    assert.equal(identity.instrumentation, 'none');
    assert.equal(identity.runtime.host, 'workerd');
    assert.equal(identity.opaqueIsolateId, 'not-observed');
    await assert.rejects(authenticateTimingIdentity(prepared, stdout, process.pid, target.port));
    await assert.rejects(authenticateTimingIdentity(prepared, stdout, pid, target.port + 1));
    await assert.rejects(authenticateTimingIdentity(prepared, stdout, pid, target.port, '192.0.2.1'));
    await assert.rejects(authenticateTimingIdentity({
      ...prepared, worker: { ...prepared.worker, path: prepared.entry },
    }, stdout, pid, target.port));
    await writeFile(prepared.worker.path, `${prepared.worker.text}\n// changed config\n`);
    await assert.rejects(authenticateTimingIdentity(prepared, stdout, pid, target.port));
    await writeFile(prepared.worker.path, prepared.worker.text);
    await writeFile(prepared.entry, Buffer.concat([bundle, Buffer.from('\n// changed bundle\n')]));
    await assert.rejects(authenticateTimingIdentity(prepared, stdout, pid, target.port));
  } finally {
    await writeFile(prepared.entry, bundle);
    await writeFile(prepared.worker.path, prepared.worker.text);
    await stopTargets(children);
  }
});

test('stopTargets: workerd interrupted before collector request -> cannot retrospectively declare owned shutdown', { timeout: 20_000 }, async () => {
  const target = TARGETS.find((item) => item.name === 'native-workers');
  assert.ok(target);
  await buildTarget(target);
  const children = startTargets('stage-minimal', [target], { quiet: true });
  try {
    await waitForTarget(children[0]);
    const pid = children[0].pid;
    assert.ok(pid);
    const closed = once(children[0], 'close');
    children[0].kill('SIGINT');
    await closed;

    const [receipt] = await stopTargets(children, {
      owner: 'profile-collector', target: target.name, phase: 'control-before', pid,
      traffic: { path: 'uncreated.json', bytes: 1, sha256: '0'.repeat(64), materializedMs: performance.now() },
      profile: null,
    });

    assert.equal(children[0].signalCode, 'SIGINT');
    assert.equal(receipt.intent, null);
    assert.equal(receipt.signalSent, false);
  } finally { await stopTargets(children); }
});
