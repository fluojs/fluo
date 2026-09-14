import assert from 'node:assert/strict';
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
  const tcpSubscribedSignal = new Promise((resolve) => { tcpSubscribed = resolve; });
  const fixture = startRedisFixture({
    containerName: 'fixture',
    execFile: async () => ({ stdout: '127.0.0.1:6379\n' }),
    spawn: () => child,
    waitForTcp: () => {
      tcpSubscribed();
      return new Promise((resolve) => { allowTcp = resolve; });
    },
  });
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
