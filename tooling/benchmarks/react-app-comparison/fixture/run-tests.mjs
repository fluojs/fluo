import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const suiteDirectory = fileURLToPath(new URL('../', import.meta.url));
const fluoDirectory = fileURLToPath(new URL('../apps/fluo/', import.meta.url));
const files = process.argv.slice(2);

if (files.length === 0) throw new Error('Pass the test files to the suite runner.');

const server = spawn(process.execPath, ['dist/server/main.js'], {
  cwd: fluoDirectory,
  env: { ...process.env, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverExit = once(server, 'exit');

try {
  const ready = new Promise((resolve, reject) => {
    let log = '';
    const accept = (chunk) => {
      log += chunk.toString();
      const address = log.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/u)?.[1];
      if (address && log.includes('BENCH_READY')) resolve(address);
    };
    server.stdout.on('data', accept);
    server.stderr.on('data', accept);
    serverExit.then(([code]) => reject(new Error(`Fluo fixture exited before readiness (${code}): ${log}`)), reject);
    AbortSignal.timeout(30_000).addEventListener('abort', () => {
      reject(new Error(`Fluo fixture did not become ready: ${log}`));
    }, { once: true });
  });
  const baseURL = await ready;
  const tests = spawn(process.execPath, ['--test', ...files], {
    cwd: suiteDirectory,
    env: { ...process.env, BENCHMARK_BASE_URL: baseURL },
    stdio: 'inherit',
  });
  const testExit = once(tests, 'exit');
  AbortSignal.timeout(180_000).addEventListener('abort', () => tests.kill('SIGTERM'), { once: true });
  const [code] = await testExit;
  process.exitCode = code ?? 1;
} finally {
  server.kill('SIGTERM');
  await serverExit;
}
