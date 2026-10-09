import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { selectProfileTargets } from '../../src/profile';
import { RawCapture, RuntimeCapture } from '../../src/profiling';
import { environmentSummary } from '../../src/provenance';
import { comparisonHeaders } from '../../src/shared/comparison-headers';
import { selectSuite } from '../../src/suites';
import { buildCommands, buildTarget, hostBoundaries, nextBuildEntry, nextFixtureDirectory, startTargets, stopTargets, targetLaunch, targetRequests, WDIR, waitForTarget } from '../../src/targets';

// Finite real HTTP verification, deliberately not an autocannon/load run.
const output = process.env.BENCH_CORRECTNESS_OUTPUT;
if (!output || !relative(join(WDIR, 'results/issue-3914'), output) || relative(join(WDIR, 'results/issue-3914'), output).startsWith('..')) {
  throw new Error('BENCH_CORRECTNESS_OUTPUT must name a unique file inside results/issue-3914');
}
const targets = selectProfileTargets(process.env.BENCH_TARGETS?.split(',') ?? [
  'native-workers', 'fluo-workers', 'native-nextjs', 'fluo-nextjs', 'native-nextjs-pages', 'fluo-nextjs-pages',
]);
const receipts: unknown[] = [];
const builds: unknown[] = [];
await mkdir(join(WDIR, 'results/issue-3914'), { recursive: true });
try {
  for (const target of targets) {
    await buildTarget(target);
    if (target.platform === 'nextjs') {
      const directory = nextFixtureDirectory(target);
      const entry = nextBuildEntry(target);
      const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      builds.push({
        target: target.name, directory, entry,
        entrySha256: hash(await readFile(join(WDIR, entry))),
        buildId: (await readFile(join(WDIR, directory, '.next/BUILD_ID'), 'utf8')).trim(),
        traceSha256: hash(await readFile(join(WDIR, directory, '.next/trace'))),
      });
    }
  }
  for (const configuration of ['default', 'equivalent'] as const) {
    for (const target of targets) {
      for (const scenario of selectSuite('all')) {
        const directory = join(dirname(output), `${basename(output, '.json')}-subjects`, `${configuration}-${target.name}-${scenario.name}`);
        await mkdir(directory, { recursive: true });
        const raw = new RawCapture(dirname(output), directory);
        const options = {
          env: { BENCH_CONFIGURATION: configuration }, quiet: true,
          inspectorPort: target.port + 100,
          onOutput: (_target: typeof target, stream: 'stdout' | 'stderr', bytes: Buffer) => raw.append(stream, `${stream}.log`, bytes),
        };
        const processes = startTargets(scenario.appShape, [target], options);
        let session: RuntimeCapture | undefined;
        const receipt: Record<string, unknown> = {};
        try {
          await waitForTarget(processes[0]);
          const pid = processes[0].pid;
          if (pid === undefined) throw new Error('Missing correctness host PID');
          // Identity only: never start a profiler, diagnostics timer, or load.
          session = await RuntimeCapture.connect(target, pid, options.inspectorPort, raw);
          const requests = targetRequests(target, scenario.requests);
          const check = async (request: (typeof requests)[number]) => {
            const response = await fetch(`http://127.0.0.1:${target.port}${request.path}`, {
              // Every scenario restarts the host on the same port. Do not let
              // the client's global pool reuse a socket from the prior host.
              method: request.method, headers: { ...request.headers, connection: 'close' }, body: request.body,
              signal: AbortSignal.timeout(15_000),
            });
            assert.equal(response.status, request.expectedStatus, `${target.name}/${scenario.name}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.deepEqual(bytes, Buffer.from(request.expectedBody));
            assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
            const security = target.product === 'fluo' ? comparisonHeaders('equivalent') : comparisonHeaders(configuration);
            for (const [name, value] of Object.entries(security)) assert.equal(response.headers.get(name), value);
          };
          // Concurrent first requests must succeed on the same request-lazy host.
          await Promise.all(requests.flatMap((request) => [check(request), check(request)]));
          // Same-host warm requests retain the workload and cached application.
          for (const request of requests) await check(request);
          const launch = targetLaunch(target, scenario.appShape, options);
          Object.assign(receipt, {
            target: target.name, scenario: scenario.name, configuration,
            completedRequests: requests.length * 3, firstWave: 'concurrent-first-http-requests',
            warmWave: 'same-host-subsequent-http-requests', host: hostBoundaries(target),
            launch: { command: launch.command, args: launch.args, cwd: launch.cwd },
            subject: session.subject, identityPath: session.identityPath,
          });
        } finally {
          try { await session?.close(); }
          finally { await stopTargets(processes); }
        }
        if (raw.failure) throw raw.failure;
        receipts.push({ ...receipt, artifacts: await raw.artifacts() });
        console.log(`CORRECTNESS PASS ${configuration}/${target.name}/${scenario.name}`);
      }
    }
  }
} finally {
  await writeFile(output, `${JSON.stringify({
    kind: 'finite-real-http-correctness', notPerformanceBaseline: true,
    expectedConditions: targets.length * 11 * 2, completedConditions: receipts.length,
    environment: await environmentSummary(), buildCommands, builds, receipts,
    deployedWorkers: { status: 'unconfirmed', missing: ['account/project/endpoint', 'deployment authority', 'credential availability', 'cost budget/quota', 'host telemetry', 'isolate generation identity'] },
  }, null, 2)}\n`, { flag: 'wx' });
}
