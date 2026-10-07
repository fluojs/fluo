import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = process.env.FLUO_BACKGROUND_EVIDENCE;
if (!root) throw new Error('FLUO_BACKGROUND_EVIDENCE is required for subprocess regression evidence.');
const harness = fileURLToPath(new URL('./verify-background-starter.mjs', import.meta.url));
const diagnostics = {
  'missing-module': '/consumer/src/app.ts:126:5: Browser module ./absent-page.tsx is not in the frozen tsconfig graph; use its build-mapped module literal.',
  'duplicate-route': 'Duplicate route registration detected for GET:/products/third:<none>.',
  'invalid-route': '@GET() path "/third/:" is invalid at segment ":": Parameter names must match /[a-zA-Z_][a-zA-Z0-9_]*/. Only literal segments and full-segment ":param" placeholders are supported.',
  'negative-types': 'src/acceptance-negative.ts(12,17): error TS2345: Argument is not assignable.',
};

async function exercise(t, options) {
  mkdirSync(root, { recursive: true });
  const output = mkdtempSync(join(root, 'process-'));
  const driver = `
    import { once } from 'node:events';
    import { createCommandRunner, authoringRejections } from ${JSON.stringify(harness)};
    const options = ${JSON.stringify(options)};
    const commands = [];
    const { run, dispose } = createCommandRunner(${JSON.stringify(output)}, commands);
    const expected = options.kind ? authoringRejections[options.kind] : false;
    const failures = [];
    process.channel.ref();
    if (options.between) await run('first', ['-e', 'process.stdout.write("SUCCESS\\\\n")'], process.cwd(), {}, process.execPath);
    if (options.before || options.between) {
      const received = once(process, options.cancel);
      process.send('ready');
      await received;
    }
    if (!options.before && !options.between) {
      try { await run('first', ['-e', options.script], process.cwd(), {}, process.execPath, expected); }
      catch (error) { failures.push(error.message); }
    }
    try { await run('later', ['-e', 'process.stdout.write("LATER\\\\n")'], process.cwd(), {}, process.execPath); }
    catch (error) { failures.push(error.message); }
    dispose();
    process.send({ failures, commands });
    process.disconnect();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', driver], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  t.after(() => { clearTimeout(timeout); child.kill('SIGKILL'); });
  const closed = once(child, 'close', { signal: controller.signal });
  const result = new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message === 'ready') child.kill(options.cancel);
      else resolve(message);
    });
    controller.signal.addEventListener('abort', () => reject(new Error('Process result timeout')), { once: true });
  });
  let stdout = '';
  let stderr = '';
  let signalled = false;
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (options.cancel && !options.before && !options.between && !signalled && stdout.includes('READY\n')) {
      signalled = true;
      child.kill(options.cancel);
    }
  });

  const observed = await result;
  const [exit, signal] = await closed;
  assert.equal(exit, 0, stderr);
  assert.equal(signal, null);
  return observed;
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`run: child ${signal} with null exit -> rejects and cancels later commands`, async (t) => {
    const result = await exercise(t, { kind: 'duplicate-route',
      script: `process.kill(process.pid, ${JSON.stringify(signal)})` });

    assert.equal(result.commands[0].exit, null);
    assert.equal(result.commands[0].signal, signal);
    assert.equal(result.failures.length, 2);
    assert.equal(result.commands.length, 1);
  });

  test(`run: parent ${signal} during child -> rejects even intended diagnostic and exit one`, async (t) => {
    const result = await exercise(t, { kind: 'duplicate-route', cancel: signal,
      script: `require('node:net').createServer().listen(0, () => console.log('READY'));
        process.on('SIGTERM', () => { console.error(${JSON.stringify(diagnostics['duplicate-route'])}); process.exit(1); });` });

    assert.equal(result.commands[0].exit, 1);
    assert.equal(result.failures.length, 2);
    assert.equal(result.commands.length, 1);
  });

  for (const phase of ['before', 'between']) {
    test(`run: ${signal} ${phase} subprocesses -> no later command starts`, async (t) => {
      const result = await exercise(t, { [phase]: true, cancel: signal });

      assert.equal(result.failures.length, 1);
      assert.equal(result.commands.length, phase === 'between' ? 1 : 0);
    });
  }
}

for (const [kind, diagnostic] of Object.entries(diagnostics)) {
  for (const [scenario, script, rejected] of [
    ['intended diagnostic', `console.error(${JSON.stringify(diagnostic)}); process.exit(1)`, false],
    ['unrelated failure', 'console.error("unrelated tool failure"); process.exit(1)', true],
    ['missing diagnostic', 'process.exit(1)', true],
    ['wrong exit code', `console.error(${JSON.stringify(diagnostic)}); process.exit(2)`, true],
    ['wrong identity', `console.error(${JSON.stringify(diagnostic.replaceAll('third', 'other').replaceAll('absent-page', 'other-page').replaceAll('(12,17)', '(11,17)'))}); process.exit(1)`, true],
    ['unexpected success', `console.error(${JSON.stringify(diagnostic)}); process.exit(0)`, true],
  ]) {
    test(`run: ${kind} ${scenario} -> ${rejected ? 'rejects' : 'accepts normal validation failure'}`, async (t) => {
      const result = await exercise(t, { kind, script });

      assert.equal(result.failures.length, rejected ? 1 : 0);
      assert.equal(result.commands.length, 2);
    });
  }
}

test('run: normal positive exit zero -> accepts and runs next command', async (t) => {
  const result = await exercise(t, { script: 'process.stdout.write("SUCCESS\\n")' });

  assert.deepEqual(result.failures, []);
  assert.equal(result.commands.length, 2);
  assert.equal(result.commands[0].exit, 0);
});
