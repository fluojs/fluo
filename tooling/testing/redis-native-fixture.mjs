import { createConnection } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const REDIS_NATIVE_FIXTURE_BUDGET_MS = 60_000;
export const REDIS_NATIVE_FIXTURE_IMAGE = 'redis:7.4-alpine';

export function redisReady(chunks) {
  return chunks.join('').includes('Ready to accept connections');
}
export function parseRedisPort(output) {
  const value = Number(output.trim().split(':').at(-1));
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new TypeError(`Invalid Redis fixture port: ${output}`);
  }
  return value;
}

function waitForTcpPort(port, budgetMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + budgetMs;
    const attempt = () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error(`Redis fixture TCP readiness exceeded ${budgetMs}ms`));
        else setTimeout(attempt, 25);
      });
    };
    attempt();
  });
}

export async function startRedisFixture({
  containerName,
  diagnosticPath,
  execFile,
  now = () => Date.now(),
  spawn,
  waitForTcp = waitForTcpPort,
  budgetMs = REDIS_NATIVE_FIXTURE_BUDGET_MS,
}) {
  const started = now();
  const diagnostics = { budgetMs, containerName, image: REDIS_NATIVE_FIXTURE_IMAGE, phases: [] };
  const writeDiagnostics = () => {
    if (!diagnosticPath) return;
    mkdirSync(dirname(resolve(diagnosticPath)), { recursive: true });
    writeFileSync(diagnosticPath, `${JSON.stringify({ ...diagnostics, elapsedMs: now() - started }, null, 2)}\n`);
  };
  const evidence = (value, error) => ({
    exitCode: Number.isInteger(error?.code) ? error.code : Number.isInteger(value?.code) ? value.code : null,
    signal: error?.signal ?? value?.signal ?? null,
    spawnError: error && !Number.isInteger(error.code) ? error.message : null,
    stderr: String(error?.stderr ?? value?.stderr ?? ''),
    stdout: String(error?.stdout ?? value?.stdout ?? ''),
  });
  const phase = async (name, command, argv, operation) => {
    const phaseStarted = now();
    try {
      const value = await operation();
      diagnostics.phases.push({ argv, command, elapsedMs: now() - phaseStarted, ...evidence(value), name, status: 'passed' });
      return value;
    } catch (error) {
      diagnostics.phases.push({
        argv,
        command,
        elapsedMs: now() - phaseStarted,
        error: error instanceof Error ? error.message : String(error),
        ...evidence(null, error),
        name,
        status: 'failed',
      });
      throw error;
    }
  };
  const remaining = () => Math.max(0, budgetMs - (now() - started));
  const bounded = (name) => {
    const timeout = remaining();
    if (timeout <= 0) throw new Error(`Redis fixture ${name} exceeded total ${budgetMs}ms startup budget`);
    return timeout;
  };
  const exec = (name, argv) => phase(name, 'docker', argv, () =>
    execFile('docker', argv, { timeout: bounded(name) }));
  let child;
  const stdoutChunks = [];
  const stderrChunks = [];
  let closed = false;
  let closedSignal;
  let timer;
  try {
    await exec('image-pull', ['pull', REDIS_NATIVE_FIXTURE_IMAGE]);
    const runArgs = ['run', '--pull', 'never', '--rm', '--name', containerName, '-p', '127.0.0.1::6379',
      REDIS_NATIVE_FIXTURE_IMAGE, 'redis-server', '--save', '', '--appendonly', 'no'];
    child = await phase('container-start', 'docker', runArgs, () => spawn('docker', runArgs));
    closedSignal = new Promise((resolve) => child.once('close', (code, signal) => {
      closed = true;
      resolve({ code, signal });
    }));
    await phase('readiness-signal', 'docker', runArgs, () => Promise.race([
      new Promise((resolve, reject) => {
        const observe = (target) => (chunk) => {
          target.push(chunk.toString());
          if (redisReady([...stdoutChunks, ...stderrChunks])) resolve({
            stderr: stderrChunks.join(''),
            stdout: stdoutChunks.join(''),
          });
        };
        child.stdout.on('data', observe(stdoutChunks));
        child.stderr.on('data', observe(stderrChunks));
        child.once('error', reject);
        child.once('close', (code, signal) => reject(Object.assign(
          new Error(`Redis fixture exited code=${code} signal=${signal}`),
          { code, signal, stderr: stderrChunks.join(''), stdout: stdoutChunks.join('') },
        )));
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis fixture readiness exceeded total ${budgetMs}ms startup budget`)), bounded('readiness-signal'));
      }),
    ]));
    const address = await exec('port-discovery', ['port', containerName, '6379/tcp']);
    const port = parseRedisPort(address.stdout);
    await phase('host-tcp-readiness', 'tcp', ['127.0.0.1', String(port)], () => waitForTcp(port, bounded('host-tcp-readiness')));
    return {
      diagnostics,
      port,
      async cleanup(primaryError) {
        try {
          if (!closed) await exec('cleanup', ['stop', '--time', '1', containerName]);
          await closedSignal;
        } catch (cleanupError) {
          writeDiagnostics();
          if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Redis fixture startup and cleanup failed');
          throw cleanupError;
        }
      },
    };
  } catch (error) {
    try {
      if (child && !closed) await exec('cleanup', ['stop', '--time', '1', containerName]);
      if (closedSignal) await closedSignal;
    }
    catch (cleanupError) {
      writeDiagnostics();
      throw new AggregateError([error, cleanupError], 'Redis fixture startup and cleanup failed');
    }
    writeDiagnostics();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
