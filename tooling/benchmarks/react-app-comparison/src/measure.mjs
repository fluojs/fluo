import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { arch, availableParallelism, cpus, hostname, platform, release, totalmem } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

const execute = promisify(execFile);
const sha256 = (raw) => createHash('sha256').update(raw).digest('hex');
const objectSha256 = (value) => sha256(JSON.stringify(value));
const ENVIRONMENT_METHOD = 'isolated-linux-representative-v1';

// Host-only facts come from the daemon, never guest-provided identity strings.
export async function observeIsolatedHost(container, run = execute) {
  const [{ stdout: inspection }, { stdout: information }] = await Promise.all([
    run('docker', ['inspect', container]), run('docker', ['info', '--format', '{{json .}}']),
  ]);
  const [selected] = JSON.parse(inspection);
  const info = JSON.parse(information);
  if (!selected?.State?.Running || !selected.Id || !selected.State.Pid) {
    throw new Error('isolated environment requires a running container');
  }
  const allocation = selected.HostConfig;
  return {
    host: { platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model },
    vm: { daemonId: info.ID, operatingSystem: info.OperatingSystem, kernel: info.KernelVersion,
      architecture: info.Architecture, logicalCpus: info.NCPU, memoryBytes: info.MemTotal, name: info.Name },
    container: { id: selected.Id, imageReference: selected.Config.Image, imageId: selected.Image,
      hostname: selected.Config.Hostname, pid: selected.State.Pid, startedAt: selected.State.StartedAt,
      allocation: { nanoCpus: allocation.NanoCpus, cpuQuota: allocation.CpuQuota,
        cpuPeriod: allocation.CpuPeriod, cpuset: allocation.CpusetCpus,
        memory: allocation.Memory, memorySwap: allocation.MemorySwap } },
    raw: { inspection, information },
  };
}

