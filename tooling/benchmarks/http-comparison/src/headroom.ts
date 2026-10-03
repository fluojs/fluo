import { writeFile } from 'node:fs/promises';
import { load } from './load';
import { environmentSummary } from './provenance';
import { monitorServer } from './resources';
import { SCENARIOS } from './scenarios';
import { buildTarget, runCommand, startTargets, stopTargets, TARGETS, waitForTarget } from './targets';

const target = TARGETS.find((item) => item.name === (process.env.BENCH_TARGETS ?? 'native-fastify'));
if (!target) throw new Error('Headroom diagnostic requires one known BENCH_TARGETS target');
const scenario = SCENARIOS.find((item) => item.name === (process.env.BENCH_SCENARIOS ?? 'read-search-local'));
if (!scenario) throw new Error('Headroom diagnostic requires one known BENCH_SCENARIOS scenario');
const output = process.env.BENCH_OUTPUT_JSON;
if (!output) throw new Error('BENCH_OUTPUT_JSON is required');
await buildTarget(target);
if (process.env.BENCH_LOAD_PROCESS === '1') {
  await runCommand('pnpm', ['exec', 'esbuild', 'src/load-client.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--outfile=dist/load-client.mjs']);
}
const servers = startTargets(scenario.appShape, [target]);
const observations: unknown[] = [];
const environment = await environmentSummary();
try {
  await waitForTarget(servers[0]);
  const pid = servers[0].pid;
  if (pid === undefined) throw new Error('Missing server PID');
  const options = {
    url: `http://${process.env.BENCH_SERVER_HOST ?? '127.0.0.1'}:${target.port}`,
    connections: 64, duration: 10, requests: scenario.requests,
  };
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const order = repeat % 2 === 0 ? [1, 4] : [4, 1];
    for (const workers of order) {
      await load({ ...options, duration: 3 }, 'headroom warmup');
      const measured = await monitorServer(pid, () => Promise.all(Array.from({ length: workers }, (_, index) =>
        load({ ...options, connections: options.connections / workers }, `worker ${index}`))));
      const requestsPerSecond = measured.value.reduce((sum, sample) => sum + sample.result.requests.average, 0);
      observations.push({ repeat, workers, totalConnections: options.connections,
        requestsPerSecond, samples: measured.value, server: measured.server });
      console.log(`HEADROOM workers=${workers} repeat=${repeat} rps=${requestsPerSecond} serverCPU=${measured.server.cpuCoreEquivalentPercent}`);
    }
  }
} finally {
  await stopTargets(servers);
  await writeFile(output, JSON.stringify({
    kind: 'generator-scaling-diagnostic', notPerformanceBaseline: true,
    environment,
    target: target.name, scenario: scenario.name,
    limitations: ['Worker intervals overlap but are not synchronized; retain individual raw intervals. This diagnostic is not a baseline verdict.'],
    observations,
  }, null, 2));
}
