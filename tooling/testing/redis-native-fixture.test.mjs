import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EventEmitter } from 'node:events';

import { parseRedisPort, redisReady, startRedisFixture } from './redis-native-fixture.mjs';

test('recognizes split Redis readiness output from either stream', () => {
  assert.equal(redisReady(['Ready to accept ', 'connections']), true);
  assert.equal(redisReady(['stderr: Ready to accept connections']), true);
  assert.equal(redisReady(['loading dataset']), false);
});

test('accepts only valid TCP Redis ports', () => {
  assert.equal(parseRedisPort('0.0.0.0:6379\n'), 6379);
  assert.throws(() => parseRedisPort('0.0.0.0:65536\n'), /port/u);
});

test('does not return after Redis log and docker port before host TCP accepts', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let tcpSubscribed;
  let allowTcp;
  let readinessSubscribed;
  const tcpSubscribedSignal = new Promise((resolve) => { tcpSubscribed = resolve; });
  const readinessSubscribedSignal = new Promise((resolve) => { readinessSubscribed = resolve; });
  const stdoutOn = child.stdout.on.bind(child.stdout);
  child.stdout.on = (event, listener) => {
    if (event === 'data') readinessSubscribed();
    return stdoutOn(event, listener);
  };
  const fixture = startRedisFixture({
    containerName: 'fixture',
    execFile: async () => ({ stdout: '127.0.0.1:6379\n' }),
    spawn: () => child,
    waitForTcp: () => {
      tcpSubscribed();
      return new Promise((resolve) => { allowTcp = resolve; });
    },
  });
  await readinessSubscribedSignal;
  child.stdout.emit('data', Buffer.from('Ready to accept connections'));
  await tcpSubscribedSignal;
  let settled = false;
  fixture.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  allowTcp();
  assert.equal((await fixture).port, 6379);
  child.emit('close', 0, null);
});

test('writes structured image-pull diagnostics before container startup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-redis-diagnostic-'));
  const diagnosticPath = join(directory, 'redis.json');
  const failure = Object.assign(new Error('pull failed'), {
    code: 1,
    signal: null,
    stderr: 'registry unavailable',
    stdout: 'pulling image',
  });

  try {
    await assert.rejects(startRedisFixture({
      containerName: 'fixture',
      diagnosticPath,
      execFile: async () => { throw failure; },
      spawn: () => { throw new Error('container must not start'); },
    }), /pull failed/u);

    const diagnostic = JSON.parse(readFileSync(diagnosticPath, 'utf8'));
    assert.partialDeepStrictEqual(diagnostic.phases[0], {
      argv: ['pull', 'redis:7.4-alpine'],
      command: 'docker',
      exitCode: 1,
      name: 'image-pull',
      status: 'failed',
      stderr: 'registry unavailable',
      stdout: 'pulling image',
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test('bounds docker commands with the remaining shared startup budget', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const timeouts = [];
  let readinessSubscribed;
  const readinessSubscribedSignal = new Promise((resolve) => { readinessSubscribed = resolve; });
  const stdoutOn = child.stdout.on.bind(child.stdout);
  child.stdout.on = (event, listener) => {
    if (event === 'data') readinessSubscribed();
    return stdoutOn(event, listener);
  };
  const fixturePromise = startRedisFixture({
    budgetMs: 100,
    containerName: 'fixture',
    execFile: async (_command, args, options) => {
      timeouts.push(options.timeout);
      return { stderr: '', stdout: args[0] === 'port' ? '127.0.0.1:6379\n' : '' };
    },
    now: () => 0,
    spawn: () => child,
    waitForTcp: async () => {},
  });
  await readinessSubscribedSignal;
  child.stdout.emit('data', Buffer.from('Ready to accept connections'));
  const fixture = await fixturePromise;
  assert.deepEqual(timeouts, [100, 100]);
  child.emit('close', 0, null);
  await fixture.cleanup();
});