// Both runners use this host entrypoint. stdin carries a fresh host observation
// to the selected container's actual Node executable, not a prepared JSON file.
export async function launchIsolatedInvocation(script, flags) {
  if (!flags.includes('--isolated-container')) return false;
  const index = flags.indexOf('--isolated-container');
  const container = flags[index + 1];
  if (!container || flags.includes('--isolated-guest')) throw new Error('invalid isolated container invocation');
  const host = await observeIsolatedHost(container);
  const { stdout: node } = await execute('docker', ['exec', host.container.id, 'sh', '-c', 'command -v node']);
  const invocation = { method: ENVIRONMENT_METHOD, invocationId: randomUUID(),
    observedAt: new Date().toISOString(), hostPid: process.pid, host };
  const args = flags.filter((_, position) => position !== index && position !== index + 1);
  const child = spawn('docker', ['exec', '-i', host.container.id, node.trim(), script, ...args, '--isolated-guest'],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const completed = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  child.stdin.end(JSON.stringify(invocation));
  const result = await completed;
  const after = await observeIsolatedHost(host.container.id);
  if (!isDeepStrictEqual({ vm: host.vm, container: host.container }, { vm: after.vm, container: after.container })) {
    throw new Error('isolated environment host allocation/container changed during invocation');
  }
  if (result.signal || result.code !== 0) process.exitCode = result.code || 1;
  return true;
}

export async function readIsolatedInvocation(flags) {
  if (!flags.includes('--isolated-guest')) return undefined;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const invocation = JSON.parse(raw);
  if (invocation.method !== ENVIRONMENT_METHOD || !invocation.invocationId || !invocation.host?.raw) {
    throw new Error('missing live isolated host observation');
  }
  return invocation;
}

function environmentSettings(config) {
  // Exclude source/build/run evidence which legitimately differs in a pair.
  const { provenance, environmentBinding, isolatedRepresentative, serverPids, ...settings } = config;
  return settings;
}

function comparableEnvironmentSettings(config) {
  const roots = Object.entries(config.dev ?? {}).filter(([, definition]) => isAbsolute(definition.cwd ?? ''))
    .map(([framework, definition]) => [definition.cwd, `$app/${framework}`]);
  if (isAbsolute(config.provenance?.root ?? '')) roots.push([config.provenance.root, '$root']);
  const normalize = (value) => {
    if (typeof value === 'string') {
      for (const [root, label] of roots) {
        if (value === root || value.startsWith(`${root}/`)) return `${label}${value.slice(root.length)}`;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
    return value;
  };
  const settings = normalize(environmentSettings(config));
  if (settings.nativeLifetime?.python) settings.nativeLifetime.python = '$authenticated-python';
  return settings;
}

export function environmentConfigIdentity(config) {
  return objectSha256(comparableEnvironmentSettings(config));
}

export function requireEnvironmentPairIdentity(binding, flags) {
  const environment = flags.includes('--environment-identity');
  const configuration = flags.includes('--environment-config-identity');
  if (environment !== configuration) throw new Error('environment pair requires both environment/config identities');
  if (environment && (binding?.identitySha256 !== flags[flags.indexOf('--environment-identity') + 1]
    || binding?.configSha256 !== flags[flags.indexOf('--environment-config-identity') + 1])) {
    throw new Error('environment binding before/after environment/config mismatch');
  }
}

export function isolatedEnvironmentIdentity(host, guest) {
  // Paths describe an invocation's locators, not a tool's content identity.
  const contents = (value) => {
    if (Array.isArray(value)) return value.map(contents);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'path').map(([key, entry]) => [key, contents(entry)]));
    return value;
  };
  const { files, ...observed } = guest;
  const { pid, id, hostname: containerHostname, startedAt, ...container } = host.container;
  return { host: host.host, vm: host.vm, container, guest: {
    ...contents(observed), fileContents: Object.values(files).sort(),
  } };
}
async function observeGuestIdentity(config, host) {
  if (platform() !== 'linux' || arch() !== 'arm64' || hostname() !== host.container.hostname
    || release() !== host.vm.kernel || cpus().length !== host.vm.logicalCpus
    || totalmem() !== host.vm.memoryBytes || host.vm.operatingSystem !== 'OrbStack') {
    throw new Error('isolated environment guest/host VM or selected container mismatch');
  }
  if (process.version !== 'v24.21.0' || host.vm.logicalCpus !== 12 || host.vm.memoryBytes !== 8392974336
    || release() !== '7.0.14-orbstack-00380-ga7e0a2dc9535'
    || host.container.imageId !== 'sha256:f240abbe0c9fadb08df3b4f8b409111f5fd87733dfade0c69d6dfd839682d56b'
    || host.container.imageReference !== 'fluo-verification:sha256-81a185cd17d652f2d9fe7dbbaad1647262d17094e49eac533e7de30d2b37293e'
    || !isDeepStrictEqual(host.container.allocation,
      { nanoCpus: 0, cpuQuota: 0, cpuPeriod: 0, cpuset: '', memory: 0, memorySwap: 0 })) {
    throw new Error('isolated environment differs from frozen Linux preparation allocation/runtime');
  }
  if (!config.nativeLifetime?.enabled || !isAbsolute(config.nativeLifetime.python ?? '')) {
    throw new Error('isolated representative requires explicit nativeLifetime enabled and absolute Python');
  }
  const require = createRequire(import.meta.url);
  const files = {};
  async function fileIdentity(path) {
    const actual = await realpath(path);
    files[actual] = sha256(await readFile(actual));
    return { path: actual, sha256: files[actual] };
  }
  const node = await fileIdentity('/proc/self/exe');
  const { stdout: pnpmPath } = await execute('sh', ['-c', 'command -v pnpm']);
  const pnpm = { ...await fileIdentity(pnpmPath.trim()), version: (await execute('pnpm', ['--version'])).stdout.trim() };
  const sdk = {};
  const sdkPaths = {
    '@playwright/test': require.resolve('@playwright/test/package.json'),
    typescript: require.resolve('typescript/package.json'),
  };
  sdkPaths.playwright = createRequire(sdkPaths['@playwright/test']).resolve('playwright/package.json');
  sdkPaths['playwright-core'] = createRequire(sdkPaths.playwright).resolve('playwright-core/package.json');
  for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'typescript']) {
    const path = sdkPaths[name];
    sdk[name] = { ...await fileIdentity(path), version: JSON.parse(await readFile(path, 'utf8')).version };
  }
  // These are the actual shipped SDK implementations used by this collector.
  for (const path of ['index.mjs', 'lib/coreBundle.js', 'lib/bootstrap.js',
    'lib/serverRegistry.js', 'lib/utilsBundle.js', 'browsers.json']) {
    await fileIdentity(resolve(dirname(sdkPaths['playwright-core']), path));
  }
  const { chromium } = await import('@playwright/test');
  const server = await chromium.launchServer({ headless: true });
  let browser;
  let browserIdentity;
  try {
    browser = await chromium.connect(server.wsEndpoint());
    browserIdentity = { ...await fileIdentity(`/proc/${server.process().pid}/exe`), version: browser.version() };
  } finally { await browser?.close(); await server.close(); }
  const native = await import('./native-lifetime.mjs');
  if (browserIdentity.sha256 !== native.NATIVE_LIFETIME_IDENTITY.binarySha256
    || browserIdentity.version !== native.NATIVE_LIFETIME_IDENTITY.browserVersion) {
    throw new Error('isolated environment browser identity mismatch');
  }
  const python = await fileIdentity(config.nativeLifetime.python);
  const { stdout: runtime } = await execute(config.nativeLifetime.python, ['-c',
    'import sys,platform,hashlib,json,pathlib,frida; p=pathlib.Path(frida.__file__).parent; print(json.dumps({"pythonVersion":platform.python_version(),"pythonSha256":hashlib.sha256(pathlib.Path(sys.executable).resolve().read_bytes()).hexdigest(),"fridaVersion":frida.__version__,"fridaFiles":{n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ["__init__.py","aio.py","_frida.abi3.so"]},"files":{str(p/n):hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ["__init__.py","aio.py","_frida.abi3.so"]}}))']);
  const external = JSON.parse(runtime);
  const { files: externalFiles, ...externalIdentity } = external;
  if (!isDeepStrictEqual(externalIdentity, native.NATIVE_LIFETIME_RUNTIME)) {
    throw new Error('isolated environment external Python/Frida identity mismatch');
  }
  Object.assign(files, externalFiles);
  const collector = {};
  for (const name of ['measure.mjs', 'measure-browser.mjs', 'run-gate.mjs', 'native-terminal.mjs',
    'native-lifetime.mjs', 'native-lifetime-agent.js', 'native-lifetime-host.py']) {
    collector[name] = await fileIdentity(new URL(name, import.meta.url));
  }
  const suite = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const locks = {};
  for (const app of ['.', ...FRAMEWORKS.map((name) => `apps/${name}`)]) {
    locks[app] = await fileIdentity(resolve(suite, app, 'pnpm-lock.yaml'));
  }
  const allocation = {};
  for (const name of ['cpu.max', 'cpuset.cpus.effective', 'memory.max']) {
    allocation[name] = (await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim();
  }
  return { runtime: { version: process.version, v8: process.versions.v8, node },
    sdk, pnpm, browser: browserIdentity, python, external: externalIdentity,
    observer: { enabled: true, method: native.NATIVE_LIFETIME_METHOD, schema: native.NATIVE_LIFETIME_SCHEMA },
    collector, locks, files, allocation, platform: platform(), arch: arch(), kernel: release(),
    logicalCpus: cpus().length, availableParallelism: availableParallelism(), memoryBytes: totalmem() };
}

