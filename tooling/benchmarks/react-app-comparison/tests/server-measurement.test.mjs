import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { verifyTraceFiles } from '../src/measure.mjs';
import { evaluateServerEvidence, runServerMeasurement } from '../src/server-measurement.mjs';
import { METRICS } from '../src/evaluate.ts';

for (const mutation of ['metrics', 'provenance']) {
  test(`server-only evaluation rejects mismatched raw ${mutation} before filtering`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluo-server-evaluation-'));
    try {
      const metrics = Object.fromEntries(METRICS.map((metric) => [metric, 70]));
      const runs = [];
      for (let index = 0; index < 3; index++) {
        const runId = `server-${index}`;
        const trace = join(directory, `${runId}.json`);
        const run = {
          profile: 'desktop-native', mode: 'native', framework: 'fluo', runId, trace,
          warmupRuns: 1, correctness: 'pass', metrics,
        };
        await writeFile(trace, JSON.stringify({
          ...run,
          schemaVersion: 1,
          provenance: { commit: mutation === 'provenance' && index === 1 ? 'b'.repeat(40) : 'a'.repeat(40) },
          environment: { runtime: 'Node 24' },
          correctness: { pass: true },
          metrics: mutation === 'metrics' && index === 1 ? { ...metrics, coldTtfbMs: 130 } : metrics,
          unavailable: {}, profileSettings: {}, requests: [],
        }));
        runs.push(run);
      }
      const baseline = {
        policy: { minimumRuns: 3, warmupRuns: 1, maximumRelativeSpread: 0.1, outlierMadMultiplier: 3 },
        profiles: {
          'desktop-native': {
            mode: 'native',
            absoluteBudgets: Object.fromEntries(METRICS.map((metric) => [metric, 100])),
            relativeBands: Object.fromEntries(METRICS.map((metric) => [metric, 1.5])),
          },
        },
      };
      await assert.rejects(evaluateServerEvidence(baseline, [
        { profile: 'desktop-native', mode: 'native', runs },
      ], directory), new RegExp(`raw trace ${mutation}`, 'u'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('an unknown single-window profile fails before starting measurement servers', async () => {
  const suite = new URL('../', import.meta.url);
  const output = new URL(`results/profile-validation-${randomUUID()}`, suite);
  try {
    await assert.rejects(promisify(execFile)(process.execPath, [
      'src/run-server-only.mjs', '--output-dir', output.pathname, '--profile', 'unknown',
    ], { cwd: suite }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /RangeError/u);
      assert.equal(error.stdout, '');
      return true;
    });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('an interrupted pending measurement is reaped and cannot accept a receipt',
  { timeout: 5_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluo-server-interrupt-'));
    const script = join(directory, 'pending.mjs');
    const controller = new AbortController();
    let notifyReady;
    const ready = new Promise((resolve) => { notifyReady = resolve; });
    let response;
    const server = createServer((request, reply) => {
      response = reply;
      reply.writeHead(200);
      reply.flushHeaders();
      notifyReady(Number(request.url.slice(1)));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let measured;
    let deadline;
    try {
      const port = server.address().port;
      await writeFile(script, `const response = await fetch('http://127.0.0.1:${port}/' + process.pid);
await response.text();`);
      measured = runServerMeasurement(join(directory, 'config.json'),
        join(directory, 'receipt.json'), script, { signal: controller.signal });
      // Subscribe to child readiness before interrupting an actual pending body.
      const pid = await ready;
      const settled = Promise.race([measured, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('measurement ignored cancellation')), 1_000);
      })]);
      controller.abort();
      await assert.rejects(settled, /abort/iu);
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    } finally {
      clearTimeout(deadline);
      response?.end();
      await measured?.catch(() => {});
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });

test('a failed server subprocess without a receipt preserves its exit rather than masking it with ENOENT',
  { timeout: 5_000 }, async () => {
    // Given: a real measurement subprocess that exits before writing any receipt.
    const directory = await mkdtemp(join(tmpdir(), 'fluo-server-receipt-'));
    const script = join(directory, 'failed.mjs');
    const receipt = join(directory, 'receipt.json');
    try {
      await writeFile(script, 'process.exitCode = 1;');
      // When / Then: failure includes the subprocess exit and retains the missing-file cause.
      await assert.rejects(runServerMeasurement(join(directory, 'config.json'), receipt, script), (error) => {
        assert.match(error.message, /measure\.mjs exited 1/u);
        assert.equal(error.cause?.code, 'ENOENT');
        assert.equal(error.cause?.path, receipt);
        return true;
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test('a failed server receipt retains its nonzero exit and cannot pass missing raw trace validation',
  { timeout: 5_000 }, async () => {
    // Given: a real subprocess writes a failed receipt, but its raw trace is absent.
    const directory = await mkdtemp(join(tmpdir(), 'fluo-server-receipt-'));
    const script = join(directory, 'failed.mjs');
    const receiptPath = join(directory, 'receipt.json');
    const receipt = { runs: [{ correctness: 'fail', trace: join(directory, 'absent.json') }], warmups: [] };
    try {
      await writeFile(script, `import { writeFile } from 'node:fs/promises';
await writeFile(process.argv[process.argv.indexOf('--output') + 1], ${JSON.stringify(JSON.stringify(receipt))});
process.exitCode = 1;`);
      // When: the failed child has an actual receipt.
      const result = await runServerMeasurement(join(directory, 'config.json'), receiptPath, script);
      // Then: neither its exit nor its missing trace becomes a successful measurement.
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.receipt, receipt);
      await assert.rejects(verifyTraceFiles(result.receipt.runs, directory), /invalid trace/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
