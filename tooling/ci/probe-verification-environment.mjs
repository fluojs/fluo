#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { watch, writeFileSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { arch, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadEnvironmentLock,
  prepareVerificationEnvironment,
  validateVerificationEnvironment,
} from './verification-environment.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const evidencePath = resolve(root, '.omo/verification/ci-parity/environment/probe.json');
const exec = (binary, args) => execFileSync(binary, args, { encoding: 'utf8' }).trim();

function observedVersions(lock) {
  const versions = { os: platform(), arch: arch(), node: {}, bun: {}, deno: {} };
  for (const [key, item] of Object.entries(lock.node)) {
    versions.node[key] = exec(`/opt/node/${item.version}/bin/node`, ['--version']).replace(/^v/, '');
  }
  versions.pnpm = exec('/usr/local/bin/pnpm', ['--version']);
  for (const [key, item] of Object.entries(lock.bun)) {
    versions.bun[key] = exec(`/opt/bun/${item.version}/bun`, ['--version']);
  }
  for (const [key, item] of Object.entries(lock.deno)) {
    versions.deno[key] = exec(`/opt/deno/${item.version}/deno`, ['--version']).match(/^deno (\d+\.\d+\.\d+)\b/)?.[1];
  }
  const chrome = exec('google-chrome', ['--version']);
  versions.browser = { channel: 'chrome', version: chrome.match(/\d+\.\d+\.\d+\.\d+/)?.[0] };
  const launched = spawnSync('google-chrome', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--dump-dom', 'data:text/html,%3Cp%20id%3D%22probe%22%3Echrome-launched%3C%2Fp%3E',
  ], { encoding: 'utf8', timeout: 30_000 });
  if (launched.status !== 0 || !launched.stdout.includes('chrome-launched')) {
    throw new Error(`Chrome launch failed: ${launched.error?.message ?? launched.stderr?.slice(-1000)}`);
  }
  versions.browser.launched = true;
  return versions;
}

async function watchVolume() {
  const path = `/workspace-watch/probe-${randomUUID()}`;
  return new Promise((resolveWatch, reject) => {
    const watcher = watch('/workspace-watch');
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error('linux volume file-watch event timed out'));
    }, 10_000);
    watcher.on('change', (event, filename) => {
      if (filename !== path.split('/').at(-1)) return;
      clearTimeout(timer);
      watcher.close();
      resolveWatch({ event, linuxVolume: true });
    });
    watcher.once('error', (error) => {
      clearTimeout(timer);
      watcher.close();
      reject(error);
    });
    // Subscribe before the write; only the named Linux-volume path can satisfy it.
    writeFileSync(path, 'watch-probe');
  });
}

async function redisProbe(lock) {
  const name = `fluo-env-probe-${randomUUID().slice(0, 12)}`;
  const args = ['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::6379',
    lock.redis.image, 'redis-server', '--save', '', '--appendonly', 'no'];
  try {
    const serverVersion = exec('docker', ['version', '--format', '{{.Server.Version}}']);
    exec('docker', args);
    await new Promise((resolveReady, reject) => {
      const logs = spawn('docker', ['logs', '--follow', name], { stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { logs.kill(); reject(new Error('Redis readiness log timed out')); }, 30_000);
      const onLog = (chunk) => {
        if (!chunk.toString().includes('Ready to accept connections')) return;
        clearTimeout(timer);
        logs.kill();
        resolveReady();
      };
      logs.stdout.on('data', onLog);
      logs.stderr.on('data', onLog);
      logs.once('error', (error) => { clearTimeout(timer); reject(error); });
      logs.once('close', (code) => {
        if (code !== 0 && code !== null && code !== 143) {
          clearTimeout(timer);
          reject(new Error(`Redis logs ended before readiness: ${code}`));
        }
      });
    });
    const port = Number(exec('docker', ['port', name, '6379/tcp']).split(':').at(-1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Redis published port invalid');
    const ping = await new Promise((resolvePing, reject) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.setTimeout(10_000, () => { socket.destroy(); reject(new Error('Redis PING timed out')); });
      socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'));
      socket.once('data', (data) => { socket.destroy(); resolvePing(data.toString()); });
      socket.once('error', reject);
    });
    assert.equal(ping, '+PONG\r\n');
    return { ping: 'PONG', host: '127.0.0.1', port, image: lock.redis.image, serverVersion };
  } finally {
    execFileSync('docker', ['stop', '--time', '1', name], { stdio: 'ignore' });
  }
}

async function inside() {
  const lock = loadEnvironmentLock();
  const started = Date.now();
  const actual = observedVersions(lock);
  actual.watch = await watchVolume();
  actual.redis = await redisProbe(lock);
  actual.docker = {
    reachable: true,
    version: actual.redis.serverVersion,
    cliVersion: exec('docker', ['--version']).match(/\d+\.\d+\.\d+/)?.[0],
  };
  console.log(JSON.stringify({ actual, elapsedMs: Date.now() - started }));
}

function outside() {
  const { lock, imageKey, imageId, tag } = prepareVerificationEnvironment();
  const host = exec('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (!host.startsWith('unix://')) throw new Error('Docker Unix socket required for fixture');
  const volume = `fluo-env-watch-${randomUUID().slice(0, 12)}`;
  exec('docker', ['volume', 'create', volume]);
  let outcome;
  try {
    const result = spawnSync('docker', ['run', '--rm', '--platform', 'linux/amd64', '--network', 'host',
      '--mount', `type=bind,source=${host.slice(7)},target=/var/run/docker.sock`,
      '--mount', `type=volume,source=${volume},target=/workspace-watch`,
      '--mount', `type=bind,source=${fileURLToPath(import.meta.url)},target=/opt/verification/probe-verification-environment.mjs,readonly`,
      tag, 'node', '/opt/verification/probe-verification-environment.mjs', '--inside',
    ], { encoding: 'utf8', timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`linux/amd64 probe failed (${result.status}): ${result.stderr}`);
    const { actual, elapsedMs } = JSON.parse(result.stdout.trim());
    validateVerificationEnvironment({ lock, actual, imageKey });
    outcome = { status: 'passed', imageKey, imageId, actual, elapsedMs };
  } finally {
    exec('docker', ['volume', 'rm', volume]);
  }
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(outcome, null, 2)}\n`);
  console.log(JSON.stringify({ evidencePath, ...outcome }));
}

if (process.argv[2] === '--inside') {
  inside().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  try { outside(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