export async function captureIsolatedEnvironment(config, invocation, outputRoot) {
  const guest = await observeGuestIdentity(config, invocation.host);
  // Container instance/PID/start time are evidence, not pair-comparison identity.
  const identity = isolatedEnvironmentIdentity(invocation.host, guest);
  const record = { schemaVersion: 1, method: ENVIRONMENT_METHOD, invocation, identity,
    configuration: comparableEnvironmentSettings(config), configurationEvidence: environmentSettings(config),
    provenance: config.provenance,
    configSha256: environmentConfigIdentity(config), identitySha256: objectSha256(identity),
    guestEvidence: { pid: process.pid, hostname: hostname(), observedAt: new Date().toISOString(), guest } };
  await mkdir(outputRoot, { recursive: true });
  const path = resolve(outputRoot, `environment-${invocation.invocationId}.json`);
  const raw = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(path, raw, { flag: 'wx' });
  return { method: ENVIRONMENT_METHOD, path, sha256: sha256(raw), invocationId: invocation.invocationId,
    identitySha256: record.identitySha256, configSha256: record.configSha256 };
}

export async function verifyEnvironmentBinding(binding, outputRoot) {
  if (!binding || binding.method !== ENVIRONMENT_METHOD || !isAbsolute(binding.path ?? '')) {
    throw new Error('missing isolated environment binding');
  }
  const root = await realpath(outputRoot);
  const path = await realpath(binding.path);
  const location = relative(root, path);
  if (location.startsWith('..') || isAbsolute(location)) throw new Error('environment binding outside output root');
  const raw = await readFile(path);
  if (sha256(raw) !== binding.sha256) throw new Error('environment binding digest mismatch');
  const record = JSON.parse(raw);
  if (record.schemaVersion !== 1 || record.method !== binding.method
    || record.invocation?.invocationId !== binding.invocationId
    || record.identitySha256 !== binding.identitySha256 || objectSha256(record.identity) !== binding.identitySha256
    || record.configSha256 !== binding.configSha256 || objectSha256(record.configuration) !== binding.configSha256
    || environmentConfigIdentity({ ...record.configurationEvidence, provenance: record.provenance }) !== binding.configSha256
    || !record.guestEvidence?.pid
    || !record.guestEvidence?.guest?.files || !record.invocation?.host?.raw) {
    throw new Error('environment binding identity/invocation mismatch');
  }
  const { inspection, information } = record.invocation.host.raw;
  const [inspected] = JSON.parse(inspection);
  const info = JSON.parse(information);
  const host = record.invocation.host;
  if (inspected.Id !== host.container.id || inspected.Image !== record.identity.container.imageId
    || inspected.Config.Image !== record.identity.container.imageReference
    || !inspected.State.Running || inspected.State.Pid !== host.container.pid
    || inspected.Config.Hostname !== record.guestEvidence.hostname
    || info.KernelVersion !== record.identity.guest.kernel
    || info.NCPU !== record.identity.guest.logicalCpus || info.MemTotal !== record.identity.guest.memoryBytes
    || !isDeepStrictEqual(host.vm, record.identity.vm)
    || inspected.State.StartedAt !== host.container.startedAt
    || !isDeepStrictEqual(host.container.allocation, record.identity.container.allocation)
    || !isDeepStrictEqual(host.container.allocation, {
      nanoCpus: inspected.HostConfig.NanoCpus, cpuQuota: inspected.HostConfig.CpuQuota,
      cpuPeriod: inspected.HostConfig.CpuPeriod, cpuset: inspected.HostConfig.CpusetCpus,
      memory: inspected.HostConfig.Memory, memorySwap: inspected.HostConfig.MemorySwap,
    })) {
    throw new Error('environment binding raw host/guest observation mismatch');
  }
  const guest = record.guestEvidence.guest;
  if (!isDeepStrictEqual(record.identity, isolatedEnvironmentIdentity(host, guest))) {
    throw new Error('environment binding comparable identity/evidence mismatch');
  }
  const native = await import('./native-lifetime.mjs');
  if (guest.platform !== 'linux' || guest.arch !== 'arm64' || guest.runtime?.version !== 'v24.21.0'
    || guest.browser?.sha256 !== native.NATIVE_LIFETIME_IDENTITY.binarySha256
    || guest.browser?.version !== native.NATIVE_LIFETIME_IDENTITY.browserVersion
    || !isDeepStrictEqual(guest.external, native.NATIVE_LIFETIME_RUNTIME)
    || guest.observer?.method !== native.NATIVE_LIFETIME_METHOD || guest.observer?.schema !== native.NATIVE_LIFETIME_SCHEMA
    || guest.observer.enabled !== true || !record.configuration?.nativeLifetime?.enabled) {
    throw new Error('environment binding unsupported runtime/browser/observer');
  }
  const files = [guest.runtime.node, guest.browser, guest.python, guest.pnpm,
    ...['@playwright/test', 'playwright', 'playwright-core', 'typescript'].map((name) => guest.sdk?.[name]),
    ...['measure.mjs', 'measure-browser.mjs', 'run-gate.mjs', 'native-terminal.mjs',
      'native-lifetime.mjs', 'native-lifetime-agent.js', 'native-lifetime-host.py'].map((name) => guest.collector?.[name]),
    ...['.', ...FRAMEWORKS.map((name) => `apps/${name}`)].map((name) => guest.locks?.[name])];
  if (files.some((file) => !isAbsolute(file?.path ?? '') || !/^[a-f0-9]{64}$/u.test(file?.sha256 ?? '')
      || guest.files[file.path] !== file.sha256)
    || guest.python.sha256 !== native.NATIVE_LIFETIME_RUNTIME.pythonSha256
    || guest.pnpm.version !== '10.4.1'
    || ['@playwright/test', 'playwright', 'playwright-core'].some((name) => guest.sdk[name].version !== '1.61.1')
    || guest.sdk.typescript.version !== '6.0.2'
    || ['cpu.max', 'cpuset.cpus.effective', 'memory.max'].some((name) =>
      typeof guest.allocation?.[name] !== 'string' || !guest.allocation[name])) {
    throw new Error('environment binding incomplete executable/SDK/collector/allocation identity');
  }
  return record;
}

