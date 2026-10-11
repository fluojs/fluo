import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as resources from '../src/resources';

test('proc diagnostic parsers: actual field offsets and large counters -> lossless scheduler metadata', () => {
  const fields = ['R', ...Array.from({ length: 35 }, () => '0'), '11', '987'];

  const processor = resources.procLogicalProcessor(`123 (worker (name)) ${fields.join(' ')}`);
  const scheduler = resources.procSchedstat('9007199254740993 2500 42\n');

  assert.equal(processor, 11);
  assert.deepEqual(scheduler, { executionNs: '9007199254740993', waitNs: '2500', slices: '42' });
  assert.throws(() => resources.procLogicalProcessor('123 (worker) R'));
  assert.throws(() => resources.procLogicalProcessor(`123 (worker) ${fields.slice(0, 36).join(' ')} -1`));
  for (const input of ['', '1 2', '-1 2 3', '1 garbage 3']) assert.throws(() => resources.procSchedstat(input));
});

test('cgroupCpuDirectory: namespaced mount roots -> actual quota directory or explicit unsupported', () => {
  const mountinfo = '31 22 0:28 /parent /sys/fs/cgroup rw - cgroup2 cgroup rw\n';

  const directory = resources.cgroupCpuDirectory('0::/parent/worker\n', mountinfo);

  assert.deepEqual(directory, { status: 'readable', value: '/sys/fs/cgroup/worker' });
  assert.deepEqual(resources.cgroupCpuDirectory('0::/parent\n', mountinfo),
    { status: 'readable', value: '/sys/fs/cgroup' });
  assert.equal(resources.cgroupCpuDirectory('2:cpu:/worker', mountinfo).status, 'unsupported');
  assert.equal(resources.cgroupCpuDirectory('0::/worker', '').status, 'unsupported');
  assert.throws(() => resources.cgroupCpuDirectory('0::/elsewhere', mountinfo));
});

test('diagnosticRead: unavailable procfs -> visible read error without fabricated counters', async () => {
  const path = `/proc/${process.pid}/drift-diagnostic-nonexistent`;

  const reading = await resources.diagnosticRead(path, resources.procSchedstat);

  assert.equal(reading.status, 'read-error');
  if (reading.status !== 'read-error') assert.fail('Expected explicit read-error');
  assert.equal(reading.path, path);
  assert.match(reading.error, /ENOENT/);
  assert.equal(Object.hasOwn(reading, 'value'), false);
});

test('processTreeSample: opt-in diagnostics -> platform availability explicit and ordinary metadata absent', { timeout: 10_000 }, async () => {
  const previous = process.env.BENCH_DIAGNOSTIC_DRIFT;
  // Sample a separate serving subject, not the collector's transient ps child.
  const child = fork(fileURLToPath(new URL('./fixtures/cpu-counter.mjs', import.meta.url)), ['100'], {
    execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const closed = once(child, 'close', { signal: AbortSignal.timeout(8_000) });
  try {
    await once(child, 'message', { signal: AbortSignal.timeout(5_000) });
    assert.ok(child.pid);
    process.env.BENCH_DIAGNOSTIC_DRIFT = '1';

    const sample = await resources.processTreeSample(child.pid);

    assert.ok(sample.driftDiagnostic);
    assert.ok(sample.driftDiagnostic.sampledAtEpochMs > 0);
    const linux = sample.driftDiagnostic.linux;
    if (process.platform === 'linux') {
      assert.equal(linux.status, 'readable');
      if (linux.status !== 'readable') assert.fail('Expected Linux diagnostic');
      const subject = linux.value.processes.find((item) => item.pid === child.pid);
      assert.ok(subject);
      assert.equal(subject.logicalProcessor.status, 'readable');
      assert.equal(subject.schedstat.status, 'readable');
      assert.equal(linux.value.systemStat.status, 'readable');
      assert.ok(['readable', 'read-error'].includes(linux.value.cpuPressure.status));
      assert.ok(['readable', 'read-error', 'unsupported'].includes(subject.cgroupCpu.status));
    } else {
      assert.equal(linux.status, 'unsupported');
      assert.equal(Object.hasOwn(linux, 'value'), false);
    }
    delete process.env.BENCH_DIAGNOSTIC_DRIFT;

    const ordinary = await resources.processTreeSample(child.pid);

    assert.equal(Object.hasOwn(ordinary, 'driftDiagnostic'), false);
  } finally {
    if (previous === undefined) delete process.env.BENCH_DIAGNOSTIC_DRIFT;
    else process.env.BENCH_DIAGNOSTIC_DRIFT = previous;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  }
});

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
