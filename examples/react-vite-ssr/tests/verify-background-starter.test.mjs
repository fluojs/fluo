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
      try { await run('first', ['-e', options.script], process.cwd(), {}, process.execPath, expected,
        options.kind === 'negative-types' ? 2 : 1); }
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
  const validationExit = kind === 'negative-types' ? 2 : 1;
  for (const [scenario, script, rejected] of [
    ['intended diagnostic', `console.error(${JSON.stringify(diagnostic)}); process.exit(${validationExit})`, false],
    ['unrelated failure', `console.error("unrelated tool failure"); process.exit(${validationExit})`, true],
    ['missing diagnostic', `process.exit(${validationExit})`, true],
    ['wrong exit code', `console.error(${JSON.stringify(diagnostic)}); process.exit(${validationExit === 1 ? 2 : 1})`, true],
    ['wrong identity', `console.error(${JSON.stringify(diagnostic.replaceAll('third', 'other').replaceAll('absent-page', 'other-page').replaceAll('(12,17)', '(11,17)'))}); process.exit(${validationExit})`, true],
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

for (const signal of ['SIGTERM', 'SIGINT']) {
  for (const firstExit of [null, 'success', 'validation', 'failure', 'signal']) {
    test(`run: parallel children, first ${firstExit ?? 'still live'}, parent ${signal} -> terminates every owned child and blocks later commands`, async (t) => {
      mkdirSync(root, { recursive: true });
      const output = mkdtempSync(join(root, 'parallel-process-'));
      const leaf = (id) => `
        const emit = (state) => console.log('CHILD_EVENT ' + JSON.stringify({ id: ${JSON.stringify(id)}, pid: process.pid, state }));
        process.on('SIGTERM', () => { emit('stopped'); process.exit(0); });
        process.on('SIGUSR2', () => {
          emit('released');
          if (${JSON.stringify(firstExit)} === 'signal') {
            process.removeAllListeners('SIGTERM');
            process.kill(process.pid, 'SIGTERM');
          } else {
            if (${JSON.stringify(firstExit)} === 'validation') console.error(${JSON.stringify(diagnostics['duplicate-route'])});
            process.exit(${firstExit === 'validation' || firstExit === 'failure' ? 1 : 0});
          }
        });
        require('node:net').createServer().listen(0, () => emit('ready'));
      `;
      const driver = `
        import { createCommandRunner, authoringRejections } from ${JSON.stringify(harness)};
        const commands = [];
        const { run, dispose } = createCommandRunner(${JSON.stringify(output)}, commands);
        process.channel.ref();
        const first = run('first', ['-e', ${JSON.stringify(leaf('first'))}], process.cwd(), {}, process.execPath,
          ${firstExit === 'validation' ? "authoringRejections['duplicate-route']" : 'false'});
        const second = run('second', ['-e', ${JSON.stringify(leaf('second'))}], process.cwd(), {}, process.execPath);
        const completed = (result) => { process.send('first-complete'); return result; };
        const results = await Promise.allSettled([first.then(completed, (error) => { completed(); throw error; }), second]);
        let laterFailure;
        try { await run('later', ['-e', 'console.log("LATER")'], process.cwd(), {}, process.execPath); }
        catch (error) { laterFailure = error.message; }
        dispose();
        process.send({ commands, results: results.map(({ status }) => status), laterFailure });
        process.disconnect();
      `;
      const child = spawn(process.execPath, ['--input-type=module', '-e', driver], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const controller = new AbortController();
      const pids = new Map();
      const events = [];
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const closed = once(child, 'close', { signal: controller.signal });
      // Subscribe to both terminal outcomes before releasing either process.
      const observed = new Promise((resolve, reject) => {
        child.on('message', (message) => {
          if (message === 'first-complete') {
            if (firstExit !== null) child.kill(signal);
          } else resolve(message);
        });
        controller.signal.addEventListener('abort', () => {
          reject(new assert.AssertionError({ message: 'Every owned child must close after parent cancellation' }));
        }, { once: true });
      });
      const outcome = Promise.all([observed, closed]);
      t.after(() => {
        clearTimeout(timeout);
        for (const pid of pids.values()) {
          try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        child.kill('SIGKILL');
      });
      let pending = '';
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.stdout.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('CHILD_EVENT ')) continue;
          const event = JSON.parse(line.slice('CHILD_EVENT '.length));
          events.push(event);
          if (event.state !== 'ready') continue;
          pids.set(event.id, event.pid);
          if (pids.size === 2) {
            if (firstExit === null) child.kill(signal);
            else process.kill(pids.get('first'), 'SIGUSR2');
          }
        }
      });

      const [result, [exit, exitSignal]] = await outcome;

      assert.equal(exit, 0, stderr);
      assert.equal(exitSignal, null);
      assert.equal(result.commands.length, 2);
      assert.match(result.laterFailure, /no command started/u);
      assert.equal(result.results[1], 'rejected');
      assert.equal(result.results[0], firstExit === 'success' || firstExit === 'validation' ? 'fulfilled' : 'rejected');
      assert.deepEqual(events.filter(({ state }) => state === 'stopped').map(({ id }) => id).sort(),
        firstExit === null ? ['first', 'second'] : ['second']);
      for (const pid of pids.values()) {
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      }
    });
  }
}
