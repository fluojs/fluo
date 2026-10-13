import { execFile } from 'node:child_process';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, relative } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import { object, sha256 } from '../profile-report.js';
import { environmentSummary, sourceSnapshot, WORKSPACE_ROOT } from '../provenance.js';
import { WDIR } from '../targets.js';
import { FIXTURES } from './fixtures.js';
import { POLICY } from './gates.js';

const execute = promisify(execFile);

function text(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim() || /^(unknown|pending|not-observed)$/i.test(value)) {
    throw new TypeError(`Missing real identity: ${key}`);
  }
  return value;
}
function hash(record: Record<string, unknown>, key: string) {
  const value = text(record, key);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`Invalid SHA256: ${key}`);
  return value;
}
function machine(value: unknown) {
  const record = object(value);
  return {
    hostname: text(record, 'hostname'),
    nodeVersion: text(record, 'nodeVersion'),
    nodeExecutable: text(record, 'nodeExecutable'),
    nodeExecutableSha256: hash(record, 'nodeExecutableSha256'),
    kernel: text(record, 'kernel'),
    wsl: text(record, 'wsl'),
    cpu: text(record, 'cpu'),
    quota: text(record, 'quota'),
    affinity: text(record, 'affinity'),
    power: text(record, 'power'),
    backgroundLoad: text(record, 'backgroundLoad'),
    identityEvidenceSha256: hash(record, 'identityEvidenceSha256'),
  };
}
export function parseHosts(value: unknown) {
  const record = object(value);
  const server = machine(record.server);
  const generator = machine(record.generator);
  const address = new URL(text(record, 'serverOrigin'));
  if (address.protocol !== 'http:' || address.username || address.password || address.pathname !== '/'
    || address.search || address.hash) throw new TypeError('Direct HTTP serverOrigin is required');
  if (record.transport !== 'direct-http') throw new TypeError('Tunnels are excluded');
  if (server.hostname === generator.hostname) throw new TypeError('Independent generator host is required');
  if (![server.nodeVersion, generator.nodeVersion].every((version) => /^v(?:24|25|26)\.\d+\.\d+$/.test(version))) {
    throw new TypeError('Exact supported Node versions are required for both hosts');
  }
  return {
    server, generator, serverOrigin: address.origin,
    bindHost: text(record, 'bindHost'),
    lease: text(record, 'lease'),
    transport: 'direct-http' as const,
    generatorLockfileSha256: hash(record, 'generatorLockfileSha256'),
    generatorEntrySha256: hash(record, 'generatorEntrySha256'),
    generatorSshTarget: text(record, 'generatorSshTarget'),
  };
}
export type Hosts = ReturnType<typeof parseHosts>;

async function artifacts(directory: string, output: Record<string, string>) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await artifacts(path, output);
    else if (entry.isFile()) output[relative(WORKSPACE_ROOT, path)] = sha256(await readFile(path));
  }
}

export async function localBinding() {
  const environment = await environmentSummary();
  const fixtureSource = await sourceSnapshot(join(WDIR, 'src/issue-3942'));
  const source: Record<string, string> = {};
  const tracked = (await execute('git', ['ls-files', ':(glob)packages/*/src/**',
    ':(glob)packages/*/package.json', 'tooling/babel', 'pnpm-lock.yaml'], { cwd: WORKSPACE_ROOT })).stdout;
  for (const path of tracked.trim().split('\n').filter(Boolean)) {
    source[path] = sha256(await readFile(join(WORKSPACE_ROOT, path)));
  }
  const builds: Record<string, string> = {};
  const pending = Object.keys(environment.dependencies).filter((name) => name.startsWith('@fluojs/'))
    .sort().map((name) => environment.dependencies[name].path);
  const seen = new Set<string>();
  for (const directory of pending) {
    if (seen.has(directory)) continue;
    seen.add(directory);
    await artifacts(join(directory, 'dist'), builds);
    const manifestPath = join(directory, 'package.json');
    const bytes = await readFile(manifestPath);
    builds[relative(WORKSPACE_ROOT, manifestPath)] = sha256(bytes);
    const dependencies = object(object(JSON.parse(bytes.toString())).dependencies ?? {});
    for (const name of Object.keys(dependencies).filter((name) => name.startsWith('@fluojs/')).sort()) {
      pending.push(await realpath(join(directory, 'node_modules', name)));
    }
  }
  await artifacts(join(WDIR, 'dist/issue-3942'), builds);
  return {
    sourceSha256: sha256(JSON.stringify(source)),
    source,
    buildSha256: sha256(JSON.stringify(builds)),
    builds,
    fixtureSha256: sha256(JSON.stringify({ fixtureSource, requests: FIXTURES.map((item) => item.scenario.requests) })),
    fixtureSource,
    benchmarkSourceSha256: environment.benchmarkSource.sha256,
    rootLockfileSha256: sha256(await readFile(join(WORKSPACE_ROOT, 'pnpm-lock.yaml'))),
    benchmarkLockfileSha256: sha256(await readFile(join(WDIR, 'pnpm-lock.yaml'))),
    expressVersion: environment.adapterExpress['@fluojs/platform-express'].version,
    nodeExecutableSha256: sha256(await readFile(process.execPath)),
    hostname: hostname(),
    environment,
  };
}
export type Binding = Awaited<ReturnType<typeof localBinding>>;

export function assertBinding(hosts: Hosts, binding: Binding) {
  if (hosts.server.hostname !== binding.hostname || hosts.server.nodeVersion !== process.version
    || hosts.server.nodeExecutable !== process.execPath
    || hosts.server.nodeExecutableSha256 !== binding.nodeExecutableSha256) {
    throw new TypeError('Declared server is not this observed serving host/runtime');
  }
}

export function assertFrozen(value: unknown, binding: Binding) {
  const record = object(value);
  if (!isDeepStrictEqual(record.policy, POLICY)) throw new TypeError('Frozen experiment policy drift');
  if (!isDeepStrictEqual(record.binding, {
    sourceSha256: binding.sourceSha256, buildSha256: binding.buildSha256,
    fixtureSha256: binding.fixtureSha256, benchmarkSourceSha256: binding.benchmarkSourceSha256,
    rootLockfileSha256: binding.rootLockfileSha256, benchmarkLockfileSha256: binding.benchmarkLockfileSha256,
    expressVersion: binding.expressVersion,
  })) throw new TypeError('Frozen source/build/fixture/dependency drift');
  const hosts = parseHosts(record.hosts);
  assertBinding(hosts, binding);
  return hosts;
}

export function frozenPlan(hosts: Hosts, binding: Binding) {
  assertBinding(hosts, binding);
  return {
    policy: POLICY, hosts,
    binding: {
      sourceSha256: binding.sourceSha256, buildSha256: binding.buildSha256,
      fixtureSha256: binding.fixtureSha256, benchmarkSourceSha256: binding.benchmarkSourceSha256,
      rootLockfileSha256: binding.rootLockfileSha256, benchmarkLockfileSha256: binding.benchmarkLockfileSha256,
      expressVersion: binding.expressVersion,
    },
    provenance: binding,
    status: 'AWAITING_CALIBRATION',
  };
}
