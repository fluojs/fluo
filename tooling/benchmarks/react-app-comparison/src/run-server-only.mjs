import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { captureIsolatedEnvironment, launchIsolatedInvocation, readIsolatedInvocation,
  requireEnvironmentPairIdentity, sampleEnvironmentHeadroom, summarizeEnvironmentHeadroom,
  verifyMeasurementEnvironment, verifyTraceFiles } from './measure.mjs';
import { startServers, stopServers } from './run-gate.mjs';
import { evaluateServerEvidence, runServerMeasurement } from './server-measurement.mjs';
import { readSocketShell } from './socket-shell.mjs';

const exec = promisify(execFile);
const suite = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(suite, '../../..');
const args = process.argv.slice(2);
for (const flag of ['--config', '--output-dir']) {
  if (args.includes(flag)) {
    const index = args.indexOf(flag) + 1;
    if (!args[index]) throw new TypeError(`${flag} requires a path`);
    args[index] = resolve(args[index]);
  }
}
if (await launchIsolatedInvocation(fileURLToPath(import.meta.url), args)) process.exit();
const invocation = await readIsolatedInvocation(args);
const output = resolve(args[args.indexOf('--output-dir') + 1] ?? '');
if (!args.includes('--output-dir') || (!invocation && !output.startsWith(`${suite}/results/`))) {
  throw new TypeError('usage: node src/run-server-only.mjs [--config <derived JSON>] --output-dir results/<exact-head>/<before-or-after> [--isolated-container <running-container>]');
}
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error(`Evidence output must start empty: ${output}`);

const configPath = args.includes('--config') ? args[args.indexOf('--config') + 1]
  : join(suite, 'config/representative.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!invocation && (config.measurement?.isolatedRepresentative || config.measurement?.environmentBinding)) {
  throw new Error('isolated representative requires live host launcher');
}
const baselineText = await readFile(join(suite, 'baseline.json'), 'utf8');
const baseline = JSON.parse(baselineText);
const requestedProfile = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : undefined;
if (args.includes('--profile') && !Object.hasOwn(baseline.profiles, requestedProfile ?? '')) {
  throw new RangeError(`Unknown server profile: ${requestedProfile}`);
}
const [{ stdout: head }, { stdout: dirty }, { stdout: tracked }] = await Promise.all([
  exec('git', ['rev-parse', 'HEAD'], { cwd: root }),
  exec('git', ['status', '--porcelain'], { cwd: root }),
  exec('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages',
    'tooling/benchmarks/react-app-comparison/apps',
    'tooling/benchmarks/react-app-comparison/src', 'tooling/benchmarks/react-app-comparison/config',
    'tooling/benchmarks/react-app-comparison/fixture'],
  { cwd: root }),
]);
if (!invocation && !output.startsWith(`${suite}/results/${head.trim()}/`)) {
  throw new Error(`Output root must name the checked-out head ${head.trim()}`);
}
const hash = createHash('sha256');
for (const path of tracked.trim().split('\n').filter(Boolean).sort()) {
  hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0');
}
const lockfileHashes = {};
lockfileHashes.root = createHash('sha256')
  .update(await readFile(join(root, 'pnpm-lock.yaml'))).digest('hex');
for (const path of ['.', 'apps/fluo', 'apps/next', 'apps/react-router', 'apps/tanstack-start']) {
  lockfileHashes[path] = createHash('sha256')
    .update(await readFile(resolve(suite, path, 'pnpm-lock.yaml'))).digest('hex');
}
const frameworks = ['fluo', 'next', 'react-router', 'tanstack-start'];
const buildSha256 = {};
const buildDirectories = ['apps/fluo/dist', 'apps/next/.next', 'apps/react-router/build',
  'apps/tanstack-start/.output',
  ...['core', 'http', 'platform-fastify', 'react', 'runtime', 'validation', 'vite']
    .map((name) => `../../../packages/${name}/dist`)];
for (const directory of buildDirectories) {
  const buildHash = createHash('sha256');
  const pending = [''];
  let files = 0;
  while (pending.length) {
    const relative = pending.pop();
    const entries = await readdir(resolve(suite, directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        buildHash.update(path).update('\0')
          .update(await readFile(resolve(suite, directory, path))).update('\0');
        files += 1;
      }
    }
  }
  if (!files) throw new Error(`Missing production build files: ${directory}`);
  buildSha256[directory] = { sha256: buildHash.digest('hex'), files };
}
const provenance = {
  commit: head.trim(),
  dirty: dirty.length > 0,
  sourceSha256: hash.digest('hex'),
  baselineSha256: createHash('sha256').update(baselineText).digest('hex'),
  lockfile: lockfileHashes,
  buildSha256,
  appVersions: Object.fromEntries(await Promise.all(frameworks.map(async (name) => {
    const manifest = JSON.parse(await readFile(join(suite, 'apps', name, 'package.json'), 'utf8'));
    return [name, { ...manifest.dependencies, ...manifest.devDependencies }];
  }))),
  runtime: process.version,
  builds: Object.fromEntries(frameworks.map((framework) =>
    [framework, `pnpm --ignore-workspace --dir apps/${framework} build; production correctness smoke required before this run`])),
  dataset: 'seeded-operations-jukebox-v1',
  browser: 'Playwright Chromium 1.61.1; exact browser.version() in each raw trace',
  environment: {
    platform: platform(), arch: arch(), osRelease: release(),
    cpuModel: cpus()[0]?.model, cpuCores: cpus().length,
    serverNodeEnv: 'production',
  },
  root,
};
const environmentBinding = invocation ? await captureIsolatedEnvironment({
  ...config, ...config.measurement, provenance,
}, invocation, output, { entrypoints: ['run-server-only.mjs'] }) : undefined;
requireEnvironmentPairIdentity(environmentBinding, args);
await writeFile(join(output, 'provenance.json'), `${JSON.stringify(environmentBinding
  ? { provenance, isolatedRepresentative: true, environmentBinding } : provenance, null, 2)}\n`);
