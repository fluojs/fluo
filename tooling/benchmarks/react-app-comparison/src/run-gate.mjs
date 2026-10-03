import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluateEvidence } from './gate.mjs';
import { bindEnvironmentPair, captureIsolatedEnvironment, environmentConfigIdentity, importEnvironmentPairBefore, launchIsolatedInvocation, mergeEvidence,
  readIsolatedInvocation, verifyEnvironmentBinding, verifyMeasurementEnvironment, verifyReactEditPairRelation } from './measure.mjs';
import { stopOwnedProcess } from './process-group.mjs';

const execFileAsync = promisify(execFile);
const FRAMEWORKS = ['fluo', 'next', 'react-router', 'tanstack-start'];

export async function verifyProfileEnvironment(aggregateBinding, receipt, expectedConfig, outputRoot, development = false) {
  const aggregate = await verifyEnvironmentBinding(aggregateBinding, outputRoot);
  await verifyMeasurementEnvironment(receipt, outputRoot);
  const profile = await verifyEnvironmentBinding(receipt.environmentBinding, outputRoot);
  if (aggregate.identitySha256 !== profile.identitySha256
    || profile.invocation.parentInvocationId !== aggregate.invocation.invocationId
    || profile.invocation.invocationId !== `${aggregate.invocation.invocationId}-${receipt.profile}-${development ? 'development' : 'production'}`
    || profile.configSha256 !== environmentConfigIdentity(expectedConfig)
    || !isDeepStrictEqual(profile.provenance, expectedConfig.provenance)
    || (development ? !profile.configuration.dev : Boolean(profile.configuration.dev))) {
    throw new Error('environment binding profile/aggregate configuration/invocation mismatch');
  }
  if (receipt.environmentPairRelation) await verifyReactEditPairRelation(receipt.environmentPairRelation, receipt.environmentBinding, outputRoot);
}

// Select the original child record by authenticated parent/profile/mode, not by
// its filename or a caller-provided shared/derived config hash.
export async function beforeProfilePairFlags(beforePath, beforeRoot, profile, development) {
  const aggregateRaw = await readFile(beforePath);
  const aggregate = JSON.parse(aggregateRaw);
  const binding = { method: aggregate.method, path: resolve(beforePath),
    sha256: createHash('sha256').update(aggregateRaw).digest('hex'),
    invocationId: aggregate.invocation.invocationId, identitySha256: aggregate.identitySha256,
    configSha256: aggregate.configSha256 };
  await verifyEnvironmentBinding(binding, beforeRoot);
  const candidates = [];
  for (const entry of await readdir(beforeRoot)) {
    if (!/^environment-.*\.json$/u.test(entry)) continue;
    const path = join(beforeRoot, entry);
    const raw = await readFile(path);
    const record = JSON.parse(raw);
    if (record.invocation.parentInvocationId !== binding.invocationId || record.configuration.profile !== profile
      || Boolean(record.configuration.dev) !== development) continue;
    const child = { method: record.method, path, sha256: createHash('sha256').update(raw).digest('hex'),
      invocationId: record.invocation.invocationId, identitySha256: record.identitySha256, configSha256: record.configSha256 };
    await verifyEnvironmentBinding(child, beforeRoot);
    if (child.identitySha256 !== binding.identitySha256
      || child.invocationId !== `${binding.invocationId}-${profile}-${development ? 'development' : 'production'}`) {
      throw new Error('before profile environment parent/identity mismatch');
    }
    candidates.push(child);
  }
  if (candidates.length !== 1) throw new Error('before profile environment missing/ambiguous');
  const child = candidates[0];
  return ['--environment-identity', child.identitySha256, '--environment-config-identity', child.configSha256,
    '--environment-before-record', child.path, '--environment-before-root', beforeRoot];
}

export function performanceExitCode(verdict, mode, correct) {
  if (mode !== 'discovery' && mode !== 'regression') {
    throw new TypeError(`unknown performance mode: ${mode}`);
  }
  return correct && (mode === 'discovery' || verdict === 'pass') ? 0 : 1;
}

