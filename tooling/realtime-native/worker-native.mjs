import { spawn } from 'node:child_process';

const worker = spawn(
  'pnpm',
  [
    'dlx',
    'wrangler@4.20.0',
    'dev',
    'tooling/realtime-native/.generated/worker.js',
    '--ip',
    '127.0.0.1',
    '--local',
    '--port',
    '0',
    '--inspector-port',
    '0',
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  },
);

let workerOutput = '';
for (const stream of [worker.stdout, worker.stderr]) {
  stream.on('data', (chunk) => { workerOutput = (workerOutput + String(chunk)).slice(-1_000_000); });
}

function waitForWorkerOutput(pattern, description) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      worker.stdout.off('data', onOutput);
      worker.stderr.off('data', onOutput);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const fail = (error) => { cleanup(); reject(error); };
    const timeout = setTimeout(() => fail(new Error(`workerd did not report ${description}.\n${workerOutput}`)), 30_000);
    const onOutput = () => {
      const match = workerOutput.match(pattern);
      if (match !== null) {
        cleanup();
        resolve(match[1] ?? match[0]);
      }
    };
    const onError = (error) => fail(error);
    const onExit = (code) => fail(new Error(`workerd exited before readiness: ${String(code)}.\n${workerOutput}`));
    worker.stdout.on('data', onOutput);
    worker.stderr.on('data', onOutput);
    worker.once('error', onError);
    worker.once('exit', onExit);
  });
}

function waitForSocket(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Worker ${event}.`)), 5_000);
    socket.addEventListener(event, (value) => {
      clearTimeout(timeout);
      resolve(value);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`Worker websocket failed before ${event}.\n${workerOutput}`));
    }, { once: true });
  });
}

async function stopWorker() {
  if (worker.exitCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('workerd did not exit after SIGTERM.')), 5_000);
    worker.once('exit', () => { clearTimeout(timeout); resolve(); });
    worker.once('error', (error) => { clearTimeout(timeout); reject(error); });
    if (process.platform === 'win32') worker.kill('SIGTERM');
    else process.kill(-worker.pid, 'SIGTERM');
  });
}

try {
  const url = await waitForWorkerOutput(/Ready on (http:\/\/127\.0\.0\.1:[1-9]\d*)\b/, 'readiness');
  const socket = new WebSocket(`${url.replace('http://', 'ws://')}/native-worker`);
  await waitForSocket(socket, 'open');

  const identified = waitForSocket(socket, 'message');
  socket.send(JSON.stringify({ data: null, event: 'identify' }));
  const identifiedEvent = await identified;
  if (!(identifiedEvent instanceof MessageEvent)) {
    throw new TypeError('Expected a Worker websocket message event.');
  }
  const parsed = JSON.parse(String(identifiedEvent.data));
  if (parsed?.event !== 'room.echo' || parsed?.data?.runtime !== 'workers' || typeof parsed?.data?.socketId !== 'string') {
    throw new TypeError('Worker room broadcast did not reach the native websocket.');
  }

  const closed = waitForSocket(socket, 'close');
  const drained = waitForWorkerOutput(/NATIVE_WORKER_CLOSED/, 'application close completion');
  socket.send(JSON.stringify({ event: 'shutdown', data: null }));
  await closed;
  await drained;
} finally {
  await stopWorker();
}

console.log('realtime-native workerd raw websocket passed.');