const definitions = frameworks.map((framework) => ({
  name: framework,
  ...config.servers[framework],
  readyPattern: new RegExp(config.servers[framework].readyPattern, 'u'),
  urlForMatch: () => config.servers[framework].url,
  cwd: join(suite, 'apps', framework),
}));
const controller = new AbortController();
const owned = [];
const interrupt = () => {
  controller.abort();
  void stopServers(owned).catch((error) => console.error(error));
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const receipts = [];
let subprocessFailed = false;
let executionFailure;
try {
  const servers = await startServers(definitions, (child) => {
    owned.push({ child });
    if (controller.signal.aborted) {
      void stopServers([{ child }]).catch((error) => console.error(error));
    }
  });
  controller.signal.throwIfAborted();
  const apps = Object.fromEntries(servers.map((server) => [server.name, server.url]));
  const serverPids = Object.fromEntries(servers.map((server) => [server.name, server.child.pid]));
  for (const [profile, settings] of Object.entries(baseline.profiles)) {
    if (requestedProfile !== undefined && profile !== requestedProfile) continue;
    const settingsFile = join(output, `${profile}-config.json`);
    const receiptFile = join(output, `${profile}.json`);
    await writeFile(settingsFile, `${JSON.stringify({
      ...config.measurement, profile, mode: settings.mode,
      warmupRuns: baseline.policy.warmupRuns,
      measurementRuns: baseline.policy.minimumRuns,
      apps, serverPids, provenance,
    }, null, 2)}\n`);
    const measured = await runServerMeasurement(settingsFile, receiptFile, undefined, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]),
      invocation: invocation ? { ...invocation, parentInvocationId: invocation.invocationId,
        invocationId: `${invocation.invocationId}-${profile}-production`,
        collectorEntrypoints: ['run-server-only.mjs'], parentEnvironmentBinding: environmentBinding } : undefined,
    });
    if (measured.exitCode !== 0) subprocessFailed = true;
    const receipt = measured.receipt;
    await verifyMeasurementEnvironment(receipt, output);
    if (environmentBinding && receipt.environmentBinding?.identitySha256 !== environmentBinding.identitySha256) {
      throw new Error('environment binding server profile/runner mismatch');
    }
    await verifyTraceFiles([...receipt.runs, ...receipt.warmups], output);
    receipts.push(receipt);
    console.log(`SERVER_PROFILE_COMPLETE=${profile}`);
    const socketSamples = [];
    for (let cycle = 0; cycle < baseline.policy.warmupRuns + baseline.policy.minimumRuns; cycle++) {
      controller.signal.throwIfAborted();
      const headroomBefore = environmentBinding ? sampleEnvironmentHeadroom() : undefined;
      socketSamples.push({
        warmup: cycle < baseline.policy.warmupRuns,
        ...(environmentBinding ? { isolatedRepresentative: true, environmentBinding } : {}),
        ...(await readSocketShell(new URL('/', apps.fluo))),
        ...(headroomBefore ? { environmentHeadroom:
          summarizeEnvironmentHeadroom(headroomBefore, sampleEnvironmentHeadroom()) } : {}),
      });
    }
    await writeFile(join(output, `${profile}-socket.json`), `${JSON.stringify({
      profile,
      source: 'direct Node HTTP socket on the same built Fluo seeded listing; native loopback transport, no browser CPU/network emulation',
      provenance,
      ...(environmentBinding ? { isolatedRepresentative: true, environmentBinding } : {}),
      socketSamples,
    }, null, 2)}\n`);
    console.log(`SERVER_SOCKET_COMPLETE=${profile}`);
  }
} catch (error) {
  subprocessFailed = true;
  executionFailure = {
    message: error instanceof Error ? error.message : String(error),
    cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : null,
  };
  console.error(executionFailure);
} finally {
  await stopServers(owned);
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
const { checks, verdict: evaluatedVerdict, serverMetrics } =
  await evaluateServerEvidence(baseline, receipts, output);
const verdict = evaluatedVerdict === 'fail' ? 'fail'
  : subprocessFailed ? 'inconclusive' : evaluatedVerdict;
const result = {
  purpose: 'server-owned subset only; browser FCP shellArrivalMs and unchanged development/client metrics are not a socket or whole-product gate',
  serverMetrics,
  requestedProfile: requestedProfile ?? null,
  verdict,
  subprocessFailed,
  executionFailure: executionFailure ?? null,
  provenance,
  ...(environmentBinding ? { isolatedRepresentative: true, environmentBinding } : {}),
  checks,
  receipts: receipts.map((receipt) => ({
    profile: receipt.profile,
    measuredRuns: receipt.runs.length,
    warmups: receipt.warmups.length,
    socketTrace: `${receipt.profile}-socket.json`,
  })),
};
await writeFile(join(output, 'server-verdict.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`SERVER_SUBSET_VERDICT=${verdict}`);
if (subprocessFailed || verdict !== 'pass') process.exitCode = 1;