async function revalidateEnvironment(config, directory) {
  if (!config.isolatedRepresentative && !config.environmentBinding) return;
  const record = await verifyEnvironmentBinding(config.environmentBinding, directory);
  if (!config.isolatedRepresentative || config.environmentBinding.configSha256 !== environmentConfigIdentity(config)) {
    throw new Error('environment binding configuration mismatch');
  }
  const guest = record.guestEvidence.guest;
  if (platform() !== guest.platform || arch() !== guest.arch || release() !== guest.kernel
    || hostname() !== record.guestEvidence.hostname || process.version !== guest.runtime.version
    || cpus().length !== guest.logicalCpus || totalmem() !== guest.memoryBytes) {
    throw new Error('environment binding live guest mismatch');
  }
  for (const [path, hash] of Object.entries(guest.files)) {
    if (sha256(await readFile(path)) !== hash) throw new Error(`environment binding executable/source changed: ${path}`);
  }
  for (const [name, value] of Object.entries(guest.allocation)) {
    if ((await readFile(`/sys/fs/cgroup/${name}`, 'utf8')).trim() !== value) {
      throw new Error(`environment binding allocation changed: ${name}`);
    }
  }
}

export function sampleEnvironmentHeadroom() {
  return { monotonicMs: performance.now(), processCpu: process.cpuUsage(),
    cpus: cpus().map(({ times }) => times), memoryBytes: process.memoryUsage().rss };
}

