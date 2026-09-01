import { spawn } from 'node:child_process';
import { once } from 'node:events';

const workerHost = '127.0.0.1';
const startupTimeoutMs = 30_000;

function isErrno(error, code) {
  return typeof error === 'object' && error !== null && error.code === code;
}

function workerUrlFromOutput(output) {
  const match = output.toString().match(/http:\/\/127\.0\.0\.1:(?<port>[1-9]\d*)\b/);

  return match?.[0];
}

function assertProcessGroupExited(pid, kill) {
  try {
    kill(-pid, 0);
  } catch (error) {
    if (isErrno(error, 'ESRCH')) {
      return;
    }
    throw error;
  }

  throw new Error(`process group ${pid} still has running descendants after SIGTERM`);
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
    ],
    {
      cwd: new URL('../..', import.meta.url),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('workerd did not become ready before the startup timeout'));
    }, startupTimeoutMs);
    const onOutput = (output) => {
      const url = workerUrlFromOutput(output);

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

export async function stopProcessGroup(child, kill = process.kill) {
  if (child.pid === undefined) {
    return;
  }

  const leaderExited = child.exitCode === null ? once(child, 'exit') : undefined;
  const stdioClosed = child.exitCode === null ? once(child, 'close') : undefined;
  let groupAlreadyExited = false;

  try {
    kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (!isErrno(error, 'ESRCH')) {
      throw error;
    }
    groupAlreadyExited = true;
  }

  await leaderExited;
  await stdioClosed;

  if (!groupAlreadyExited) {
    assertProcessGroupExited(child.pid, kill);
  }
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
