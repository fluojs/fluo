import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { stopOwnedProcess } from '../src/process-group.mjs';
import { performanceExitCode, readMeasurementReceipt, requireDevDefinitions, startServers, stopServers } from '../src/run-gate.mjs';

test('profile pair verification cannot substitute a shared aggregate hash for original child records', async () => {
  const { verifyProfileEnvironment, beforeProfilePairFlags } = await import('../src/run-gate.mjs');
  assert.equal(typeof verifyProfileEnvironment, 'function');
  assert.equal(typeof beforeProfilePairFlags, 'function');
  const directory = await mkdtemp(join(tmpdir(), 'fluo-profile-pair-'));
  try {
    await assert.rejects(verifyProfileEnvironment({ identitySha256: 'alias' }, { runs: [] },
      {}, directory, true), /environment binding/u);
    await assert.rejects(beforeProfilePairFlags(join(directory, 'missing.json'), directory,
      'desktop-native', true), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('isolated host launcher observes the selected running container rather than accepting image strings', async () => {
  const { observeIsolatedHost } = await import('../src/measure.mjs');
  assert.equal(typeof observeIsolatedHost, 'function');
  const commands = [];
  const inspect = { Id: 'a'.repeat(64), Image: `sha256:${'b'.repeat(64)}`,
    Config: { Image: 'fixture:image', Hostname: 'container-hostname' },
    State: { Running: true, Pid: 71, StartedAt: '2026-10-03T00:00:00Z' },
    HostConfig: { NanoCpus: 0, CpuQuota: 0, CpuPeriod: 0, CpusetCpus: '', Memory: 0, MemorySwap: 0 } };
  const execute = async (command, args) => {
    commands.push([command, ...args]);
    return { stdout: JSON.stringify(args[0] === 'inspect' ? [inspect] : {
      ID: 'daemon', OperatingSystem: 'OrbStack', KernelVersion: 'linux-test', Architecture: 'aarch64',
      NCPU: 12, MemTotal: 8392974336, Name: 'orbstack',
    }) };
  };
  const observed = await observeIsolatedHost('fixture-container', execute);
  assert.equal(observed.container.id, inspect.Id);
  assert.equal(observed.container.imageId, inspect.Image);
  assert.equal(observed.vm.logicalCpus, 12);
  assert.deepEqual(commands.map((command) => command.slice(0, 2)), [['docker', 'inspect'], ['docker', 'info']]);
  inspect.State.Running = false;
  await assert.rejects(observeIsolatedHost('fixture-container', execute), /running container/u);
});

for (const [signal, boundary, exitCode] of [
  ['SIGINT', 'guest-ready', 130], ['SIGTERM', 'guest-ready', 143],
  ['SIGTERM', 'before-ready', 143], [null, 'normal', 0], [null, 'error', 7],
]) {
  test(`nonTTY launcher ${signal ?? boundary} at ${boundary} reaps its independent guest and rechecks host`, { timeout: 20_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluo-isolated-launcher-'));
    const docker = join(directory, 'docker');
    const log = join(directory, 'transport.jsonl');
    const guestPath = join(directory, 'guest.mjs');
    // This transport leaves remote execution independent of the docker client.
    // Only an explicit control frame can stop the guest; client death cannot.
    await writeFile(guestPath, `
      import { createServer } from 'node:net';
      import { writeFileSync } from 'node:fs';
      const server = createServer().listen(0, '127.0.0.1', () => {
        writeFileSync(${JSON.stringify(join(directory, 'guest.pid'))}, String(process.pid));
        console.log('OWNED_GUEST_READY ' + process.pid);
        ${signal ? '' : `server.close(() => process.exit(${exitCode}));`}
      });
      process.on('SIGINT', () => server.close());
      process.on('SIGTERM', () => server.close());
    `);
    await writeFile(docker, `#!${process.execPath}
      const fs = require('node:fs'), cp = require('node:child_process');
      const args = process.argv.slice(2);
      const log = ${JSON.stringify(log)};
      fs.appendFileSync(log, JSON.stringify(args) + '\\n');
      const inspected = { Id:'container-id', Image:'image-id', Config:{Image:'image',Hostname:'guest'},
        State:{Running:true,Pid:71,StartedAt:'start'}, HostConfig:{NanoCpus:0,CpuQuota:0,CpuPeriod:0,CpusetCpus:'',Memory:0,MemorySwap:0} };
      if(args[0] === 'inspect') console.log(JSON.stringify([inspected]));
      else if(args[0] === 'info') console.log(JSON.stringify({ID:'daemon',NCPU:12,MemTotal:123}));
      else if(args.includes('command -v node')) console.log(${JSON.stringify(process.execPath)});
      else {
        let input = '', invocationId, interrupted, guest;
        process.stdin.on('data', chunk => {
          input += chunk;
          const lines = input.split('\\n'); input = lines.pop();
          for(const line of lines) {
            const frame = JSON.parse(line);
            if(frame.invocation) {
              invocationId = frame.invocation.invocationId;
              guest = cp.spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(guestPath)}],
                {detached:true,stdio:['ignore','inherit','inherit']});
              guest.unref();
              console.log('OWNED_TRANSPORT_STARTED ' + guest.pid);
              guest.on('exit', (code, signal) => {
                console.log('OWNED_GUEST_REAPED ' + guest.pid);
                console.error('ISOLATED_GUEST_REAPED ' + invocationId + ' escalated=false');
                process.exit(interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : (code ?? (signal ? 1 : 0)));
              });
            }
            if(frame.signal) {
              interrupted = frame.signal;
              try { process.kill(guest.pid, frame.signal); } catch(error) {
                if(error.code !== 'ESRCH') throw error;
              }
              fs.appendFileSync(log, JSON.stringify({forwarded:frame.signal})+'\\n');
            }
          }
        });
      }
    `);
    await chmod(docker, 0o755);
    const host = spawn(process.execPath, ['--input-type=module', '-e',
      `import {launchIsolatedInvocation} from ${JSON.stringify(new URL('../src/measure.mjs', import.meta.url).href)};
       await launchIsolatedInvocation(${JSON.stringify(guestPath)}, ['--isolated-container','fixture']);`],
    { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(host, 'exit');
    const closed = once(host, 'close');
    let output = '';
    let guestPid;
    const ready = new Promise((resolveReady, rejectReady) => {
      host.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(boundary === 'before-ready'
          ? /OWNED_TRANSPORT_STARTED (\d+)/u : /OWNED_GUEST_READY (\d+)/u);
        if (match) { guestPid = Number(match[1]); resolveReady(); }
      });
      host.stderr.on('data', (chunk) => { output += chunk; });
      exited.then(() => rejectReady(new Error(`host exited before guest readiness: ${output}`)), rejectReady);
    });
    try {
      await ready;
      // Subscribe to exit before the action, and assert actual process liveness.
      if (signal) {
        process.kill(guestPid, 0);
        host.kill(signal);
      }
      const [code] = await exited;
      assert.equal(code, exitCode, output);
      await closed;
      assert.throws(() => process.kill(guestPid, 0), { code: 'ESRCH' });
      const commands = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(commands.filter((entry) => entry[0] === 'inspect').length, 2);
      if (signal) assert.ok(commands.some((entry) => entry.forwarded === signal));
      assert.match(output, /OWNED_GUEST_REAPED/u);
    } finally {
      host.kill('SIGKILL');
      if (!guestPid) guestPid = Number(await readFile(join(directory, 'guest.pid'), 'utf8').catch(() => '0'));
      if (guestPid) {
        try { process.kill(guestPid, 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
}

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
    const missing = Object.assign(new Error('tablet dev subprocess failed: restart crashed'), { code: 1 });
    await assert.rejects(readMeasurementReceipt(() => Promise.reject(missing), receiptPath), (error) => {
      assert.match(error.message, /tablet dev subprocess failed: restart crashed/u);
      assert.equal(error.cause?.code, 'ENOENT');
      return true;
    });
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

test('a transient EPERM probe remains live until the owned group actually disappears', { timeout: 2_000 }, async (t) => {
  const signals = [];
  let probes = 0;
  t.mock.method(process, 'kill', (target, signal) => {
    assert.equal(target, -123);
    if (signal === 0) {
      probes += 1;
      throw Object.assign(new Error('probe'), { code: probes < 4 ? 'EPERM' : 'ESRCH' });
    }
    signals.push(signal);
  });
  await stopOwnedProcess({ pid: 123 }, { termMs: 300, killMs: 300 });
  assert.deepEqual(signals, ['SIGTERM']);
  assert.ok(probes >= 4);
});

test('waits for a real HTTP ready event and stops the owned process group', async () => {
  // Given: an app reports readiness only after binding a socket.
  const command = [
    process.execPath, '-e',
    'require("node:http").createServer((_, response) => { response.setHeader("x-benchmark-mode", process.env.NODE_ENV ?? "unset"); response.end("ready") }).listen(0, "127.0.0.1", function () { console.log("READY " + this.address().port) })',
  ];
  // When: a pre-registered stdout event reports the bound port.
  const servers = await startServers([
    { name: 'fixture', command, env: { NODE_ENV: 'development' }, readyPattern: /READY (\d+)/u,
      urlForMatch: (match) => `http://127.0.0.1:${match[1]}/` },
  ]);
  const server = servers[0];
  assert.ok(server);
  // Then: the real HTTP endpoint responds before the runner proceeds.
  try {
    assert.equal(await (await fetch(server.url)).text(), 'ready');
    assert.equal((await fetch(server.url)).headers.get('x-benchmark-mode'), 'production');
  } finally {
    await stopServers(servers);
  }
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