export function summarizeEnvironmentHeadroom(before, after) {
  const elapsedMs = after.monotonicMs - before.monotonicMs;
  const total = (times) => Object.values(times).reduce((sum, time) => sum + time, 0);
  const ticks = after.cpus.reduce((sum, times, index) => sum + total(times) - total(before.cpus[index]), 0);
  const idle = after.cpus.reduce((sum, times, index) => sum + times.idle - before.cpus[index].idle, 0);
  return { before, after, elapsedMs,
    generatorCpuPercent: elapsedMs > 0 ? ((after.processCpu.user + after.processCpu.system
      - before.processCpu.user - before.processCpu.system) / (elapsedMs * 10)) : null,
    ambientBusyPercent: ticks > 0 ? (ticks - idle) * 100 / ticks : null,
    vmIdleCpuEquivalent: ticks > 0 ? idle * after.cpus.length / ticks : null,
    capacity: 'shared VM observation, not a dedicated reservation or acceptance budget' };
}

export const FRAMEWORKS = ['fluo', 'next', 'react-router', 'tanstack-start'];
export const PROFILES = Object.freeze({
  desktop: Object.freeze({ cpuSlowdown: 1, latencyMs: 20, downloadBytesPerSecond: 1_250_000,
    uploadBytesPerSecond: 1_250_000, viewport: { width: 1440, height: 900 } }),
  tablet: Object.freeze({ cpuSlowdown: 4, latencyMs: 150, downloadBytesPerSecond: 200_000,
    uploadBytesPerSecond: 93_750, viewport: { width: 820, height: 1180 } }),
});
export const METRICS = [
  'coldTtfbMs', 'warmTtfbMs', 'shellArrivalMs', 'lcpMs', 'hydrationMainThreadMs',
  'interactionPendingP50Ms', 'interactionPendingP95Ms', 'interactionApprovedP50Ms',
  'interactionApprovedP95Ms', 'transferredJsBytes', 'compressedJsBytes',
  'transferredCssBytes', 'compressedCssBytes', 'requestCount',
  'throughputRequestsPerSecond', 'errorRate', 'cpuPercent', 'rssBytes',
  'devColdReadyMs', 'devReactEditVisibleMs', 'devCssEditVisibleMs',
  'devServerEditVisibleMs',
];

export function planMeasurements(config) {
  const device = config.profile?.split('-')[0];
  if (!Object.hasOwn(PROFILES, device) || config.profile !== `${device}-${config.mode}`) throw new RangeError(`unknown profile: ${config.profile}`);
  if (!['native', 'matched-cache'].includes(config.mode)) throw new RangeError(`unknown mode: ${config.mode}`);
  for (const [label, count] of [['warmupRuns', config.warmupRuns], ['measurementRuns', config.measurementRuns]]) {
    if (!Number.isSafeInteger(count) || count < (label === 'measurementRuns' ? 1 : 0)) throw new RangeError(`invalid ${label}`);
  }
  if (FRAMEWORKS.some((framework) => !config.apps?.[framework])) throw new RangeError('all four framework app URLs are required');
  return Array.from({ length: config.warmupRuns + config.measurementRuns }, (_, cycle) =>
    FRAMEWORKS.map((_, slot) => ({
      profile: config.profile, mode: config.mode, framework: FRAMEWORKS[(cycle + slot) % FRAMEWORKS.length],
      device,
      runId: `${config.profile}-${config.mode}-cycle-${cycle + 1}-slot-${slot + 1}`,
      warmup: cycle < config.warmupRuns, url: config.apps[FRAMEWORKS[(cycle + slot) % FRAMEWORKS.length]],
    }))).flat();
}

