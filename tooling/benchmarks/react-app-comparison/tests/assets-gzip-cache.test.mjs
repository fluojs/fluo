import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { stopOwnedProcess } from '../src/process-group.mjs';

const entry = process.env.BENCHMARK_ASSET_APP_ENTRY
  ? pathToFileURL(process.env.BENCHMARK_ASSET_APP_ENTRY)
  : new URL('../apps/fluo/dist/server/main.js', import.meta.url);
const probe = new URL('../fixture/gzip-count-probe.mjs', import.meta.url);

function request(url, encoding) {
  return new Promise((resolve, reject) => {
    get(url, {
      headers: { 'accept-encoding': encoding },
      signal: AbortSignal.timeout(15_000),
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    }).once('error', reject);
  });
}

test('asset gzip reuses identical bytes without caching file changes or errors', { timeout: 30_000 }, async (t) => {
  const name = `asset-cache-${process.pid}.js`;
  const file = new URL(`../client/${name}`, entry);
  const firstBody = Buffer.from("export const value = 'first';\n");
  const nextBody = Buffer.from("export const value = 'other';\n");
  await writeFile(file, firstBody, { flag: 'wx' });
  const child = spawn(process.execPath, ['--import', probe.href, fileURLToPath(entry)], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '0' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const closed = new Promise((resolve) => child.once('close', resolve));
  t.after(async () => {
    try {
      await stopOwnedProcess(child);
      await closed;
    } finally {
      await rm(file, { force: true });
    }
  });
  const listening = once(child, 'message', { signal: AbortSignal.timeout(15_000) });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('BENCH_READY')) resolve();
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`fixture exited before readiness: ${output}`)));
  });
  const [[message]] = await Promise.all([listening, ready]);
  assert.equal(message.kind, 'listening');
  const url = new URL(`/assets/${name}`, `http://127.0.0.1:${message.address.port}`);
  const count = async () => {
    const response = once(child, 'message', { signal: AbortSignal.timeout(15_000) });
    child.send({ kind: 'gzip-count' });
    const [value] = await response;
    assert.equal(value.kind, 'gzip-count');
    return value.count;
  };
  const initialCount = await count();
  const first = await request(url, 'gzip');
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-encoding'], 'gzip');
  assert.equal(first.headers.vary, 'Accept-Encoding');
  assert.equal(first.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.deepEqual(gunzipSync(first.body), firstBody);
  const repeated = await request(url, 'gzip');
  assert.deepEqual(repeated.body, first.body);
  assert.equal(await count(), initialCount + 1);
  const identity = await request(url, 'identity');
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.deepEqual(identity.body, firstBody);
  assert.equal(await count(), initialCount + 1);

  await writeFile(file, nextBody);
  const changed = await request(url, 'gzip');
  assert.deepEqual(gunzipSync(changed.body), nextBody);
  assert.equal(await count(), initialCount + 2);
  await rm(file);
  assert.equal((await request(url, 'gzip')).status, 404);
  await writeFile(file, firstBody, { flag: 'wx' });
  assert.deepEqual(gunzipSync((await request(url, 'gzip')).body), firstBody);
  assert.equal(await count(), initialCount + 3);
});
