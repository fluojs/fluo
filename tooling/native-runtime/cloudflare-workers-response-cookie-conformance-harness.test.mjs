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

test('waits for inherited stdio close after a startup exit before proving group cleanup', async () => {
  const child = createChild(1007, 1);
  child.stdio = [undefined, new EventEmitter(), new EventEmitter()];
  const calls = [];
  let processGroupExists = true;
  let forcedTerminationSent = false;
  const cleanup = stopProcessGroup(child, (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 'SIGTERM') {
      return true;
    }
    if (signal === 'SIGKILL') {
      forcedTerminationSent = true;
      return true;
    }
    if (signal === 0 && processGroupExists) {
      return true;
    }
    throw esrch();
  });

  await Promise.all([
    cleanup,
    new Promise((resolve, reject) => {
      queueMicrotask(() => {
        try {
          assert.equal(forcedTerminationSent, true);
          processGroupExists = false;
          child.emit('close', 1, undefined);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    }),
  ]);
  assert.deepEqual(calls, [
    [-1007, 'SIGTERM'],
    [-1007, 0],
    [-1007, 'SIGKILL'],
    [-1007, 0],
  ]);
});

test('waits for delayed process-group disappearance after SIGKILL with a fake scheduler', async () => {
  const child = createChild(1011, 1);
  const calls = [];
  const scheduled = [];
  const observedStates = [true, false];
  const cleanup = stopProcessGroup(
    child,
    (pid, signal) => {
      calls.push([pid, signal]);
      return true;
    },
    undefined,
    {
      deadline: () => false,
      scheduler: (callback) => {
        scheduled.push(callback);
      },
      stateProbe: () => observedStates.shift() ?? false,
    },
  );

  await Promise.resolve();
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  await cleanup;

  assert.deepEqual(calls, [
    [-1011, 'SIGTERM'],
    [-1011, 0],
    [-1011, 'SIGKILL'],
  ]);
});

test('waits for an exited leader group without inherited stdio', async () => {
  const child = createChild(1012, 1);
  const calls = [];

  await stopProcessGroup(
    child,
    (pid, signal) => {
      calls.push([pid, signal]);
      return true;
    },
    undefined,
    {
      deadline: () => {
        throw new Error('an exited process group must not need a deadline');
      },
      scheduler: () => {
        throw new Error('an exited process group must not be scheduled');
      },
      stateProbe: () => false,
    },
  );

  assert.deepEqual(calls, [
    [-1012, 'SIGTERM'],
    [-1012, 0],
    [-1012, 'SIGKILL'],
  ]);
});

test('rejects a never-disappearing process group at a fake bounded deadline', async () => {
  const child = createChild(1013, 1);
  const calls = [];
  const scheduled = [];
  let probeCount = 0;
  const cleanup = stopProcessGroup(
    child,
    (pid, signal) => {
      calls.push([pid, signal]);
      return true;
    },
    undefined,
    {
      deadline: () => probeCount >= 2,
      scheduler: (callback) => {
        scheduled.push(callback);
      },
      stateProbe: () => {
        probeCount += 1;
        return true;
      },
    },
  );

  await Promise.resolve();
  assert.equal(scheduled.length, 1);
  scheduled.shift()();

  await assert.rejects(cleanup, /process group 1013 still has running descendants after forced termination/);
  assert.equal(probeCount, 2);
  assert.equal(scheduled.length, 0);
  assert.deepEqual(calls, [
    [-1013, 'SIGTERM'],
    [-1013, 0],
    [-1013, 'SIGKILL'],
  ]);
});

test('accepts ESRCH after SIGKILL while confirming process-group exit', async () => {
  const child = createChild(1014, 1);
  const calls = [];
  let probeCount = 0;

  await stopProcessGroup(child, (pid, signal) => {
    calls.push([pid, signal]);
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      return true;
    }
    probeCount += 1;
    if (probeCount === 1) {
      return true;
    }
    throw esrch();
  });

  assert.deepEqual(calls, [
    [-1014, 'SIGTERM'],
    [-1014, 0],
    [-1014, 'SIGKILL'],
    [-1014, 0],
  ]);
});

test('accepts a graceful leader exit before the grace deadline and waits for stdio close', async () => {
  const child = createChild(1008);
  const childExited = once(child, 'exit');
  const calls = [];
  let cancelGrace;
  const graceCancelled = new Promise((resolve) => {
    cancelGrace = resolve;
  });
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
  }, () => ({ expired: new Promise(() => {}), cancel: cancelGrace }));
  let cleanupSettled = false;
  void cleanup.then(() => {
    cleanupSettled = true;
  });

  await Promise.all([childExited, graceCancelled]);
  assert.equal(cleanupSettled, false);
  assert.deepEqual(calls, [
    [-1008, 'SIGTERM'],
    [-1008, 0],
  ]);

  child.emit('close', 0, 'SIGTERM');
  await cleanup;
  assert.deepEqual(calls, [
    [-1008, 'SIGTERM'],
    [-1008, 0],
  ]);
});

test('escalates a stubborn descendant and proves final process-group disappearance', async () => {
  const child = createChild(1009);
  const childExited = once(child, 'exit');
  const calls = [];
  let processGroupExists = true;
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
    if (signal === 'SIGKILL') {
      processGroupExists = false;
      return true;
    }
    if (signal === 0 && processGroupExists) {
      return true;
    }
    throw esrch();
  };

  await stopProcessGroup(child, kill);
  await childExited;

  assert.deepEqual(calls, [
    [-1009, 'SIGTERM'],
    [-1009, 0],
    [-1009, 'SIGKILL'],
    [-1009, 0],
  ]);
});

test('escalates a SIGTERM-ignoring leader after the injected grace deadline', async () => {
  const child = createChild(1010);
  const calls = [];
  let expireGrace;
  let signalKill;
  let processGroupExists = true;
  const graceExpired = new Promise((resolve) => {
    expireGrace = resolve;
  });
  const forcedTermination = new Promise((resolve) => {
    signalKill = resolve;
  });
  const cleanup = stopProcessGroup(
    child,
    (pid, signal) => {
      calls.push([pid, signal]);
      if (signal === 'SIGTERM') {
        return true;
      }
      if (signal === 'SIGKILL') {
        processGroupExists = false;
        signalKill();
        return true;
      }
      if (signal === 0 && processGroupExists) {
        return true;
      }
      throw esrch();
    },
    () => ({ expired: graceExpired, cancel: () => {} }),
  );

  expireGrace();
  await forcedTermination;

  assert.deepEqual(calls, [
    [-1010, 'SIGTERM'],
    [-1010, 0],
    [-1010, 'SIGKILL'],
  ]);

  child.exitCode = 0;
  child.emit('exit', 0, 'SIGKILL');
  child.emit('close', 0, 'SIGKILL');
  await cleanup;

  assert.deepEqual(calls, [
    [-1010, 'SIGTERM'],
    [-1010, 0],
    [-1010, 'SIGKILL'],
    [-1010, 0],
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
