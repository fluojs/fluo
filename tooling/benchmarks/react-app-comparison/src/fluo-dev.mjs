import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { stopOwnedProcess } from './process-group.mjs';

const app = resolve(import.meta.dirname, '../apps/fluo');
let child;
let closed = false;
let building = false;
let changed = false;

async function stop() {
  if (!child) return;
  const server = child;
  child = undefined;
  await stopOwnedProcess(server, { group: false });
}

async function buildAndStart() {
  if (building) {
    changed = true;
    return;
  }
  building = true;
  try {
    do {
      changed = false;
      await stop();
      const build = spawn('pnpm', ['--ignore-workspace', 'build'], {
        cwd: app, stdio: ['ignore', 'pipe', 'pipe'],
      });
      build.stdout.on('data', (data) => process.stdout.write(data));
      build.stderr.on('data', (data) => process.stderr.write(data));
      const [code] = await once(build, 'exit');
      if (code !== 0) throw new Error(`Fluo dev build exited ${code}`);
    } while (changed && !closed);
    if (closed) return;
    const first = child === undefined && !readyOnce;
    child = spawn(process.execPath, ['dist/server/main.js'], {
      cwd: app, env: { ...process.env, PORT: process.env.PORT ?? '32151' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const current = child;
    await new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error('Fluo dev HTTP ready timeout')), 60_000);
      current.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('BENCH_READY')) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
      current.stderr.on('data', (chunk) => process.stderr.write(chunk));
      current.once('exit', (code) => {
        clearTimeout(timeout);
        rejectReady(new Error(`Fluo dev HTTP server exited ${code}`));
      });
    });
    readyOnce = true;
    console.log(first ? 'DEV_READY' : 'DEV_RELOADED');
  } finally {
    building = false;
    if (changed && !closed) void buildAndStart().catch(fail);
  }
}

let readyOnce = false;
function fail(error) {
  console.error(error);
  process.exitCode = 1;
  void shutdown();
}
const watcher = watch(resolve(app, 'src'), { recursive: true }, () => {
  if (!closed) void buildAndStart().catch(fail);
});
async function shutdown() {
  if (closed) return;
  closed = true;
  watcher.close();
  await stop();
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
await buildAndStart();
