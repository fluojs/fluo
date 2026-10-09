import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { load } from '../../src/load';
import { RawCapture, RuntimeCapture } from '../../src/profiling';
import { SCENARIOS } from '../../src/scenarios';
import { buildTarget, startTargets, stopTargets, TARGETS, WDIR, waitForTarget } from '../../src/targets';

const signal = process.env.BENCH_SHUTDOWN_SIGNAL ?? 'SIGTERM';
assert.ok(signal === 'SIGTERM' || signal === 'SIGINT');
const root = join(WDIR, `results/issue-3914/direct-workerd-shutdown-probe-${signal.toLowerCase()}`);
await mkdir(root, { recursive: true });
const execute = promisify(execFile);
const scenario = SCENARIOS.find((item) => item.name === 'read-search-local');
assert.ok(scenario);
const receipts: unknown[] = [];
try {
  for (const target of TARGETS.filter((item) => item.platform === 'workers')) {
    await buildTarget(target);
    const directory = join(root, target.name);
    await mkdir(directory, { recursive: true });
    const raw = new RawCapture(root, directory);
    const children = startTargets(scenario.appShape, [target], {
      inspectorPort: target.port + 100, quiet: true,
      env: { BENCH_CONFIGURATION: 'equivalent' },
      onOutput: (_target, stream, bytes) => raw.append(stream, `${stream}.log`, bytes),
    });
    const child = children[0];
    let session: RuntimeCapture | undefined;
    let sample: Promise<unknown> | undefined;
    let forced = false;
    try {
      await waitForTarget(child);
      assert.ok(child.pid);
      await load({ url: `http://127.0.0.1:${target.port}`, requests: scenario.requests, connections: 1, duration: 1 }, 'shutdown warmup');
      session = await RuntimeCapture.connect(target, child.pid, target.port + 100, raw);
      await session.start('cpu');
      await load({ url: `http://127.0.0.1:${target.port}`, requests: scenario.requests, connections: 1, duration: 1 }, 'shutdown capture');
      await session.stop('cpu');
      await session.close();
      const closed = once(child, 'close');
      const start = performance.now();
      // Shutdown duration itself is the observed behavior; this deadline collects
      // native stacks only if the former 1.5s graceful deadline would expire.
      const sampling = setTimeout(() => {
        sample = execute('/usr/bin/sample', [String(child.pid), '1', '-file', join(directory, 'native-stack.log')])
          .then((result) => ({ stdout: result.stdout, stderr: result.stderr }), (error: unknown) => ({ error: String(error) }));
      }, 1_500);
      const deadline = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 10_000);
      child.kill(signal);
      await closed;
      clearTimeout(sampling);
      clearTimeout(deadline);
      receipts.push({
        target: target.name, subject: session.subject, shutdownMs: performance.now() - start,
        exitCode: child.exitCode, signalCode: child.signalCode, requestedSignal: signal, forced,
        sample: await sample, artifacts: await raw.artifacts(),
      });
    } finally {
      await session?.close();
      await stopTargets(children);
    }
  }
} finally {
  await writeFile(join(root, 'receipt.json'), JSON.stringify({ notPerformanceBaseline: true, receipts }, null, 2), { flag: 'wx' });
}