export async function collectMeasurements(config, driver, directory) {
  const plan = planMeasurements(config);
  await mkdir(directory, { recursive: true });
  const isolated = config.isolatedRepresentative || config.environmentBinding;
  const binding = isolated ? { isolatedRepresentative: true, environmentBinding: config.environmentBinding } : {};
  const provenance = isolated ? { ...config.provenance, ...binding } : config.provenance;
  await revalidateEnvironment(config, dirname(directory));
  const runs = [];
  const warmups = [];
  for (const item of plan) {
    console.log(`MEASUREMENT_STAGE=${item.runId}/${item.framework}/check`);
    const correctness = await driver.check(item, config);
    console.log(`MEASUREMENT_STAGE=${item.runId}/${item.framework}/${correctness.pass ? 'measure' : 'correctness-failed'}`);
    await revalidateEnvironment(config, dirname(directory));
    const observation = correctness.pass
      ? await driver.measure({ ...item, nativeTraceDirectory: resolve(directory) }, config)
      : { metrics: {}, unavailable: {} };
    if (isolated && correctness.pass) {
      const headroom = observation.artifacts?.environmentHeadroom
        ?? observation.timings?.['cold-ready']?.environmentHeadroom;
      if (!headroom || !Number.isFinite(headroom.elapsedMs) || headroom.elapsedMs <= 0
        || !Number.isFinite(headroom.generatorCpuPercent) || !Number.isFinite(headroom.ambientBusyPercent)) {
        throw new Error('isolated environment binding headroom observation unavailable');
      }
    }
    await revalidateEnvironment(config, dirname(directory));
    const metrics = observation.metrics ?? {};
    for (const [name, value] of Object.entries(metrics)) {
      if (!METRICS.includes(name) || typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`invalid measurement: ${name}`);
      }
    }
    const unavailable = Object.fromEntries(METRICS.filter((name) => !Object.hasOwn(metrics, name))
      .map((name) => [name, observation.unavailable?.[name] ?? (name.startsWith('dev') ? 'not measured in production-browser mode' : 'not observed')]));
    const trace = resolve(directory, `${item.runId}-${item.framework}.json`);
    await writeFile(trace, `${JSON.stringify({
      schemaVersion: 1, ...item, ...binding, provenance, profileSettings: PROFILES[item.device],
      environment: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model,
        cpuCores: cpus().length, memoryBytes: totalmem(), runtimeVersion: process.version,
        browserVersion: driver.browserVersion ?? null },
      correctness, qualityFailures: observation.qualityFailures ?? [], metrics, unavailable,
      requests: observation.requests ?? [], timings: observation.timings ?? {},
      artifacts: observation.artifacts ?? {},
    }, null, 2)}\n`);
    const run = {
      profile: item.profile, mode: item.mode, framework: item.framework, runId: item.runId,
      trace, warmupRuns: config.warmupRuns, ...binding,
      correctness: !correctness.pass ? 'fail' : observation.qualityFailures?.length ? 'inconclusive' : 'pass',
      metrics,
    };
    (item.warmup ? warmups : runs).push(run);
    console.log(`MEASUREMENT_TRACE_COMPLETE=${trace}`);
  }
  return { schemaVersion: 1, provenance, ...binding, profile: config.profile, mode: config.mode, warmups, runs };
}

export async function collectDevMeasurements(config, driver, directory) {
  const steps = {
    'cold-ready': 'devColdReadyMs', 'react-edit': 'devReactEditVisibleMs',
    'css-edit': 'devCssEditVisibleMs', 'server-edit': 'devServerEditVisibleMs',
  };
  return collectMeasurements(config, {
    browserVersion: driver.browserVersion,
    check: (item) => driver.check(item, config),
    async measure(item) {
      try {
        const metrics = {};
        const timings = {};
        for (const [kind, metric] of Object.entries(steps)) {
          if (kind !== 'cold-ready' && driver.restartDev) {
            const readiness = await driver.restartDev(item, config);
            if (!readiness.pass) throw new Error(`${item.framework} ${kind} dev startup failed: ${JSON.stringify(readiness.steps)}`);
            timings[`${kind}-ready`] = readiness;
          }
          const observation = await driver.measureDev(item, config, kind);
          if (!observation?.event || !Number.isFinite(observation.durationMs) || observation.durationMs < 0) {
            throw new RangeError(`invalid ${kind} observation`);
          }
          metrics[metric] = observation.durationMs;
          timings[kind] = observation;
        }
        return { metrics, timings, unavailable: Object.fromEntries(METRICS.filter((name) => !name.startsWith('dev'))
          .map((name) => [name, 'not measured in development mode'])) };
      } finally {
        await driver.closeDev?.(item);
      }
    },
  }, directory);
}

export async function mergeEvidence(production, development, directory) {
  const isolated = production.isolatedRepresentative || development.isolatedRepresentative
    || production.environmentBinding || development.environmentBinding;
  if (isolated && (!production.isolatedRepresentative || !development.isolatedRepresentative
    || !production.environmentBinding?.identitySha256
    || production.environmentBinding.identitySha256 !== development.environmentBinding?.identitySha256)) {
    throw new Error('environment binding production/development mismatch');
  }
  if (isolated) {
    await verifyMeasurementEnvironment(production, dirname(directory));
    await verifyMeasurementEnvironment(development, dirname(directory));
  }
  await mkdir(directory, { recursive: true });
  const devRuns = new Map(development.runs.map((run) => [`${run.runId}:${run.framework}`, run]));
  const runs = [];
  for (const run of production.runs) {
    const dev = devRuns.get(`${run.runId}:${run.framework}`);
    if (!dev) throw new Error(`missing development evidence: ${run.runId}/${run.framework}`);
    const trace = resolve(directory, `${run.runId}-${run.framework}.json`);
    await writeFile(trace, `${JSON.stringify({
      schemaVersion: 1, sourceTraces: [run.trace, dev.trace],
      ...(isolated ? { isolatedRepresentative: true, environmentBinding: production.environmentBinding,
        sourceEnvironmentBindings: [run.environmentBinding, dev.environmentBinding] } : {}),
      correctness: { production: run.correctness, development: dev.correctness },
    }, null, 2)}\n`);
    runs.push({ ...run, trace, correctness: run.correctness === 'fail' || dev.correctness === 'fail'
      ? 'fail' : run.correctness === 'inconclusive' || dev.correctness === 'inconclusive' ? 'inconclusive' : 'pass',
      metrics: { ...run.metrics, ...dev.metrics } });
  }
  return { ...production, runs, developmentWarmups: development.warmups,
    ...(isolated ? { developmentEnvironmentBinding: development.environmentBinding } : {}) };
}

