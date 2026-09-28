import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluateEvidence } from './gate.mjs';
import { mergeEvidence } from './measure.mjs';

const execFileAsync = promisify(execFile);
const FRAMEWORKS = ['fluo', 'next', 'react-router', 'tanstack-start'];

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

export async function startServers(definitions) {
  const servers = [];
  try {
    for (const definition of definitions) {
      const child = spawn(definition.command[0], definition.command.slice(1), {
        cwd: definition.cwd,
        env: { ...process.env, ...definition.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      servers.push({ ...definition, child });
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
  await Promise.all(servers.map(async ({ child }) => {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
    const exit = once(child, 'exit');
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    let timer;
    try {
      await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`server ${child.pid} shutdown timeout`)), 5_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }));
}

async function main() {
  const args = process.argv.slice(2);
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
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  requireDevDefinitions(config);
  const baseline = JSON.parse(await readFile(join(suite, 'baseline.json'), 'utf8'));
  if (FRAMEWORKS.some((framework) => !config.servers?.[framework]?.url
    || !config.servers[framework]?.readyPattern || !Array.isArray(config.servers[framework]?.command))) {
    throw new TypeError('all four production servers require a command, readiness event, and URL');
  }
  console.log('Running four-app frozen production correctness smoke before timing.');
  let smoke;
  try {
    smoke = await execFileAsync('pnpm', ['--ignore-workspace', 'test:smoke'], {
      cwd: suite, maxBuffer: 20 * 1024 * 1024,
    });
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
      cpuModel: cpus()[0]?.model, cpuCores: cpus().length, totalMemoryBytes: totalmem() },
    root,
  };
  const servers = await startServers(FRAMEWORKS.map((framework) => ({
    name: framework,
    ...config.servers[framework],
    readyPattern: new RegExp(config.servers[framework].readyPattern, 'u'),
    urlForMatch: () => config.servers[framework].url,
    cwd: resolve(suite, `apps/${framework}`),
  })));
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
      await writeFile(configFile, `${JSON.stringify(measurement, null, 2)}\n`);
      await execFileAsync(process.execPath,
        [join(suite, 'src/measure.mjs'), '--config', configFile, '--output', resultFile],
        { cwd: suite, maxBuffer: 10 * 1024 * 1024 });
      receipts.push(JSON.parse(await readFile(resultFile, 'utf8')));
    }
    await stopServers(servers);
    for (const [index, receipt] of receipts.entries()) {
        const devConfig = join(output, `${receipt.profile}-dev-config.json`);
        const devFile = join(output, `${receipt.profile}-dev.json`);
        await writeFile(devConfig, `${JSON.stringify({
          ...JSON.parse(await readFile(join(output, `${receipt.profile}-config.json`), 'utf8')),
          dev: config.dev,
        }, null, 2)}\n`);
        await execFileAsync(process.execPath,
          [join(suite, 'src/measure.mjs'), '--config', devConfig, '--output', devFile, '--dev'],
          { cwd: suite, maxBuffer: 10 * 1024 * 1024 });
        const development = JSON.parse(await readFile(devFile, 'utf8'));
        receipts[index] = await mergeEvidence(receipt, development, join(output, 'combined-traces'));
    }
    const verdict = await evaluateEvidence(baseline, receipts, output);
    await writeFile(join(output, 'verdict.json'), `${JSON.stringify({ ...verdict, purpose: mode, provenance }, null, 2)}\n`);
    console.log(`React app performance ${mode}: ${verdict.verdict}`);
    if (performanceExitCode(verdict.verdict, mode, receipts.every((receipt) =>
      receipt.runs.every((run) => run.correctness === 'pass')))) process.exitCode = 1;
  } finally {
    await stopServers(servers);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
