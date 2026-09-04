import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const workerHost = '127.0.0.1';
const startupTimeoutMs = 30_000;
const processGroupGraceMs = 5_000;
const processGroupExitPollMs = 20;

function isErrno(error, code) {
  return typeof error === 'object' && error !== null && error.code === code;
}

function workerUrlFromOutput(output) {
  const match = output.toString().match(/http:\/\/127\.0\.0\.1:(?<port>[1-9]\d*)\b/);

  return match?.[0];
}

function processGroupExists(pid, kill, nativeProcessGroupProbe) {
  try {
    kill(-pid, 0);
    return true;
  } catch (error) {
    if (isErrno(error, 'ESRCH')) {
      return false;
    }
    if (isErrno(error, 'EPERM') && nativeProcessGroupProbe !== undefined) {
      return nativeProcessGroupProbe(pid);
    }
    throw error;
  }
}

export function probeMacOSProcessGroup(pid, execFile = execFileSync) {
  try {
    execFile('/bin/kill', ['-0', `-${pid}`], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && error.status === 1) {
      const stderr = String(error.stderr ?? '');

      if (stderr.includes('No such process')) {
        return false;
      }
      if (stderr.includes('Operation not permitted')) {
        return true;
      }
    }
    throw error;
  }
}

function signalProcessGroup(pid, signal, kill) {
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    if (isErrno(error, 'ESRCH')) {
      return false;
    }
    throw error;
  }
}

function createProcessGroupExitDeadline() {
  const expiresAt = Date.now() + processGroupGraceMs;

  return () => Date.now() >= expiresAt;
}

function scheduleProcessGroupExitProbe(callback) {
  setTimeout(callback, processGroupExitPollMs);
}

function waitForProcessGroupExit(pid, { deadline, scheduler, stateProbe }) {
  return new Promise((resolve, reject) => {
    const probe = () => {
      try {
        if (!stateProbe(pid)) {
          resolve();
          return;
        }

        if (deadline()) {
          reject(new Error(`process group ${pid} still has running descendants after forced termination`));
          return;
        }

        scheduler(probe);
      } catch (error) {
        reject(error);
      }
    };

    probe();
  });
}

function waitForLeaderExitAndStdioClose(leaderExited, stdioClosed, { deadline, scheduler }) {
  const pendingSignals = [leaderExited, stdioClosed].filter((signal) => signal !== undefined);

  if (pendingSignals.length === 0) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let remainingSignals = pendingSignals.length;
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const probe = () => {
      if (remainingSignals === 0) {
        finish(true);
        return;
      }
      if (deadline()) {
        finish(false);
        return;
      }
      scheduler(probe);
    };

    for (const signal of pendingSignals) {
      void signal.then(() => {
        remainingSignals -= 1;
        if (remainingSignals === 0) {
          finish(true);
        }
      });
    }

    probe();
  });
}

function hasOpenInheritedStdio(child) {
  return child.stdio?.some((stream) => stream !== null && stream !== undefined && !stream.destroyed) ?? false;
}

function createProcessGroupGraceDeadline() {
  let timeout;
  const expired = new Promise((resolve) => {
    timeout = setTimeout(resolve, processGroupGraceMs);
  });

  return {
    expired,
    cancel: () => clearTimeout(timeout),
  };
}

export function startWorker(spawnWorker = spawn) {
  const child = spawnWorker(
    'pnpm',
    [
      'dlx',
      'wrangler@4.20.0',
      'dev',
      'tooling/native-runtime/cloudflare-workers-response-cookie-conformance-worker.mjs',
      '--ip',
      workerHost,
      '--local',
      '--port',
      '0',
      '--inspector-port',
      '0',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const ready = new Promise((resolve, reject) => {
    let startupOutput = '';
    const timeout = setTimeout(() => {
      reject(new Error('workerd did not become ready before the startup timeout'));
    }, startupTimeoutMs);
    const onOutput = (output) => {
      startupOutput += output.toString();
      const url = workerUrlFromOutput(startupOutput);

      if (url !== undefined) {
        clearTimeout(timeout);
        resolve({ url });
      }
    };

    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`workerd exited before readiness with code ${code}`));
    });
  });

  return { child, ready };
}

export async function stopProcessGroup(
  child,
  kill = process.kill,
  createGraceDeadline = createProcessGroupGraceDeadline,
  processGroupExitWaitOptions,
  nativeProcessGroupProbe = process.platform === 'darwin' ? probeMacOSProcessGroup : undefined,
) {
  if (child.pid === undefined) {
    return;
  }

  const leaderExited = child.exitCode === null ? once(child, 'exit') : undefined;
  const stdioClosed = leaderExited !== undefined || hasOpenInheritedStdio(child) ? once(child, 'close') : undefined;
  const processGroupRunning = signalProcessGroup(child.pid, 'SIGTERM', kill);
  const graceDeadline = leaderExited === undefined ? undefined : createGraceDeadline();
  const leaderExitedBeforeGrace =
    leaderExited === undefined ||
    (await Promise.race([leaderExited.then(() => true), graceDeadline.expired.then(() => false)]));

  graceDeadline?.cancel();

  const forceTerminationSent =
    processGroupRunning && processGroupExists(child.pid, kill, nativeProcessGroupProbe)
      ? signalProcessGroup(child.pid, 'SIGKILL', kill)
      : false;

  if (!forceTerminationSent) {
    if (!leaderExitedBeforeGrace) {
      await leaderExited;
    }
    await stdioClosed;
    return;
  }

  const exitWaitOptions =
    processGroupExitWaitOptions ?? {
      deadline: createProcessGroupExitDeadline(),
      scheduler: scheduleProcessGroupExitProbe,
      stateProbe: (pid) => processGroupExists(pid, kill, nativeProcessGroupProbe),
    };
  const terminationSignalsSettled = await waitForLeaderExitAndStdioClose(
    leaderExited,
    stdioClosed,
    exitWaitOptions,
  );
  let processGroupError;

  try {
    await waitForProcessGroupExit(child.pid, exitWaitOptions);
  } catch (error) {
    processGroupError = error;
  }

  if (!terminationSignalsSettled) {
    const terminationError = new Error(
      `workerd leader exit or inherited stdio close did not settle after forced termination for process group ${child.pid}`,
    );

    if (processGroupError !== undefined) {
      throw new AggregateError(
        [terminationError, processGroupError],
        'Workers process termination signals and process-group cleanup both failed',
      );
    }
    throw terminationError;
  }

  if (processGroupError !== undefined) {
    throw processGroupError;
  }
}

export async function runConcurrentWorkers(operations) {
  const results = await Promise.allSettled(operations.map((operation) => Promise.resolve().then(operation)));
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Concurrent Workers conformance runs failed');
  }

  return results.map((result) => result.value);
}

export async function runWithWorker(worker, operation, stop = stopProcessGroup) {
  let operationFailed = false;
  let operationError;
  let operationResult;

  try {
    operationResult = await operation(await worker.ready);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await stop(worker.child);
  } catch (cleanupError) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Workers conformance operation and cleanup both failed',
      );
    }
    throw cleanupError;
  }

  if (operationFailed) {
    throw operationError;
  }

  return operationResult;
}
