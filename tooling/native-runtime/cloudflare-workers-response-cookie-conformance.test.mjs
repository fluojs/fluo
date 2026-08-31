import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

import { expectedResponseCookies } from './response-cookie-conformance.mjs';

const workerUrl = 'http://127.0.0.1:8790';
const startupTimeoutMs = 30_000;

function startWorker() {
  const child = spawn(
    'pnpm',
    [
      'dlx',
      'wrangler@4.20.0',
      'dev',
      'tooling/native-runtime/cloudflare-workers-response-cookie-conformance-worker.mjs',
      '--ip',
      '127.0.0.1',
      '--local',
      '--port',
      '8790',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`workerd did not become ready at ${workerUrl}`));
    }, startupTimeoutMs);
    const onOutput = (output) => {
      if (output.toString().includes(workerUrl)) {
        clearTimeout(timeout);
        resolve();
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

  return {
    child,
    ready,
  };
}

async function stopWorker(child) {
  if (child.pid === undefined) {
    return;
  }

  const exited = child.exitCode === null ? once(child, 'exit') : undefined;

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }

  await exited;
}

test('workerd preserves ordered independent Set-Cookie fields for repeated setCookie and clearCookie calls', async () => {
  const worker = startWorker();

  try {
    await worker.ready;

    const response = await fetch(workerUrl);
    const actual = await response.json();

    if (response.status !== 200) {
      throw new Error(`workerd returned HTTP ${response.status}`);
    }
    if (JSON.stringify(actual) !== JSON.stringify(expectedResponseCookies)) {
      throw new Error(`workerd returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expectedResponseCookies)}`);
    }
  } finally {
    await stopWorker(worker.child);
  }
});
