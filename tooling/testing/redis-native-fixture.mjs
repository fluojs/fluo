import { createConnection } from 'node:net';

export const REDIS_NATIVE_FIXTURE_BUDGET_MS = 60_000;

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

export async function startRedisFixture({ containerName, execFile, spawn, waitForTcp = waitForTcpPort, budgetMs = REDIS_NATIVE_FIXTURE_BUDGET_MS }) {
  const child = spawn('docker', ['run', '--rm', '--name', containerName, '-p', '127.0.0.1::6379',
    'redis:7.4-alpine', 'redis-server', '--save', '', '--appendonly', 'no']);
  const chunks = [];
  let closed = false;
  const closedSignal = new Promise((resolve) => child.once('close', (code, signal) => {
    closed = true;
    resolve({ code, signal });
  }));
  const ready = new Promise((resolve, reject) => {
    const observe = (chunk) => {
      chunks.push(chunk.toString());
      if (redisReady(chunks)) resolve();
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', reject);
    child.once('close', (code, signal) => reject(new Error(`Redis fixture exited code=${code} signal=${signal} output=${chunks.join('')}`)));
  });
  let timer;
  try {
    await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Redis fixture readiness exceeded ${budgetMs}ms`)), budgetMs); })]);
    const address = await execFile('docker', ['port', containerName, '6379/tcp']);
    const port = parseRedisPort(address.stdout);
    await waitForTcp(port, budgetMs);
    return {
      port,
      async cleanup(primaryError) {
        try {
          if (!closed) await execFile('docker', ['stop', '--time', '1', containerName]);
          await closedSignal;
        } catch (cleanupError) {
          if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Redis fixture startup and cleanup failed');
          throw cleanupError;
        }
      },
    };
  } catch (error) {
    try { if (!closed) await execFile('docker', ['stop', '--time', '1', containerName]); await closedSignal; }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Redis fixture startup and cleanup failed'); }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