export function requireDevDefinitions(config) {
  for (const framework of FRAMEWORKS) {
    const definition = config.dev?.[framework];
    if (!Array.isArray(definition?.start) || !definition.start.length
      || !definition.url || !definition.readyPattern) {
      throw new TypeError(`${framework} development start, URL, and readiness event are required`);
    }
    for (const kind of ['react-edit', 'css-edit', 'server-edit']) {
      const edit = definition.edits?.[kind];
      if (!edit?.file || !edit.from || !edit.to || !edit.selector
        || (!edit.expectedText && !edit.expectedStyle)) {
        throw new TypeError(`${framework} development ${kind} needs a source edit and browser-visible marker`);
      }
    }
  }
  return config.dev;
}

export async function startServers(definitions, onStart = () => {}) {
  const servers = [];
  try {
    for (const definition of definitions) {
      const child = spawn(definition.command[0], definition.command.slice(1), {
        cwd: definition.cwd,
        env: { ...process.env, ...definition.env, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      servers.push({ ...definition, child });
      onStart(child);
      const url = await new Promise((resolveReady, rejectReady) => {
        let output = '';
        const finish = (result, value) => {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          child.stderr.off('data', onData);
          child.off('error', onError);
          child.off('exit', onExit);
          if (result === resolveReady) {
            child.stdout.on('data', (chunk) => process.stdout.write(`[${definition.name}] ${chunk}`));
            child.stderr.on('data', (chunk) => process.stderr.write(`[${definition.name}] ${chunk}`));
          }
          result(value);
        };
        const onData = (chunk) => {
          output += chunk.toString();
          const match = output.match(definition.readyPattern);
          if (match) finish(resolveReady, definition.urlForMatch(match));
        };
        const onError = (error) => finish(rejectReady, new Error(`${definition.name}: ${error.message}`));
        const onExit = (code) => finish(rejectReady, new Error(`${definition.name}: server exited ${code}: ${output.slice(-1500)}`));
        const timer = setTimeout(() =>
          finish(rejectReady, new Error(`${definition.name}: readiness timeout: ${output.slice(-1500)}`)), 90_000);
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.once('error', onError);
        child.once('exit', onExit);
      });
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`${definition.name}: readiness HTTP ${response.status}`);
      servers[servers.length - 1].url = url;
    }
    return servers;
  } catch (error) {
    await stopServers(servers);
    throw error;
  }
}

export async function stopServers(servers) {
  await Promise.all(servers.map(({ child }) => stopOwnedProcess(child)));
}

export async function readMeasurementReceipt(run, path) {
  let failed;
  try {
    await run();
  } catch (error) {
    if (error.code !== 1) throw error;
    failed = error;
  }
  let receipt;
  try {
    receipt = await readFile(path, 'utf8');
  } catch (error) {
    if (failed && error.code === 'ENOENT') {
      throw new Error(`subprocess exited ${failed.code} without receipt ${path}: ${failed.message}`, { cause: error });
    }
    throw error;
  }
  if (failed) console.error(`correctness exited ${failed.code}; retaining raw receipt ${path}`);
  return JSON.parse(receipt);
}

async function main() {
  const args = process.argv.slice(2);
  if (await launchIsolatedInvocation(fileURLToPath(import.meta.url), args)) return;
  const invocation = await readIsolatedInvocation(args);
  const configPath = args[args.indexOf('--config') + 1];
  const outputDirectory = args[args.indexOf('--output-dir') + 1];
  const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'regression';
  if (!configPath || !outputDirectory || !args.includes('--config') || !args.includes('--output-dir')) {
    throw new TypeError('usage: node src/run-gate.mjs --config config/representative.json --output-dir results/<head> [--mode discovery|regression]');
  }
  performanceExitCode('inconclusive', mode, true);
  const suite = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = resolve(outputDirectory);
  if (!output.startsWith(`${suite}/`)) throw new TypeError('evidence output must remain inside the isolated suite');
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error(`evidence output must start empty: ${output}`);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (Object.hasOwn(config, 'environmentPairRelation') || Object.hasOwn(config.measurement ?? {}, 'environmentPairRelation')) {
    throw new Error('caller-supplied React edit pair descriptor forbidden');
  }
  let environmentBinding;
  let environmentPairRelation;
  if (!invocation && (config.measurement?.isolatedRepresentative || config.measurement?.environmentBinding)) {
    throw new Error('isolated representative requires live host launcher');
  }
  const owned = new Set();
  let servers = [];
  const interrupt = (code) => {
    process.exitCode = code;
    void Promise.all([...owned].map((child) => stopOwnedProcess(child)))
      .catch((error) => console.error(error));
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  async function runOwned(command, args, options) {
    const child = spawn(command, args, { ...options, detached: true,
      stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (options.input) child.stdin.end(options.input);
    owned.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const closed = new Promise((resolveClose) => child.once('close', resolveClose));
    try {
      const code = await new Promise((resolveExit, rejectExit) => {
        child.once('error', rejectExit);
        child.once('exit', resolveExit);
      });
      if (code !== 0) {
        const error = new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        throw error;
      }
      return { stdout, stderr };
    } finally {
      await stopOwnedProcess(child);
      await closed;
      owned.delete(child);
    }
  }
  try {
  requireDevDefinitions(config);
  const baseline = JSON.parse(await readFile(join(suite, 'baseline.json'), 'utf8'));
  if (FRAMEWORKS.some((framework) => !config.servers?.[framework]?.url
    || !config.servers[framework]?.readyPattern || !Array.isArray(config.servers[framework]?.command))) {
    throw new TypeError('all four production servers require a command, readiness event, and URL');
  }
  console.log('Running four-app frozen production correctness smoke before timing.');
  let smoke;
  try {
    smoke = await runOwned('pnpm', ['--ignore-workspace', 'test:smoke'], { cwd: suite });
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout.slice(-12_000));
    if (error.stderr) process.stderr.write(error.stderr.slice(-2_000));
    throw error;
  }
  process.stdout.write(smoke.stdout);
  process.stderr.write(smoke.stderr);
  const root = resolve(suite, '../../..');
  const [{ stdout: commit }, { stdout: dirty }, { stdout: inputs }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: suite }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: suite }),
    execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--',
      'tooling/benchmarks/react-app-comparison/apps',
      'tooling/benchmarks/react-app-comparison/fixture',
      'tooling/benchmarks/react-app-comparison/src',
      'tooling/benchmarks/react-app-comparison/config',
      'tooling/benchmarks/react-app-comparison/package.json',
      'tooling/benchmarks/react-app-comparison/pnpm-lock.yaml'], { cwd: resolve(suite, '../../..') }),
  ]);
  const sourceHash = createHash('sha256');
  for (const path of inputs.trim().split('\n').filter(Boolean).sort()) {
    sourceHash.update(path).update('\0').update(await readFile(resolve(suite, '../../..', path))).update('\0');
  }
  const lockfiles = {};
  const versions = {};
  for (const name of ['.', ...FRAMEWORKS.map((framework) => `apps/${framework}`)]) {
    const content = await readFile(resolve(suite, name, 'pnpm-lock.yaml'));
    lockfiles[name] = createHash('sha256').update(content).digest('hex');
    if (name !== '.') {
      const manifest = JSON.parse(await readFile(resolve(suite, name, 'package.json'), 'utf8'));
      versions[name] = { ...manifest.dependencies, ...manifest.devDependencies };
    }
  }
  const provenance = {
    browser: 'Playwright Chromium 1.61.1; exact browser.version() in each raw trace',
    runtime: process.version,
    builds: Object.fromEntries(FRAMEWORKS.map((framework) =>
      [framework, `pnpm --dir apps/${framework} build; production correctness smoke required before this run`])),
    dataset: 'seeded-operations-jukebox-v1',
    lockfile: lockfiles,
    appVersions: versions,
    commit: commit.trim(),
    dirty: dirty.length > 0,
    sourceSha256: sourceHash.digest('hex'),
    environment: { platform: platform(), arch: arch(), osRelease: release(),
      cpuModel: cpus()[0]?.model, cpuCores: cpus().length, totalMemoryBytes: totalmem(),
      serverNodeEnv: 'production' },
    root,
  };
  if (invocation) {
    const pairBeforeBinding = await importEnvironmentPairBefore(args, output);
    environmentBinding = await captureIsolatedEnvironment({ ...config, ...config.measurement,
      provenance }, invocation, output, {
      pairBeforeBinding, reactEditPairSource: args.includes('--react-edit-pair-source'),
    });
  }
  environmentPairRelation = await bindEnvironmentPair(environmentBinding, args, output);
  servers = await startServers(FRAMEWORKS.map((framework) => ({
    name: framework,
    ...config.servers[framework],
    readyPattern: new RegExp(config.servers[framework].readyPattern, 'u'),
    urlForMatch: () => config.servers[framework].url,
    cwd: resolve(suite, `apps/${framework}`),
  })), (child) => owned.add(child));
  try {
    const apps = Object.fromEntries(servers.map((server) => [server.name, server.url]));
    const serverPids = Object.fromEntries(servers.map((server) => [server.name, server.child.pid]));
    const receipts = [];
    for (const [profile, settings] of Object.entries(baseline.profiles)) {
      const measurement = {
        ...config.measurement,
        profile,
        mode: settings.mode,
        warmupRuns: baseline.policy.warmupRuns,
        measurementRuns: baseline.policy.minimumRuns,
        apps,
        serverPids,
        provenance,
      };
      const configFile = join(output, `${profile}-config.json`);
      const resultFile = join(output, `${profile}.json`);
      const pairFlags = args.includes('--environment-before-record')
        ? await beforeProfilePairFlags(args[args.indexOf('--environment-before-record') + 1],
          args[args.indexOf('--environment-before-root') + 1], profile, false) : [];
      await writeFile(configFile, `${JSON.stringify(measurement, null, 2)}\n`);
      const receipt = await readMeasurementReceipt(() =>
        runOwned(process.execPath,
          [join(suite, 'src/measure.mjs'), '--config', configFile, '--output', resultFile,
            ...(invocation ? ['--isolated-guest'] : []), ...pairFlags],
          { cwd: suite, ...(invocation ? { input: JSON.stringify({ ...invocation,
            parentInvocationId: invocation.invocationId, invocationId: `${invocation.invocationId}-${profile}-production` }) } : {}) }), resultFile);
      await verifyMeasurementEnvironment(receipt, output);
      if (environmentBinding) await verifyProfileEnvironment(environmentBinding, receipt, measurement, output);
      receipts.push(receipt);
    }
    await stopServers(servers);
    for (const [index, receipt] of receipts.entries()) {
        const devConfig = join(output, `${receipt.profile}-dev-config.json`);
        const devFile = join(output, `${receipt.profile}-dev.json`);
        const devMeasurement = {
          ...JSON.parse(await readFile(join(output, `${receipt.profile}-config.json`), 'utf8')),
          dev: config.dev,
        };
        await writeFile(devConfig, `${JSON.stringify(devMeasurement, null, 2)}\n`);
        const pairFlags = args.includes('--environment-before-record')
          ? await beforeProfilePairFlags(args[args.indexOf('--environment-before-record') + 1],
            args[args.indexOf('--environment-before-root') + 1], receipt.profile, true)
          : args.includes('--react-edit-pair-source') ? ['--react-edit-pair-source'] : [];
        const development = await readMeasurementReceipt(() =>
          runOwned(process.execPath,
            [join(suite, 'src/measure.mjs'), '--config', devConfig, '--output', devFile, '--dev',
              ...(invocation ? ['--isolated-guest'] : []), ...pairFlags],
            { cwd: suite, ...(invocation ? { input: JSON.stringify({ ...invocation,
              parentInvocationId: invocation.invocationId, invocationId: `${invocation.invocationId}-${receipt.profile}-development` }) } : {}) }), devFile);
        await verifyMeasurementEnvironment(development, output);
        if (environmentBinding) await verifyProfileEnvironment(environmentBinding, development, devMeasurement, output, true);
        receipts[index] = await mergeEvidence(receipt, development, join(output, 'combined-traces'));
    }
    const verdict = await evaluateEvidence(baseline, receipts, output);
    await writeFile(join(output, 'verdict.json'), `${JSON.stringify({ ...verdict, purpose: mode, provenance,
      ...(environmentBinding ? { environmentBinding, environmentPairRelation, receipts } : {}) }, null, 2)}\n`);
    console.log(`React app performance ${mode}: ${verdict.verdict}`);
    if (performanceExitCode(verdict.verdict, mode, receipts.every((receipt) =>
      receipt.runs.every((run) => run.correctness === 'pass')))) process.exitCode = 1;
  } finally {
    await stopServers(servers);
  }
  } finally {
    await Promise.all([...owned].map((child) => stopOwnedProcess(child)));
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