export async function verifyMeasurementEnvironment(receipt, outputRoot) {
  if (!receipt.isolatedRepresentative && !receipt.environmentBinding) return;
  if (!receipt.isolatedRepresentative || !isDeepStrictEqual(receipt.provenance?.environmentBinding, receipt.environmentBinding)) {
    throw new Error('environment binding aggregate provenance mismatch');
  }
  await verifyEnvironmentBinding(receipt.environmentBinding, outputRoot);
  for (const run of [...receipt.runs, ...(receipt.warmups ?? []), ...(receipt.developmentWarmups ?? [])]) {
    const expected = (receipt.developmentWarmups ?? []).includes(run)
      ? receipt.developmentEnvironmentBinding : receipt.environmentBinding;
    if (!run.isolatedRepresentative || !isDeepStrictEqual(run.environmentBinding, expected)) {
      throw new Error('environment binding sample/aggregate mismatch');
    }
  }
}

export async function verifyTraceFiles(runs, outputRoot) {
  const root = await realpath(outputRoot);
  async function verify(path, sources = false) {
    if (!path || !isAbsolute(path)) throw new Error(`invalid trace path: ${path}`);
    let actual;
    let record;
    try {
      actual = await realpath(path);
      const location = relative(root, actual);
      if (location.startsWith('..') || isAbsolute(location)) throw new Error('outside output root');
      record = JSON.parse(await readFile(actual, 'utf8'));
    } catch (error) {
      throw new Error(`invalid trace ${path}: ${error}`);
    }
    if (record.schemaVersion !== 1) throw new Error(`incomplete trace ${path}: schemaVersion`);
    const isolated = record.isolatedRepresentative || record.environmentBinding || record.provenance?.isolatedRepresentative;
    if (isolated) {
      if (!record.isolatedRepresentative) throw new Error('environment binding trace mode missing');
      const environment = await verifyEnvironmentBinding(record.environmentBinding, root);
      if (sources && !isDeepStrictEqual(record.provenance?.environmentBinding, record.environmentBinding)) {
        throw new Error('environment binding trace provenance mismatch');
      }
      if (sources && (record.profile !== environment.configuration.profile || record.mode !== environment.configuration.mode
        || record.url !== environment.configuration.apps?.[record.framework]
        || record.environment?.browserVersion !== environment.identity.guest.browser.version)) {
        throw new Error('environment binding trace configuration/browser mismatch');
      }
      if (sources && record.correctness?.pass) {
        const headrooms = record.timings?.['cold-ready']
          ? ['cold-ready', 'react-edit', 'css-edit', 'server-edit'].map((kind) => record.timings[kind]?.environmentHeadroom)
          : [record.artifacts?.environmentHeadroom];
        for (const sample of headrooms) {
          if (!sample?.before || !sample.after || !(sample.elapsedMs > 0)
            || !isDeepStrictEqual(sample, summarizeEnvironmentHeadroom(sample.before, sample.after))
            || !Number.isFinite(sample.generatorCpuPercent) || !Number.isFinite(sample.ambientBusyPercent)) {
            throw new Error('environment binding headroom sample missing/mismatched');
          }
        }
      }
    }
    if (sources) {
      if (!record.provenance || !record.environment || !record.correctness || !record.metrics || !record.unavailable
        || !record.profileSettings || !Array.isArray(record.requests)) {
        throw new Error(`incomplete raw trace ${path}`);
      }
      const native = record.artifacts?.nativeTerminalObserver;
      let passiveCdpLedger;
      if (native) {
        for (const [file, sha256] of [[native.rawTrace, native.sha256], [native.cdpTrace, native.cdpSha256]]) {
          const contained = await realpath(file);
          const location = relative(root, contained);
          if (location.startsWith('..') || isAbsolute(location)) throw new Error(`native trace outside output root: ${file}`);
          const raw = await readFile(contained);
          if (createHash('sha256').update(raw).digest('hex') !== sha256) throw new Error(`native trace digest mismatch: ${file}`);
          const parsed = JSON.parse(raw);
          if (file === native.rawTrace ? !parsed.constants || !parsed.events?.length : !Array.isArray(parsed.ledger)) {
            throw new Error(`incomplete native trace: ${file}`);
          }
          if (file === native.cdpTrace) passiveCdpLedger = parsed.ledger;
        }
      }
      const lifetime = record.artifacts?.nativeLifetimeObserver;
      if (lifetime) {
        if (native && native.captureTimestamp !== lifetime.captureTimestamp) {
          throw new Error(`native lifetime capture boundary mismatch: ${path}`);
        }
        const { verifyNativeLifetimeEvidence } = await import('./native-lifetime.mjs');
        const unavailable = await verifyNativeLifetimeEvidence(lifetime, record.requests, root, {
          runId: record.runId, framework: record.framework, profile: record.profile, mode: record.mode,
        }, passiveCdpLedger);
        if (unavailable.some((reason) => !record.qualityFailures?.includes(reason))) {
          throw new Error(`native lifetime inconclusive reasons missing: ${path}`);
        }
      } else if (record.requests.some((request) => request.nativeLifetime)) {
        throw new Error(`native lifetime observer provenance missing: ${path}`);
      }
    } else if (Array.isArray(record.sourceTraces)) {
      if (record.sourceTraces.length !== 2 || !record.correctness) throw new Error(`incomplete combined trace ${path}`);
      for (const [index, source] of record.sourceTraces.entries()) {
        if (isolated) {
          const raw = JSON.parse(await readFile(source, 'utf8'));
          if (!raw.isolatedRepresentative || !isDeepStrictEqual(raw.environmentBinding, record.sourceEnvironmentBindings?.[index])
            || raw.environmentBinding?.identitySha256 !== record.environmentBinding.identitySha256) {
            throw new Error('environment binding combined source mismatch');
          }
        }
        await verify(source, true);
      }
    } else {
      await verify(path, true);
    }
  }
  for (const run of runs) {
    if (run.isolatedRepresentative || run.environmentBinding) {
      const record = JSON.parse(await readFile(run.trace, 'utf8'));
      if (!record.isolatedRepresentative || !isDeepStrictEqual(record.environmentBinding, run.environmentBinding)) {
        throw new Error('environment binding sample/trace mismatch');
      }
    }
    await verify(run.trace);
  }
}

