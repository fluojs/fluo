import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as resources from '../src/resources';

test('procCpuSeconds: command parentheses and subsecond ticks -> retains own user plus system CPU', () => {
  const fields = ['R', ...Array.from({ length: 10 }, () => '0'), '12', '3', '999', '999'];
  const stat = `123 (worker (name)) ${fields.join(' ')}`;

  const seconds = resources.procCpuSeconds(stat, 100);

  assert.equal(seconds, 0.15);
});

test('procCpuSeconds: missing counters or invalid frequency -> rejects unsupported measurements', () => {
  const stat = `123 (worker) R ${Array.from({ length: 10 }, () => '0').join(' ')} 12 3`;

  assert.throws(() => resources.procCpuSeconds('123 (worker) R', 100), /Unsupported procfs CPU counter/);
  assert.throws(() => resources.procCpuSeconds(stat, 0), /Unsupported procfs CPU counter/);
  assert.throws(() => resources.procCpuSeconds(stat.replace('12 3', '-1 3'), 100), /Unsupported procfs CPU counter/);
});

test('processTreeSample: Linux fractional CPU counter -> preserves kernel resolution', {
  skip: process.platform !== 'linux',
  timeout: 10_000,
}, async () => {
  // Time itself is the measured behavior; consume CPU, never sleep for readiness.
  const frequency = Number((await promisify(execFile)('getconf', ['CLK_TCK'])).stdout.trim());
  assert.ok(Number.isSafeInteger(frequency) && frequency > 0);
  const child = fork(fileURLToPath(new URL('./fixtures/cpu-counter.mjs', import.meta.url)), [String(frequency)], {
    execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const closed = once(child, 'close', { signal: AbortSignal.timeout(8_000) });
  const counter = async () => {
    const text = await readFile(`/proc/${child.pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    return (Number(fields[11]) + Number(fields[12])) / frequency;
  };
  try {
    await once(child, 'message', { signal: AbortSignal.timeout(5_000) });
    const ready = once(child, 'message', { signal: AbortSignal.timeout(5_000) });
    child.send('burn');
    await ready;
    assert.ok(child.pid);
    const before = await counter();

    const sample = await resources.processTreeSample(child.pid);

    const after = await counter();
    const subject = sample.processes.find((item) => item.pid === child.pid);
    assert.ok(subject);
    assert.equal(Math.floor(before), Math.floor(after), 'Reference interval must exclude a whole-second boundary');
    assert.ok(subject.cpuSeconds >= before && subject.cpuSeconds <= after,
      `CPU counter ${subject.cpuSeconds} is outside kernel interval [${before}, ${after}]`);
    assert.equal(sample.cpuTimeResolutionSeconds, 1 / frequency);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  }
});
