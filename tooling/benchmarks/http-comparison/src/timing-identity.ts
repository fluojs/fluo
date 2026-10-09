import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readdir, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { linuxListeners } from './linux-listeners';
import { object, sha256 } from './profile-report';
import { sourceSnapshot, WORKSPACE_ROOT } from './provenance';
import { processTreeSample } from './resources';
import type { AppShape } from './scenarios';
import { buildCommands, nextFixtureDirectory, type TargetConfig, WDIR } from './targets';
import { workerdConfig, workerdExecutable, workerdProcessProof, workerdSubject, writeWorkerdConfig } from './workerd';

const execute = promisify(execFile);
const prefix = 'BENCH_TIMING_IDENTITY ';

export class TimingIdentityFailure extends Error {
  constructor(message: string, readonly evidence: unknown) {
    super(message);
    this.name = 'TimingIdentityFailure';
  }
}

async function buildFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !['cache', 'node_modules'].includes(entry.name)) files.push(...await buildFiles(path));
    else if (entry.isFile() && /\.(?:js|mjs|cjs|json)$/.test(entry.name)) files.push(path);
  }
  return files;
}

export async function prepareTimingIdentity(target: TargetConfig, appShape: AppShape = 'read-search-local') {
  const worker = target.platform === 'workers' ? workerdConfig(target, appShape, process.env.BENCH_CONFIGURATION ?? 'default') : undefined;
  if (worker) writeWorkerdConfig(worker);
  const script = worker?.bundle ?? (target.platform === 'nextjs' ? target.args[0]
    : target.args.find((arg) => /\.(?:js|mjs|cjs)$/.test(arg)));
  if (!script) throw new TimingIdentityFailure('Missing serving entry', { target });
  const entry = isAbsolute(script) ? script : join(WDIR, script);
  const directory = target.platform === 'nextjs'
    ? join(WDIR, nextFixtureDirectory(target), '.next') : dirname(entry);
  const source = await sourceSnapshot(WDIR);
  const files = [...new Set([entry, join(WDIR, 'src/timing-bootstrap.mjs'), join(WORKSPACE_ROOT, 'pnpm-lock.yaml'), ...Object.keys(source).map((path) => join(WDIR, path)), ...await buildFiles(directory),
    ...(target.platform === 'nextjs' ? [join(directory, 'BUILD_ID'), join(directory, 'trace')] : []),
    ...(worker ? [worker.path, worker.metafile, workerdExecutable()] : [])])].sort();
  const artifacts = Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha256(await readFile(file))])));
  const sourceIdentity = {
    gitHead: (await execute('git', ['rev-parse', 'HEAD'], { cwd: WORKSPACE_ROOT })).stdout.trim(),
    gitStatus: (await execute('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: WORKSPACE_ROOT })).stdout,
    benchmarkSourceSha256: sha256(JSON.stringify(source)),
    lockfiles: Object.fromEntries(await Promise.all([WORKSPACE_ROOT, WDIR].map(async (root) => [join(root, 'pnpm-lock.yaml'), sha256(await readFile(join(root, 'pnpm-lock.yaml')))]))),
  };
  return {
    status: 'prepared' as const, nonce: randomUUID(), target: target.name, entry, worker,
    artifacts, artifactsSha256: sha256(JSON.stringify(artifacts)), source: sourceIdentity,
    build: { commands: [...buildCommands], scope: 'serving entry and target output tree; linked dependency provenance remains in environment' },
    env: {
      BENCH_TIMING_ENTRY: entry, BENCH_TIMING_FILES: JSON.stringify(files),
      ...(target.platform === 'deno' ? { BENCH_TIMING_IMPORT_ENTRY: '1' } : {}),
    },
  };
}

export type TimingPreparation = Awaited<ReturnType<typeof prepareTimingIdentity>>;

export async function authenticateTimingIdentity(
  prepared: Extract<TimingPreparation, { status: 'prepared' }>,
  stdout: string,
  launcherPid: number,
  port: number,
  serverHost = process.env.BENCH_SERVER_HOST ?? '127.0.0.1',
) {
  const lines = stdout.split('\n').filter((line) => line.startsWith(prefix));
  if (!prepared.worker && lines.length !== 1) throw new TimingIdentityFailure('Missing or duplicate serving identity', { stdout });
  let identity: Record<string, unknown>;
  if (prepared.worker) {
    const subject = workerdSubject(launcherPid);
    const proof = await workerdProcessProof(launcherPid);
    const executable = workerdExecutable();
    if (subject.launch.args[1] !== prepared.worker.path
      || subject.messages.length !== 1 || subject.messages[0].event !== 'listen'
      || subject.messages[0].socket !== 'http' || subject.messages[0].port !== port) {
      throw new TimingIdentityFailure('Direct workerd config/control identity mismatch', { proof, expected: prepared });
    }
    // This is parent-side native-process evidence, never a collector or isolate attestation.
    identity = {
      nonce: prepared.nonce, target: prepared.target, pid: launcherPid, entry: prepared.entry,
      artifacts: prepared.artifacts, artifactsSha256: prepared.artifactsSha256,
      executable, executableSha256: sha256(await readFile(executable)),
      runtime: proof.runtime,
      inspectorUrl: null, instrumentationFlags: [], opaqueIsolateId: 'not-observed',
      application: { service: 'benchmark', configuredApplicationServices: 1, config: prepared.worker.path, bundle: prepared.worker.bundle },
      nativeProcessEvidence: proof,
    };
  } else identity = object(JSON.parse(lines[0].slice(prefix.length)));
  const tree = await processTreeSample(launcherPid);
  let listenerStdout: string;
  let pids: number[];
  if (process.platform === 'linux') {
    const listeners = await linuxListeners(launcherPid);
    const sockets = listeners.sockets.filter((socket) => socket.port === port);
    pids = sockets.length > 0 && sockets.every((socket) => socket.owned) ? [launcherPid] : [];
    listenerStdout = JSON.stringify(listeners);
  } else {
    listenerStdout = (await execute('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])).stdout;
    pids = [...new Set(listenerStdout.trim().split(/\s+/).map(Number))];
  }
  const runtime = object(identity.runtime);
  const addresses = await lookup(serverHost, { all: true });
  const localAddresses = new Set(Object.values(networkInterfaces()).flatMap((entries) => entries?.map((entry) => entry.address) ?? []));
  if (addresses.length === 0 || addresses.some((entry) => !localAddresses.has(entry.address))) {
    throw new TimingIdentityFailure('Measured endpoint is not on the authenticated local serving host', { serverHost, addresses, listener: listenerStdout });
  }
  const nodeFamily = ['fastify', 'express', 'nodejs', 'nextjs'].some((platform) => prepared.target.endsWith(`-${platform}`))
    || prepared.target.endsWith('-nextjs-pages');
  if (identity.nonce !== prepared.nonce || identity.target !== prepared.target
    || identity.pid !== launcherPid || pids.length !== 1 || pids[0] !== identity.pid
    || !tree.processes.some((item) => item.pid === identity.pid)
    || identity.entry !== prepared.entry || identity.artifactsSha256 !== prepared.artifactsSha256
    || sha256(JSON.stringify(object(identity.artifacts))) !== prepared.artifactsSha256
    || (nodeFamily && (typeof runtime.node !== 'string' || 'bun' in runtime || 'deno' in runtime))
    || (prepared.target.endsWith('-bun') && typeof runtime.bun !== 'string')
    || (prepared.target.endsWith('-deno') && typeof runtime.deno !== 'string')
    || typeof identity.executable !== 'string' || typeof identity.executableSha256 !== 'string'
    || identity.executableSha256 !== sha256(await readFile(identity.executable))
    || identity.inspectorUrl !== null || !Array.isArray(identity.instrumentationFlags) || identity.instrumentationFlags.length !== 0) {
    throw new TimingIdentityFailure('Serving runtime/source/build/listener identity mismatch or instrumentation enabled', { identity, expected: prepared, tree, listener: listenerStdout });
  }
  // Re-read after startup: loading a different or modified build is not accepted.
  for (const [path, hash] of Object.entries(prepared.artifacts)) {
    if (sha256(await readFile(path)) !== hash) throw new TimingIdentityFailure('Serving build changed after startup', { path, hash });
  }
  return {
    ...identity, status: 'authenticated' as const, instrumentation: 'none' as const,
    pid: launcherPid, launcherPid, runtime, source: prepared.source, build: prepared.build,
    opaqueIsolateId: prepared.worker ? 'not-observed' as const : null,
    linkage: {
      method: prepared.worker ? 'native-executable-config-bundle-control-fd-and-local-endpoint-OS-listening-PID' : 'startup-nonce-and-local-endpoint-OS-listening-PID',
      serverHost, addresses, listenerStdout, tree,
    },
    rawStartupIdentity: prepared.worker ? stdout : lines[0],
    ...(prepared.worker ? { evidenceOrigin: 'parent-side-native-process-config-bundle-and-OS-listener', resourceBoundary: 'direct-workerd-single-application-v1' } : {}),
    limitations: [prepared.worker
      ? 'Local launch-to-ready includes parent-side config/artifact hashing. Native process and one configured application service are authenticated; opaque isolate ID is not observed. No request-path instrumentation.'
      : 'Startup attestation hashing is included in process-to-ready; it installs no request-path instrumentation. Build hashes identify files, not exclusive framework CPU costs.'],
  };
}