async function main() {
  const flags = process.argv.slice(2);
  if (await launchIsolatedInvocation(fileURLToPath(import.meta.url), flags)) return;
  const invocation = await readIsolatedInvocation(flags);
  const configPath = flags[flags.indexOf('--config') + 1];
  const outputPath = flags[flags.indexOf('--output') + 1];
  if (!configPath || !outputPath || !flags.includes('--config') || !flags.includes('--output')) {
    throw new Error('usage: node src/measure.mjs --config <JSON> --output <JSON>');
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const output = resolve(outputPath);
  if (invocation) {
    config.environmentBinding = await captureIsolatedEnvironment(config, invocation, dirname(output));
    config.isolatedRepresentative = true;
  } else if (config.isolatedRepresentative || config.environmentBinding) {
    throw new Error('isolated representative requires live host launcher');
  }
  requireEnvironmentPairIdentity(config.environmentBinding, flags);
  const { createBrowserDriver } = await import('./measure-browser.mjs');
  const devOnly = flags.includes('--dev');
  const driver = await createBrowserDriver(config, { devMode: devOnly });
  let result;
  try {
    result = devOnly
      ? await collectDevMeasurements(config, driver, join(dirname(output), 'dev-traces'))
      : await collectMeasurements(config, driver, join(dirname(output), 'traces'));
  } finally { await driver.close(); }
  if (!devOnly && config.dev) {
    const devDriver = await createBrowserDriver(config, { devMode: true });
    try {
      const development = await collectDevMeasurements(config, devDriver, join(dirname(output), 'dev-traces'));
      result = await mergeEvidence(result, development, join(dirname(output), 'combined-traces'));
    } finally { await devDriver.close(); }
  }
  await verifyTraceFiles([...result.runs, ...result.warmups, ...(result.developmentWarmups ?? [])], dirname(output));
  await verifyMeasurementEnvironment(result, dirname(output));
  const baselinePath = flags[flags.indexOf('--baseline') + 1];
  if (flags.includes('--gate') && !baselinePath) throw new Error('--gate requires --baseline <JSON>');
  if (flags.includes('--gate')) {
    const { evaluatePerformance } = await import('./evaluate.ts');
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    result = { ...result, evaluation: evaluatePerformance(baseline, result.runs) };
    if (result.evaluation.verdict !== 'pass') process.exitCode = 1;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  if (result.runs.some((run) => run.correctness !== 'pass')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
