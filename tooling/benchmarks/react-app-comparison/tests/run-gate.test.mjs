import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { stopOwnedProcess } from '../src/process-group.mjs';
import { performanceExitCode, readMeasurementReceipt, requireDevDefinitions, startServers, stopServers } from '../src/run-gate.mjs';

test('representative gate requires observable cold and all three development edits', async () => {
  // Given: the checked-in four-app representative configuration.
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../config/representative.json', import.meta.url), 'utf8'));
  // When / Then: silently skipping development metrics is not a completed gate.
  assert.equal(requireDevDefinitions(config), config.dev);
  assert.throws(() => requireDevDefinitions({ ...config, dev: undefined }), /development/u);
  assert.throws(() => requireDevDefinitions({
    ...config, dev: { ...config.dev, next: { ...config.dev.next, edits: {
      ...config.dev.next.edits, 'server-edit': undefined,
    } } },
  }), /next.*server-edit/u);
});

test('discovery records a failing budget without treating it as a passing regression gate', () => {
  assert.equal(performanceExitCode('fail', 'discovery', true), 0);
  assert.equal(performanceExitCode('fail', 'regression', true), 1);
  assert.equal(performanceExitCode('inconclusive', 'regression', true), 1);
  assert.equal(performanceExitCode('fail', 'discovery', false), 1);
  assert.equal(performanceExitCode('pass', 'regression', true), 0);
  assert.throws(() => performanceExitCode('pass', 'unknown', true), /mode/u);
});

test('a failed correctness subprocess retains its actual receipt without passing a missing one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-correctness-receipt-'));
  const receiptPath = join(directory, 'failed.json');
  try {
    await writeFile(receiptPath, JSON.stringify({ runs: [{ correctness: 'fail', trace: '/raw/failure.json' }] }));
    const failed = Object.assign(new Error('correctness failed'), { code: 1 });
    assert.equal((await readMeasurementReceipt(() => Promise.reject(failed), receiptPath)).runs[0].correctness, 'fail');
    await rm(receiptPath);
    await assert.rejects(readMeasurementReceipt(() => Promise.reject(failed), receiptPath), /ENOENT/u);
    const crash = Object.assign(new Error('subprocess crash'), { code: 3 });
    await writeFile(receiptPath, '{}');
    await assert.rejects(readMeasurementReceipt(() => Promise.reject(crash), receiptPath), /subprocess crash/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('overlapping interrupt and finalization share one owned cleanup', async () => {
  const child = { pid: undefined };
  const interrupt = stopOwnedProcess(child);
  const finalization = stopOwnedProcess(child);
  assert.strictEqual(interrupt, finalization);
  await interrupt;
});

test('waits for a real HTTP ready event and stops the owned process group', async () => {
  // Given: an app reports readiness only after binding a socket.
  const command = [
    process.execPath, '-e',
    'require("node:http").createServer((_, response) => response.end("ready")).listen(0, "127.0.0.1", function () { console.log("READY " + this.address().port) })',
  ];
  // When: a pre-registered stdout event reports the bound port.
  const servers = await startServers([
    { name: 'fixture', command, readyPattern: /READY (\d+)/u,
      urlForMatch: (match) => `http://127.0.0.1:${match[1]}/` },
  ]);
  const server = servers[0];
  assert.ok(server);
  // Then: the real HTTP endpoint responds before the runner proceeds.
  assert.equal(await (await fetch(server.url)).text(), 'ready');
  await stopServers(servers);
  await assert.rejects(fetch(server.url, { signal: AbortSignal.timeout(1000) }));
});

test('fails closed when a production server exits before readiness', async () => {
  // Given: the child exits without emitting the expected ready event.
  // When/Then: no failed server can be treated as a production benchmark.
  await assert.rejects(startServers([
    { name: 'broken', command: [process.execPath, '-e', 'process.exit(3)'],
      readyPattern: /READY/u, urlForMatch: () => 'http://127.0.0.1:1/' },
  ]), /broken|exit/u);
});

test('escalates an exited leader group with a SIGTERM-resistant descendant', { timeout: 10_000 }, async (t) => {
  const descendant = 'process.on("SIGTERM", () => {}); require("node:http").createServer().listen(0, "127.0.0.1", () => console.log("DESCENDANT_READY"))';
  const leader = spawn(process.execPath, ['-e',
    `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], {stdio:"inherit"}).unref();`], {
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  t.after(() => {
    try { process.kill(-leader.pid, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  const exited = once(leader, 'exit');
  const ready = once(leader.stdout, 'data');
  assert.match(String((await ready)[0]), /DESCENDANT_READY/u);
  await exited;
  await stopOwnedProcess(leader, { termMs: 100, killMs: 2_000 });
  assert.throws(() => process.kill(-leader.pid, 0), { code: 'ESRCH' });
});
