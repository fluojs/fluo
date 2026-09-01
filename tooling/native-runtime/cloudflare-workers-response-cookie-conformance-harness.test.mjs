import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';

import {
  runWithWorker,
  startWorker,
  stopProcessGroup,
} from './cloudflare-workers-response-cookie-conformance-harness.mjs';

function createChild(pid, exitCode = null) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = exitCode;
  return child;
}

function esrch() {
  return Object.assign(new Error('no such process'), { code: 'ESRCH' });
}

test('preserves startup and cleanup errors', async () => {
  const startupError = new Error('workerd exited before readiness');
  const cleanupError = new Error('process group remained after SIGTERM');

  await assert.rejects(
    runWithWorker(
      { child: createChild(1001), ready: Promise.reject(startupError) },
      async () => assert.fail('operation must not run after startup failure'),
      async () => {
        throw cleanupError;
      },
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.includes(startupError) &&
      error.errors.includes(cleanupError),
  );
});

test('preserves fetch and cleanup errors', async () => {
  const fetchError = new Error('fetch failed');
  const cleanupError = new Error('process group remained after SIGTERM');

  await assert.rejects(
    runWithWorker(
      { child: createChild(1002), ready: Promise.resolve({ url: 'http://127.0.0.1:1002' }) },
      async () => {
        throw fetchError;
      },
      async () => {
        throw cleanupError;
      },
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.includes(fetchError) &&
      error.errors.includes(cleanupError),
  );
});

test('preserves assertion and cleanup errors', async () => {
  const assertionError = new Error('unexpected Set-Cookie fields');
  const cleanupError = new Error('process group remained after SIGTERM');

  await assert.rejects(
    runWithWorker(
      { child: createChild(1003), ready: Promise.resolve({ url: 'http://127.0.0.1:1003' }) },
      async () => {
        throw assertionError;
      },
      async () => {
        throw cleanupError;
      },
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.includes(assertionError) &&
      error.errors.includes(cleanupError),
  );
});

test('cleans up after a successful worker operation', async () => {
  let stopped = false;

  const result = await runWithWorker(
    { child: createChild(1004), ready: Promise.resolve({ url: 'http://127.0.0.1:1004' }) },
    async () => 'conformance passed',
    async () => {
      stopped = true;
    },
  );

  assert.equal(result, 'conformance passed');
  assert.equal(stopped, true);
});

test('waits for the subscribed leader exit and proves normal process-group cleanup', async () => {
  const child = createChild(1005);
  const childExited = once(child, 'exit');
  const calls = [];
  const kill = (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 'SIGTERM') {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, 'SIGTERM');
        child.emit('close', 0, 'SIGTERM');
      });
      return true;
    }
    throw esrch();
  };

  await stopProcessGroup(child, kill);
  await childExited;

  assert.deepEqual(calls, [
    [-1005, 'SIGTERM'],
    [-1005, 0],
  ]);
});

test('accepts an already-exited process group', async () => {
  const child = createChild(1006, 0);
  const calls = [];

  await stopProcessGroup(child, (pid, signal) => {
    calls.push([pid, signal]);
    throw esrch();
  });

  assert.deepEqual(calls, [[-1006, 'SIGTERM']]);
});

test('waits for the subscribed stdio close before proving group cleanup', async () => {
  const child = createChild(1007);
  const childExited = once(child, 'exit');
  const calls = [];
  const cleanup = stopProcessGroup(child, (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 'SIGTERM') {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, 'SIGTERM');
      });
      return true;
    }
    throw esrch();
  });

  await childExited;
  await Promise.resolve();
  assert.deepEqual(calls, [[-1007, 'SIGTERM']]);

  child.emit('close', 0, 'SIGTERM');
  await cleanup;
  assert.deepEqual(calls, [
    [-1007, 'SIGTERM'],
    [-1007, 0],
  ]);
});

test('rejects a stubborn descendant without sending a force-exit signal', async () => {
  const child = createChild(1008);
  const childExited = once(child, 'exit');
  const calls = [];
  const kill = (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 'SIGTERM') {
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('exit', 0, 'SIGTERM');
        child.emit('close', 0, 'SIGTERM');
      });
      return true;
    }
    return true;
  };

  await assert.rejects(
    stopProcessGroup(child, kill),
    /process group 1008 still has running descendants after SIGTERM/,
  );
  await childExited;

  assert.deepEqual(calls, [
    [-1008, 'SIGTERM'],
    [-1008, 0],
  ]);
});

test('uses separate dynamic loopback ports for concurrent Workers conformance runs', async () => {
  const calls = [];
  const spawnWorker = (_command, args, options) => {
    const child = createChild(1009 + calls.length);
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const port = 53000 + calls.length;
    calls.push({ args, options });

    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(`Ready on http://127.0.0.1:${port}`));
    });

    return child;
  };
  const workers = [startWorker(spawnWorker), startWorker(spawnWorker)];
  const [{ url: firstUrl }, { url: secondUrl }] = await Promise.all(workers.map((worker) => worker.ready));

  assert.notEqual(firstUrl, secondUrl);
  assert.equal(calls.length, 2);
  for (const { args, options } of calls) {
    assert.equal(args[args.indexOf('--port') + 1], '0');
    assert.equal(options.detached, true);
  }
});
