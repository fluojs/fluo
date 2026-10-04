import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { arch, availableParallelism, cpus, hostname, platform, release, totalmem } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';
import { captureMethodBinding, verifyMethodBinding, verifyMethodReceipt, verifyMethodTrace } from './fa-v2.mjs';

const execute = promisify(execFile);
const sha256 = (raw) => createHash('sha256').update(raw).digest('hex');
const objectSha256 = (value) => sha256(JSON.stringify(value));
const ENVIRONMENT_METHOD = 'isolated-linux-representative-v1';
const REACT_EDIT_SOURCES = {
  before: { head: '8a09eb8d216e555b97760a86539dea31e79c86a8',
    file: 'src/document.ts', reload: true, blob: 'd1cab92d356721fce862456de5b492f15a225f0c' },
  after: { head: 'f9f5ac6722957cbe2752b9959e657a46594c0a1b',
    file: 'src/catalog-destination.tsx', reload: false, blob: 'c5b7573e8da64237eecff459365e348b626285d9' },
};
const REACT_EDIT_PAIR_METHOD = 'source-bound-fluo-react-edit-pair-v1';

// The shared collector executes these helpers even when the product build/root
// differs. Server-only consumers opt into their additional entrypoint closure.
function collectorSources(entrypoints = ['measure.mjs', 'run-gate.mjs']) {
  if (!Array.isArray(entrypoints) || !entrypoints.length
    || entrypoints.some((name) => !['measure.mjs', 'run-gate.mjs', 'run-server-only.mjs'].includes(name))) {
    throw new Error('environment binding unsupported collector entrypoints');
  }
  return [...new Set(['measure.mjs', 'measure-browser.mjs', 'run-gate.mjs',
    'initial-readiness.mjs', 'process-group.mjs', 'gate.mjs', 'evaluate.ts', 'fluo-dev.mjs',
    'native-terminal.mjs', 'native-lifetime.mjs', 'native-lifetime-agent.js', 'native-lifetime-host.py',
    'fa-v2.mjs', 'server-cpu.mjs',
    ...(entrypoints.includes('run-server-only.mjs')
      ? ['run-server-only.mjs', 'server-measurement.mjs', 'socket-shell.mjs'] : [])])];
}

export async function captureCollectorSources(directory = dirname(fileURLToPath(import.meta.url)),
  entrypoints = ['measure.mjs', 'run-gate.mjs']) {
  return Object.fromEntries(await Promise.all(collectorSources(entrypoints).map(async (name) => {
    const path = await realpath(resolve(directory, name));
    return [name, { path, sha256: sha256(await readFile(path)) }];
  })));
}

function productProvenance(provenance) {
  if (!provenance) return provenance;
  const { isolatedRepresentative, environmentBinding, ...product } = provenance;
  return product;
}

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

// A Linux subreaper owns only this invocation's descendants, including servers
// that start new sessions. pidfds target real processes, not reusable PID names.
// SIGCHLD and control input drive teardown; deadlines only bound escalation.
const isolatedSupervisor = String.raw`
import ctypes,json,os,selectors,signal,subprocess,sys,time
if ctypes.CDLL(None, use_errno=True).prctl(36,1,0,0,0) != 0:
    raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER")
read_fd,write_fd=os.pipe2(os.O_NONBLOCK|os.O_CLOEXEC)
signal.set_wakeup_fd(write_fd)
for name in (signal.SIGCHLD,signal.SIGINT,signal.SIGTERM):
    signal.signal(name,lambda *_: None)
selector=selectors.DefaultSelector()
selector.register(read_fd,selectors.EVENT_READ,"signal")
selector.register(0,selectors.EVENT_READ,"control")
frame=json.loads(sys.stdin.buffer.raw.readline())
invocation=frame["invocation"]
child=subprocess.Popen(sys.argv[1:],stdin=subprocess.PIPE,start_new_session=True)
child.stdin.write(json.dumps(invocation).encode())
child.stdin.close()
start_ticks=open("/proc/%d/stat"%child.pid).read().rsplit(")",1)[1].split()[19]
print("ISOLATED_GUEST_READY "+invocation["invocationId"]+" pid="+str(child.pid)+" startTicks="+start_ticks,file=sys.stderr,flush=True)
os.set_blocking(0,False)
buffer=b""
status=None
interrupted=None
deadline=None
escalated=False

def signal_owned(sig):
    def owned(pid):
        while pid != os.getpid():
            try:
                pid=int(open("/proc/%d/stat"%pid).read().rsplit(")",1)[1].split()[1])
            except FileNotFoundError:
                return False
            if pid <= 1:
                return False
        return True
    def visit(parent):
        try:
            ids=open("/proc/%d/task/%d/children"%(parent,parent)).read().split()
        except FileNotFoundError:
            return
        for text in ids:
            pid=int(text)
            try:
                fd=os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            try:
                # Opening a pidfd and checking the parent afterwards closes the
                # PID-reuse race; adopted children remain below this subreaper.
                stat=open("/proc/%d/stat"%pid).read().rsplit(")",1)[1].split()
                if int(stat[1]) != parent or not owned(pid):
                    continue
                visit(pid)
                signal.pidfd_send_signal(fd,sig)
            except (FileNotFoundError,ProcessLookupError):
                pass
            finally:
                os.close(fd)
    visit(os.getpid())

def reap():
    global status
    while True:
        try:
            pid,result=os.waitpid(-1,os.WNOHANG)
        except ChildProcessError:
            return True
        if pid == 0:
            return False
        if pid == child.pid:
            status=os.waitstatus_to_exitcode(result)

def shutdown(sig):
    global deadline
    if deadline is None:
        deadline=time.monotonic()+5
    signal_owned(sig)

try:
    while True:
        empty=reap()
        if status is not None:
            shutdown(signal.SIGTERM if not escalated else signal.SIGKILL)
        if empty:
            break
        remaining=None if deadline is None else max(0,deadline-time.monotonic())
        events=selector.select(remaining)
        if not events and deadline is not None:
            if escalated:
                raise RuntimeError("owned guest descendants survived bounded SIGKILL/reap")
            escalated=True
            deadline=time.monotonic()+5
            signal_owned(signal.SIGKILL)
        for key,_ in events:
            if key.data == "signal":
                for number in os.read(read_fd,65536):
                    if number in (signal.SIGINT,signal.SIGTERM):
                        interrupted=number
                        shutdown(number)
            else:
                chunk=os.read(0,65536)
                if not chunk:
                    selector.unregister(0)
                    interrupted=signal.SIGTERM
                    shutdown(signal.SIGTERM)
                buffer+=chunk
                while b"\n" in buffer:
                    line,buffer=buffer.split(b"\n",1)
                    control=json.loads(line)
                    if control.get("signal") not in ("SIGINT","SIGTERM"):
                        raise ValueError("invalid isolated control signal")
                    interrupted=getattr(signal,control["signal"])
                    shutdown(interrupted)
finally:
    try:
        limit=time.monotonic()+5
        while not reap():
            signal_owned(signal.SIGKILL)
            remaining=limit-time.monotonic()
            if remaining <= 0:
                raise RuntimeError("owned guest descendants survived final reap")
            for key,_ in selector.select(remaining):
                if key.data == "signal":
                    os.read(read_fd,65536)
                else:
                    os.read(0,65536)
                    selector.unregister(0)
    finally:
        signal.set_wakeup_fd(-1)
        selector.close()
        os.close(read_fd)
        os.close(write_fd)
print("ISOLATED_GUEST_REAPED "+invocation["invocationId"]+" escalated="+str(escalated),file=sys.stderr,flush=True)
sys.exit(128+interrupted if interrupted else (status if status is not None and status >= 0 else 1))
`;

// stdin stays open as an invocation-specific control channel. The supervisor
// gives the actual guest a finite JSON stdin and acknowledges complete reaping.
export async function launchIsolatedInvocation(script, flags) {
  if (!flags.includes('--isolated-container')) return false;
  const index = flags.indexOf('--isolated-container');
  const container = flags[index + 1];
  if (!container || flags.includes('--isolated-guest')) throw new Error('invalid isolated container invocation');
  let host;
  let child;
  let interrupt;
  let timeout;
  let controlError;
  const forward = (signal) => {
    interrupt ??= signal;
    if (child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ signal: interrupt })}\n`);
    // The remote supervisor has two 5s reap deadlines. A disconnected client
    // is failure evidence, never a successful remote cleanup receipt.
    timeout ??= setTimeout(() => {
      controlError = new Error('isolated guest did not acknowledge bounded teardown');
      child?.kill('SIGKILL');
    }, 15_000);
  };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const boundedExecute = (command, args) => execute(command, args, { timeout: 10_000 });
  try {
    host = await observeIsolatedHost(container, boundedExecute);
    if (interrupt) { process.exitCode = interrupt === 'SIGINT' ? 130 : 143; return true; }
    const { stdout: node } = await boundedExecute('docker', ['exec', host.container.id, 'sh', '-c', 'command -v node']);
    if (interrupt) { process.exitCode = interrupt === 'SIGINT' ? 130 : 143; return true; }
    const invocation = { method: ENVIRONMENT_METHOD, invocationId: randomUUID(),
      observedAt: new Date().toISOString(), hostPid: process.pid, host };
    const args = flags.filter((_, position) => position !== index && position !== index + 1);
    child = spawn('docker', ['exec', '-i', host.container.id, 'python3', '-u', '-c',
      isolatedSupervisor, node.trim(), script, ...args, '--isolated-guest'],
    { stdio: ['pipe', 'inherit', 'pipe'] });
    let reaped = false;
    let output = '';
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      output += chunk;
      if (output.includes(`ISOLATED_GUEST_REAPED ${invocation.invocationId} `)) reaped = true;
      output = output.slice(-4096);
    });
    child.stdin.on('error', (error) => { controlError = error; });
    const completed = new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', (code, signal) => resolveExit({ code, signal }));
    });
    child.stdin.write(`${JSON.stringify({ invocation })}\n`);
    const result = await completed;
    if (controlError) throw controlError;
    if (!reaped) throw new Error('isolated guest exited without owned teardown/reap acknowledgement');
    if (result.signal || (interrupt && result.code !== 0 && result.code !== (interrupt === 'SIGINT' ? 130 : 143))) {
      throw new Error(`isolated guest teardown failed: code=${result.code} signal=${result.signal}`);
    }
    if (interrupt) process.exitCode = interrupt === 'SIGINT' ? 130 : 143;
    else if (result.signal || result.code !== 0) process.exitCode = result.code || 1;
  } finally {
    clearTimeout(timeout);
    child?.stdin.destroy();
    try {
      if (host) {
        const after = await observeIsolatedHost(host.container.id, boundedExecute);
        if (!isDeepStrictEqual({ vm: host.vm, container: host.container }, { vm: after.vm, container: after.container })) {
          throw new Error('isolated environment host allocation/container changed during invocation');
        }
      }
    } finally {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    }
  }
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

function requireReactEdit(configuration, role) {
  const edit = configuration.dev?.fluo?.edits?.['react-edit'];
  const source = REACT_EDIT_SOURCES[role];
  if (!isDeepStrictEqual(edit, { file: source.file, reload: source.reload,
    from: 'Editor login', to: 'Editor login changed', path: '/login', selector: 'h1',
    expectedText: 'Editor login changed' })) {
    throw new Error('React edit pair direction/stimulus mismatch');
  }
  return edit;
}

export async function captureReactEditSource(config, { pairSource = false } = {}) {
  if (!pairSource) return undefined;
  const edit = config.dev?.fluo?.edits?.['react-edit'];
  const role = Object.keys(REACT_EDIT_SOURCES).find((name) =>
    edit?.file === REACT_EDIT_SOURCES[name].file && edit.reload === REACT_EDIT_SOURCES[name].reload);
  if (!role) throw new Error('React edit pair source role mismatch');
  requireReactEdit(config, role);
  const root = await realpath(config.provenance.root);
  const cwd = await realpath(config.dev.fluo.cwd ?? resolve(root, 'tooling/benchmarks/react-app-comparison/apps/fluo'));
  if (cwd !== resolve(root, 'tooling/benchmarks/react-app-comparison/apps/fluo')) throw new Error('React edit product cwd/root mismatch');
  const path = await realpath(resolve(cwd, edit.file));
  if (relative(cwd, path).startsWith('..')) throw new Error('React edit source outside product root');
  const bytes = await readFile(path);
  const { stdout: head } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  await execute('git', ['merge-base', '--is-ancestor', REACT_EDIT_SOURCES[role].head, head.trim()], { cwd: root });
  const { stdout: lineage } = await execute('git', ['rev-list', '--ancestry-path',
    `${REACT_EDIT_SOURCES[role].head}..${head.trim()}`], { cwd: root });
  const commits = {};
  for (const sha of [...lineage.trim().split('\n').filter(Boolean), REACT_EDIT_SOURCES[role].head]) {
    commits[sha] = (await execute('git', ['cat-file', 'commit', sha], { cwd: root })).stdout;
  }
  const { stdout: dirtyPatch } = await execute('git', ['diff', 'HEAD', '--binary'], { cwd: root });
  const builds = {};
  async function inventory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) await inventory(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        builds[file] = { sha256: sha256(bytes), bytesBase64: bytes.toString('base64') };
      }
      else throw new Error('React edit build contains non-regular artifact');
    }
  }
  await inventory(resolve(cwd, 'dist'));
  if (!Object.keys(builds).length) throw new Error('React edit actual build proof missing');
  return { schemaVersion: 1, role, anchor: REACT_EDIT_SOURCES[role].head, head: head.trim(),
    root, path, file: edit.file, originalBase64: bytes.toString('base64'), originalSha256: sha256(bytes),
    gitBlob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    dirtyPatch, dirtyPatchSha256: sha256(dirtyPatch), builds, commits };
}

function verifyReactEditSource(record, role) {
  const proof = record.reactEditSource;
  const source = REACT_EDIT_SOURCES[role];
  const bytes = Buffer.from(proof?.originalBase64 ?? '', 'base64');
  const commits = proof?.commits ?? {};
  const validCommits = Object.entries(commits).every(([sha, raw]) =>
    typeof raw === 'string' && createHash('sha1').update(`commit ${Buffer.byteLength(raw)}\0`).update(raw).digest('hex') === sha);
  const reachesAnchor = (head, seen = new Set()) => {
    if (seen.has(head) || !commits[head]) return false;
    if (head === source.head) return true;
    seen.add(head);
    return [...commits[head].matchAll(/^parent ([a-f0-9]{40})$/gmu)]
      .some(([, parent]) => reachesAnchor(parent, seen));
  };
  if (!proof || proof.schemaVersion !== 1 || proof.role !== role || proof.anchor !== source.head
    || !validCommits || !reachesAnchor(proof.head)
    || !/^[a-f0-9]{40}$/u.test(proof.head ?? '') || proof.file !== source.file
    || proof.gitBlob !== source.blob || sha256(bytes) !== proof.originalSha256
    || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== source.blob
    || bytes.toString('utf8').split('Editor login').length !== 2
    || typeof proof.dirtyPatch !== 'string' || sha256(proof.dirtyPatch) !== proof.dirtyPatchSha256
    || !isAbsolute(proof.root ?? '') || proof.root !== record.provenance.root
    || proof.path !== resolve(proof.root, 'tooling/benchmarks/react-app-comparison/apps/fluo', source.file)
    || !Object.keys(proof.builds ?? {}).length
    || Object.entries(proof.builds).some(([path, artifact]) =>
      !path.startsWith(`${resolve(proof.root, 'tooling/benchmarks/react-app-comparison/apps/fluo/dist')}/`)
      || !/^[a-f0-9]{64}$/u.test(artifact?.sha256 ?? '')
      || typeof artifact.bytesBase64 !== 'string'
      || sha256(Buffer.from(artifact.bytesBase64, 'base64')) !== artifact.sha256)
    || (record.provenance.commit && record.provenance.commit !== proof.head)
    || !record.provenance.builds || !record.provenance.lockfile) {
    throw new Error('React edit pair source proof missing/mismatched');
  }
  return proof;
}

function compareReactEditPairRecords(before, after) {
  if (before.identitySha256 !== after.identitySha256) throw new Error('React edit pair environment mismatch');
  if (before.invocation.invocationId === after.invocation.invocationId) throw new Error('React edit pair invocation reuse');
  if (Boolean(before.invocation.parentInvocationId) !== Boolean(after.invocation.parentInvocationId)) {
    throw new Error('React edit pair other configuration/invocation mismatch');
  }
  const expected = structuredClone(before.configuration);
  if (before.configuration.methodVersion !== undefined || after.configuration.methodVersion !== undefined) {
    if (!['FA-V2', 'FA-V3'].includes(before.configuration.methodVersion)
      || after.configuration.methodVersion !== before.configuration.methodVersion
      || before.configuration.methodVersion === 'FA-V3'
        && !['production', 'development'].includes(before.configuration.measurementKind)
      || !before.configuration.pairId || before.configuration.pairId !== after.configuration.pairId
      || !(before.configuration.methodVersion === 'FA-V3'
        ? before.configuration.measurementKind === 'production' ? ['integrated'] : ['timing']
        : ['timing', 'native-conformance']).includes(before.configuration.measurementPurpose)
      || before.configuration.measurementPurpose !== after.configuration.measurementPurpose
      || before.configuration.pairPhase !== 'before' || after.configuration.pairPhase !== 'after'
      || before.configuration.measurementKind !== after.configuration.measurementKind) {
      throw new Error('React edit pair other configuration/phase mismatch');
    }
    expected.pairPhase = 'after';
    if (expected.measurement) {
      if (expected.measurement.methodVersion !== expected.methodVersion
        || expected.measurement.pairId !== expected.pairId
        || expected.measurement.measurementPurpose !== expected.measurementPurpose
        || expected.measurement.pairPhase !== 'before') {
        throw new Error('React edit pair other configuration/aggregate phase mismatch');
      }
      expected.measurement.pairPhase = 'after';
    }
    if (isDeepStrictEqual(expected, after.configuration)) return true;
    if (before.configuration.measurementKind === 'production' || !before.configuration.dev) {
      throw new Error('React edit pair other configuration/production mismatch');
    }
  } else if (before.configSha256 === after.configSha256) return false;
  requireReactEdit(before.configuration, 'before');
  requireReactEdit(after.configuration, 'after');
  verifyReactEditSource(before, 'before');
  verifyReactEditSource(after, 'after');
  Object.assign(expected.dev.fluo.edits['react-edit'], {
    file: REACT_EDIT_SOURCES.after.file, reload: REACT_EDIT_SOURCES.after.reload,
  });
  if (!isDeepStrictEqual(expected, after.configuration)
    || Boolean(before.invocation.parentInvocationId) !== Boolean(after.invocation.parentInvocationId)) {
    throw new Error('React edit pair other configuration/invocation mismatch');
  }
  return true;
}

// Full config authentication happens first. This relation does not create a
// shared config hash or broaden environmentConfigIdentity.
export async function authenticateReactEditPair(beforeBinding, afterBinding, outputRoot) {
  const before = await verifyEnvironmentBinding(beforeBinding, outputRoot);
  const after = await verifyEnvironmentBinding(afterBinding, outputRoot);
  if (!compareReactEditPairRecords(before, after)) return null;
  return { schemaVersion: 1, method: REACT_EDIT_PAIR_METHOD, before: beforeBinding, after: afterBinding,
    beforeConfigSha256: before.configSha256, afterConfigSha256: after.configSha256,
    ...(before.reactEditSource ? { beforeSource: before.reactEditSource } : {}),
    ...(after.reactEditSource ? { afterSource: after.reactEditSource } : {}) };
}

export async function verifyReactEditPairRelation(relation, binding, outputRoot) {
  if (!relation || relation.method !== REACT_EDIT_PAIR_METHOD || !isDeepStrictEqual(relation.after, binding)) {
    throw new Error('React edit pair relation/binding mismatch');
  }
  const expected = await authenticateReactEditPair(relation.before, relation.after, outputRoot);
  const after = await verifyEnvironmentBinding(binding, outputRoot);
  if (after.pairBeforeBinding && !isDeepStrictEqual(after.pairBeforeBinding, relation.before)) {
    throw new Error('React edit pair original before binding mismatch');
  }
  if (!expected || !isDeepStrictEqual(expected, relation)) throw new Error('React edit pair relation replay mismatch');
}

export async function importEnvironmentPairBefore(flags, outputRoot) {
  if (!flags.includes('--environment-before-record')) return undefined;
  const path = flags[flags.indexOf('--environment-before-record') + 1];
  const beforeRoot = flags[flags.indexOf('--environment-before-root') + 1];
  if (!flags.includes('--environment-before-root') || !beforeRoot || !path) throw new Error('React edit pair before root/record missing');
  const raw = await readFile(path);
  const record = JSON.parse(raw);
  const before = { method: record.method, path: resolve(path), sha256: sha256(raw),
    invocationId: record.invocation?.invocationId, identitySha256: record.identitySha256, configSha256: record.configSha256 };
  await verifyEnvironmentBinding(before, beforeRoot);
  requireEnvironmentPairIdentity(before, flags);
  if (!flags.includes('--environment-identity')) throw new Error('React edit pair requires original full identities');
  const destination = resolve(outputRoot, `pair-before-${before.invocationId}.json`);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(destination, raw, { flag: 'wx' });
  return { ...before, path: destination };
}

export async function bindEnvironmentPair(binding, flags, outputRoot) {
  if (!flags.includes('--environment-before-record')) {
    requireEnvironmentPairIdentity(binding, flags);
    return undefined;
  }
  const after = await verifyEnvironmentBinding(binding, outputRoot);
  if (!after.pairBeforeBinding) throw new Error('React edit pair original before binding missing at capture');
  const originalPath = flags[flags.indexOf('--environment-before-record') + 1];
  const originalRoot = flags[flags.indexOf('--environment-before-root') + 1];
  await verifyEnvironmentBinding({ ...after.pairBeforeBinding, path: resolve(originalPath) }, originalRoot);
  requireEnvironmentPairIdentity(after.pairBeforeBinding, flags);
  return await authenticateReactEditPair(after.pairBeforeBinding, binding, outputRoot) ?? undefined;
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
async function observeGuestIdentity(config, host, entrypoints) {
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
  const timing = ['FA-V2', 'FA-V3'].includes(config.methodVersion) && config.measurementPurpose === 'timing';
  if (!timing && (!config.nativeLifetime?.enabled || !isAbsolute(config.nativeLifetime.python ?? ''))) {
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
  let python;
  let externalIdentity;
  if (!timing) {
  python = await fileIdentity(config.nativeLifetime.python);
  const { stdout: runtime } = await execute(config.nativeLifetime.python, ['-c',
    'import sys,platform,hashlib,json,pathlib,frida; p=pathlib.Path(frida.__file__).parent; print(json.dumps({"pythonVersion":platform.python_version(),"pythonSha256":hashlib.sha256(pathlib.Path(sys.executable).resolve().read_bytes()).hexdigest(),"fridaVersion":frida.__version__,"fridaFiles":{n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ["__init__.py","aio.py","_frida.abi3.so"]},"files":{str(p/n):hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ["__init__.py","aio.py","_frida.abi3.so"]}}))']);
  const external = JSON.parse(runtime);
  const { files: externalFiles, ...observedExternal } = external;
  externalIdentity = observedExternal;
  if (!isDeepStrictEqual(externalIdentity, native.NATIVE_LIFETIME_RUNTIME)) {
    throw new Error('isolated environment external Python/Frida identity mismatch');
  }
  Object.assign(files, externalFiles);
  }
  const collector = await captureCollectorSources(undefined, entrypoints);
  for (const file of Object.values(collector)) files[file.path] = file.sha256;
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
    sdk, pnpm, browser: browserIdentity, ...(timing ? {} : { python, external: externalIdentity }),
    observer: { enabled: !timing, method: native.NATIVE_LIFETIME_METHOD, schema: native.NATIVE_LIFETIME_SCHEMA },
    collector, collectorEntrypoints: entrypoints, locks, files, allocation, platform: platform(), arch: arch(), kernel: release(),
    logicalCpus: cpus().length, availableParallelism: availableParallelism(), memoryBytes: totalmem() };
}

export async function captureIsolatedEnvironment(config, invocation, outputRoot,
  { entrypoints = ['measure.mjs', 'run-gate.mjs'], pairBeforeBinding, reactEditPairSource = false } = {}) {
  const before = pairBeforeBinding ? await verifyEnvironmentBinding(pairBeforeBinding, outputRoot) : null;
  const guest = await observeGuestIdentity(config, invocation.host, entrypoints);
  // Container instance/PID/start time are evidence, not pair-comparison identity.
  const identity = isolatedEnvironmentIdentity(invocation.host, guest);
  const record = { schemaVersion: 1, method: ENVIRONMENT_METHOD, invocation, identity,
    ...(pairBeforeBinding ? { pairBeforeBinding } : {}),
    configuration: comparableEnvironmentSettings(config), configurationEvidence: environmentSettings(config),
    provenance: productProvenance(config.provenance),
    configSha256: environmentConfigIdentity(config), identitySha256: objectSha256(identity),
    guestEvidence: { pid: process.pid, hostname: hostname(), observedAt: new Date().toISOString(), guest } };
  const reactEditSource = await captureReactEditSource(config, {
    pairSource: reactEditPairSource || Boolean(before && !isDeepStrictEqual(
      before.configuration.dev?.fluo?.edits?.['react-edit'],
      record.configuration.dev?.fluo?.edits?.['react-edit'])),
  });
  if (reactEditSource) record.reactEditSource = reactEditSource;
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
  const timing = ['FA-V2', 'FA-V3'].includes(record.configuration?.methodVersion)
    && record.configuration?.measurementPurpose === 'timing';
  if (guest.platform !== 'linux' || guest.arch !== 'arm64' || guest.runtime?.version !== 'v24.21.0'
    || guest.browser?.sha256 !== native.NATIVE_LIFETIME_IDENTITY.binarySha256
    || guest.browser?.version !== native.NATIVE_LIFETIME_IDENTITY.browserVersion
    || (!timing && !isDeepStrictEqual(guest.external, native.NATIVE_LIFETIME_RUNTIME))
    || guest.observer?.method !== native.NATIVE_LIFETIME_METHOD || guest.observer?.schema !== native.NATIVE_LIFETIME_SCHEMA
    || guest.observer.enabled !== !timing || record.configuration?.nativeLifetime?.enabled !== !timing
    || (timing && (guest.python || guest.external))) {
    throw new Error('environment binding unsupported runtime/browser/observer');
  }
  const files = [guest.runtime.node, guest.browser, ...(!timing ? [guest.python] : []), guest.pnpm,
    ...['@playwright/test', 'playwright', 'playwright-core', 'typescript'].map((name) => guest.sdk?.[name]),
    ...collectorSources(guest.collectorEntrypoints).map((name) => guest.collector?.[name]),
    ...['.', ...FRAMEWORKS.map((name) => `apps/${name}`)].map((name) => guest.locks?.[name])];
  if (files.some((file) => !isAbsolute(file?.path ?? '') || !/^[a-f0-9]{64}$/u.test(file?.sha256 ?? '')
      || guest.files[file.path] !== file.sha256)
    || (!timing && guest.python?.sha256 !== native.NATIVE_LIFETIME_RUNTIME.pythonSha256)
    || guest.pnpm.version !== '10.4.1'
    || ['@playwright/test', 'playwright', 'playwright-core'].some((name) => guest.sdk[name].version !== '1.61.1')
    || guest.sdk.typescript.version !== '6.0.2'
    || ['cpu.max', 'cpuset.cpus.effective', 'memory.max'].some((name) =>
      typeof guest.allocation?.[name] !== 'string' || !guest.allocation[name])) {
    throw new Error('environment binding incomplete executable/SDK/collector/allocation identity');
  }
  if (record.pairBeforeBinding) {
    const before = await verifyEnvironmentBinding(record.pairBeforeBinding, outputRoot);
    compareReactEditPairRecords(before, record);
  }
  return record;
}

async function revalidateEnvironment(config, directory) {
  if (!config.isolatedRepresentative && !config.environmentBinding) return;
  const record = await verifyEnvironmentBinding(config.environmentBinding, directory);
  if (!config.isolatedRepresentative || config.environmentBinding.configSha256 !== environmentConfigIdentity(config)) {
    throw new Error('environment binding configuration mismatch');
  }
  if (config.environmentPairRelation) await verifyReactEditPairRelation(config.environmentPairRelation, config.environmentBinding, directory);
  if (record.reactEditSource) {
    verifyReactEditSource(record, record.reactEditSource.role);
    if (sha256(await readFile(record.reactEditSource.path)) !== record.reactEditSource.originalSha256) {
      throw new Error('React edit source changed outside stimulus interval');
    }
    for (const [path, artifact] of Object.entries(record.reactEditSource.builds)) {
      if (sha256(await readFile(path)) !== artifact.sha256) throw new Error('React edit actual build changed');
    }
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
      ...(['FA-V2', 'FA-V3'].includes(config.methodVersion) ? { cycle: cycle + 1, slot: slot + 1 } : {}),
    }))).flat();
}

export async function collectMeasurements(config, driver, directory) {
  const plan = planMeasurements(config);
  await mkdir(directory, { recursive: true });
  const methodBinding = config.methodVersion !== undefined ? await captureMethodBinding(config, directory) : undefined;
  const method = methodBinding ? { methodVersion: methodBinding.methodVersion,
    measurementPurpose: methodBinding.measurementPurpose, methodBinding,
    ...(methodBinding.methodVersion === 'FA-V3' ? { measurementKind: methodBinding.measurementKind } : {}) } : {};
  const isolated = config.isolatedRepresentative || config.environmentBinding;
  const binding = isolated ? { isolatedRepresentative: true, environmentBinding: config.environmentBinding,
    ...(config.environmentPairRelation ? { environmentPairRelation: config.environmentPairRelation } : {}) } : {};
  const provenance = productProvenance(config.provenance);
  await revalidateEnvironment(config, dirname(directory));
  const runs = [];
  const warmups = [];
  for (const item of plan) {
    console.log(`MEASUREMENT_STAGE=${item.runId}/${item.framework}/check`);
    const correctness = await driver.check(item, config);
    console.log(`MEASUREMENT_STAGE=${item.runId}/${item.framework}/${correctness.pass ? 'measure' : 'correctness-failed'}`);
    await revalidateEnvironment(config, dirname(directory));
    const observation = correctness.pass
      ? await driver.measure({ ...item, ...method, nativeTraceDirectory: resolve(directory) }, config)
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
      schemaVersion: 1, ...item, ...binding, ...method, provenance, profileSettings: PROFILES[item.device],
      environment: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model,
        cpuCores: cpus().length, memoryBytes: totalmem(), runtimeVersion: process.version,
        browserVersion: driver.browserVersion ?? null },
      correctness, qualityFailures: observation.qualityFailures ?? [], metrics, unavailable,
      requests: observation.requests ?? [], timings: observation.timings ?? {},
      artifacts: observation.artifacts ?? {},
    }, null, 2)}\n`);
    const run = {
      profile: item.profile, mode: item.mode, framework: item.framework, runId: item.runId,
      trace, warmupRuns: config.warmupRuns, ...binding, ...method,
      ...(methodBinding ? { warmup: item.warmup, cycle: item.cycle, slot: item.slot } : {}),
      ...(methodBinding && observation.artifacts?.serverCpuSha256
        ? { serverCpuSha256: observation.artifacts.serverCpuSha256 } : {}),
      correctness: !correctness.pass ? 'fail' : observation.qualityFailures?.length ? 'inconclusive' : 'pass',
      metrics,
    };
    (item.warmup ? warmups : runs).push(run);
    console.log(`MEASUREMENT_TRACE_COMPLETE=${trace}`);
  }
  return { schemaVersion: 1, provenance, ...binding, ...method, profile: config.profile, mode: config.mode, warmups, runs };
}

export async function collectDevMeasurements(config, driver, directory) {
  const steps = {
    'cold-ready': 'devColdReadyMs', 'react-edit': 'devReactEditVisibleMs',
    'css-edit': 'devCssEditVisibleMs', 'server-edit': 'devServerEditVisibleMs',
  };
  const measurement = { ...config, ...(config.methodVersion ? { measurementKind: 'development' } : {}),
    ...(config.methodVersion === 'FA-V3' ? { measurementPurpose: 'timing', nativeLifetime: { enabled: false } } : {}) };
  if (config.environmentPairRelation) Object.defineProperty(measurement, 'environmentPairRelation', {
    value: config.environmentPairRelation,
  });
  return collectMeasurements(measurement, {
    browserVersion: driver.browserVersion,
    check: (item) => driver.check(item, config),
    async measure(item) {
      try {
        const metrics = {};
        const timings = {};
        const qualityFailures = [];
        const unavailable = {};
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
          if (kind === 'react-edit' && item.framework === 'fluo'
            && config.dev?.fluo?.edits?.[kind]?.from === 'Editor login') {
            const { verifyDevEditObservation } = await import('./measure-browser.mjs');
            const environment = config.environmentBinding
              ? await verifyEnvironmentBinding(config.environmentBinding, dirname(directory)) : null;
            try {
              verifyDevEditObservation(observation, config.dev.fluo.edits[kind], environment?.reactEditSource);
            } catch (error) {
              timings[kind] = observation;
              unavailable[metric] = error.message;
              qualityFailures.push(error.message);
              continue;
            }
          }
          metrics[metric] = observation.durationMs;
          timings[kind] = observation;
        }
        return { metrics, timings, qualityFailures, unavailable: { ...Object.fromEntries(METRICS.filter((name) => !name.startsWith('dev'))
          .map((name) => [name, 'not measured in development mode'])), ...unavailable } };
      } finally {
        await driver.closeDev?.(item);
      }
    },
  }, directory);
}

export async function mergeEvidence(production, development, directory) {
  if (production.methodVersion || development.methodVersion) {
    if (!['FA-V2', 'FA-V3'].includes(production.methodVersion) || development.methodVersion !== production.methodVersion
      || (production.methodVersion === 'FA-V3'
        ? production.measurementKind !== 'production' || development.measurementKind !== 'development'
          || production.measurementPurpose !== 'integrated' || development.measurementPurpose !== 'timing'
          || production.methodBinding?.pairPhase !== development.methodBinding?.pairPhase
          || production.methodBinding?.executionId === development.methodBinding?.executionId
        : production.measurementPurpose !== development.measurementPurpose)
      || production.methodBinding?.pairId !== development.methodBinding?.pairId
      || production.methodBinding?.productSha256 !== development.methodBinding?.productSha256) {
      throw new Error('FA-V2 production/development purpose/product mismatch');
    }
  }
  const isolated = production.isolatedRepresentative || development.isolatedRepresentative
    || production.environmentBinding || development.environmentBinding;
  if (isolated && (!production.isolatedRepresentative || !development.isolatedRepresentative
    || !production.environmentBinding?.identitySha256
    || !development.environmentBinding?.identitySha256
    || production.methodVersion !== 'FA-V3'
      && production.environmentBinding.identitySha256 !== development.environmentBinding.identitySha256)) {
    throw new Error('environment binding production/development mismatch');
  }
  if (isolated) {
    await verifyMeasurementEnvironment(production, dirname(directory));
    await verifyMeasurementEnvironment(development, dirname(directory));
    if (production.methodVersion === 'FA-V3') {
      const first = await verifyEnvironmentBinding(production.environmentBinding, dirname(directory));
      const second = await verifyEnvironmentBinding(development.environmentBinding, dirname(directory));
      assertProductionDevelopmentEnvironment(first, second);
    }
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
      ...(production.methodBinding ? { methodVersion: run.methodVersion, measurementPurpose: run.measurementPurpose,
        ...(production.methodVersion === 'FA-V3' ? { measurementKind: 'production' } : {}),
        methodBinding: run.methodBinding, sourceMethodBindings: [run.methodBinding, dev.methodBinding],
        serverCpuSha256: run.serverCpuSha256,
        profile: run.profile, mode: run.mode, framework: run.framework, runId: run.runId,
        warmup: run.warmup, cycle: run.cycle, slot: run.slot,
        provenance: production.provenance } : {}),
      ...(isolated ? { isolatedRepresentative: true, environmentBinding: production.environmentBinding,
        sourceEnvironmentBindings: [run.environmentBinding, dev.environmentBinding],
        ...(production.environmentPairRelation ? { environmentPairRelation: production.environmentPairRelation } : {}),
        sourceEnvironmentPairRelations: [run.environmentPairRelation ?? null, dev.environmentPairRelation ?? null] } : {}),
      correctness: { production: run.correctness, development: dev.correctness },
    }, null, 2)}\n`);
    runs.push({ ...run, trace, correctness: run.correctness === 'fail' || dev.correctness === 'fail'
      ? 'fail' : run.correctness === 'inconclusive' || dev.correctness === 'inconclusive' ? 'inconclusive' : 'pass',
      metrics: { ...run.metrics, ...dev.metrics } });
  }
  return { ...production, runs, developmentWarmups: development.warmups,
    ...(production.methodBinding ? { developmentMethodBinding: development.methodBinding } : {}),
    ...(isolated ? { developmentEnvironmentBinding: development.environmentBinding,
      ...(development.environmentPairRelation ? { developmentEnvironmentPairRelation: development.environmentPairRelation } : {}) } : {}) };
}

export function assertProductionDevelopmentEnvironment(production, development) {
  if (production.configuration.methodVersion !== 'FA-V3' || development.configuration.methodVersion !== 'FA-V3'
    || production.configuration.measurementKind !== 'production' || development.configuration.measurementKind !== 'development'
    || production.configuration.measurementPurpose !== 'integrated' || development.configuration.measurementPurpose !== 'timing'
    || production.configuration.pairId !== development.configuration.pairId
    || production.configuration.pairPhase !== development.configuration.pairPhase) {
    throw new Error('FA-V3 production/development environment kind/purpose mismatch');
  }
  // Native dependencies are deliberately absent from the non-invasive dev run.
  // Each full identity is authenticated first; all shared tools/sources remain equal.
  const common = ({ identity }) => {
    const { python, external, fileContents, observer, ...guest } = identity.guest;
    const { enabled, ...schema } = observer;
    return { ...identity, guest: { ...guest, observer: schema } };
  };
  if (!isDeepStrictEqual(common(production), common(development))) {
    throw new Error('FA-V3 production/development shared environment mismatch');
  }
}

export async function verifyMeasurementEnvironment(receipt, outputRoot) {
  const method = receipt.methodVersion !== undefined ? await verifyMethodReceipt(receipt, outputRoot) : undefined;
  const samples = [...receipt.runs, ...(receipt.warmups ?? []), ...(receipt.developmentWarmups ?? [])];
  if (!receipt.isolatedRepresentative && !receipt.environmentBinding
    && !samples.some((run) => run.isolatedRepresentative || run.environmentBinding)
    && !receipt.developmentEnvironmentBinding) {
    // Summary deletion cannot downgrade isolated raw traces to the default mode.
    await verifyTraceFiles(samples, outputRoot);
    return;
  }
  if (!receipt.isolatedRepresentative) {
    throw new Error('environment binding aggregate mode missing');
  }
  const environment = await verifyEnvironmentBinding(receipt.environmentBinding, outputRoot);
  if (method && environment.configSha256 !== environmentConfigIdentity(method.configuration)) {
    throw new Error('FA-V2 method/environment full configuration mismatch');
  }
  if (receipt.methodVersion === 'FA-V3'
    && (environment.configuration.methodVersion !== method.methodVersion
      || environment.configuration.measurementPurpose !== method.measurementPurpose
      || environment.configuration.measurementKind !== method.measurementKind)) {
    throw new Error('FA-V3 method/environment configuration mismatch');
  }
  if (environment.pairBeforeBinding && environment.pairBeforeBinding.configSha256 !== environment.configSha256
    && !receipt.environmentPairRelation) throw new Error('React edit pair aggregate relation missing');
  if (receipt.environmentPairRelation) {
    await verifyReactEditPairRelation(receipt.environmentPairRelation, receipt.environmentBinding, outputRoot);
  }
  if (!isDeepStrictEqual(receipt.provenance, environment.provenance)) {
    throw new Error('environment binding aggregate provenance mismatch');
  }
  if (receipt.profile !== environment.configuration.profile || receipt.mode !== environment.configuration.mode) {
    throw new Error('environment binding aggregate configuration mismatch');
  }
  if (receipt.developmentEnvironmentBinding) {
    const development = await verifyEnvironmentBinding(receipt.developmentEnvironmentBinding, outputRoot);
    if (method) {
      const { verifyMethodBinding } = await import('./fa-v2.mjs');
      const devMethod = await verifyMethodBinding(receipt.developmentMethodBinding, outputRoot);
      if (development.configSha256 !== environmentConfigIdentity(devMethod.configuration)) {
        throw new Error('FA-V2 development method/environment full configuration mismatch');
      }
    }
    if (development.pairBeforeBinding && development.pairBeforeBinding.configSha256 !== development.configSha256
      && !receipt.developmentEnvironmentPairRelation) throw new Error('React edit pair development relation missing');
    if (receipt.developmentEnvironmentPairRelation) await verifyReactEditPairRelation(
      receipt.developmentEnvironmentPairRelation, receipt.developmentEnvironmentBinding, outputRoot);
    if (!isDeepStrictEqual(receipt.provenance, development.provenance)
      || receipt.methodVersion !== 'FA-V3' && environment.identitySha256 !== development.identitySha256) {
      throw new Error('environment binding development identity/provenance mismatch');
    }
    if (receipt.methodVersion === 'FA-V3') assertProductionDevelopmentEnvironment(environment, development);
  }
  for (const run of samples) {
    const expected = (receipt.developmentWarmups ?? []).includes(run)
      ? receipt.developmentEnvironmentBinding : receipt.environmentBinding;
    if (!run.isolatedRepresentative || !isDeepStrictEqual(run.environmentBinding, expected)) {
      throw new Error('environment binding sample/aggregate mismatch');
    }
    const expectedRelation = (receipt.developmentWarmups ?? []).includes(run)
      ? receipt.developmentEnvironmentPairRelation : receipt.environmentPairRelation;
    if (!isDeepStrictEqual(run.environmentPairRelation, expectedRelation)) {
      throw new Error('React edit pair sample/aggregate relation mismatch');
    }
  }
  await verifyTraceFiles(samples, outputRoot);
}

export async function verifyTraceFiles(runs, outputRoot) {
  const root = await realpath(outputRoot);
  async function verify(path, sources = false, expected, mismatch = 'sample/trace') {
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
    if (record.methodVersion || expected?.methodVersion || record.methodBinding || expected?.methodBinding) {
      await verifyMethodTrace(record, expected, root);
    }
    const isolated = record.isolatedRepresentative || record.environmentBinding || record.provenance?.isolatedRepresentative;
    if (expected && (isolated || expected.isolatedRepresentative || expected.environmentBinding)
      && (record.isolatedRepresentative !== true || expected.isolatedRepresentative !== true
        || !isDeepStrictEqual(record.environmentBinding, expected.environmentBinding))) {
      throw new Error(`environment binding ${mismatch} mismatch`);
    }
    if (expected && !isDeepStrictEqual(record.environmentPairRelation, expected.environmentPairRelation)) {
      throw new Error('React edit pair sample/trace relation mismatch');
    }
    if (isolated) {
      if (!record.isolatedRepresentative) throw new Error('environment binding trace mode missing');
      const environment = await verifyEnvironmentBinding(record.environmentBinding, root);
      if (environment.pairBeforeBinding && environment.pairBeforeBinding.configSha256 !== environment.configSha256
        && !record.environmentPairRelation) throw new Error('React edit pair trace relation missing');
      if (record.environmentPairRelation) await verifyReactEditPairRelation(record.environmentPairRelation, record.environmentBinding, root);
      if (sources && !isDeepStrictEqual(record.provenance, environment.provenance)) {
        throw new Error('environment binding trace provenance mismatch');
      }
      if (sources && (record.profile !== environment.configuration.profile || record.mode !== environment.configuration.mode
        || record.url !== environment.configuration.apps?.[record.framework]
        || record.environment?.browserVersion !== environment.identity.guest.browser.version)) {
        throw new Error('environment binding trace configuration/browser mismatch');
      }
      if (sources && record.correctness?.pass) {
        const edit = environment.configuration.dev?.fluo?.edits?.['react-edit'];
        if (record.framework === 'fluo' && record.timings?.['react-edit'] && edit?.from === 'Editor login') {
          const { verifyDevEditObservation } = await import('./measure-browser.mjs');
          try {
            verifyDevEditObservation(record.timings['react-edit'], edit, environment.reactEditSource);
          } catch (error) {
            if (Object.hasOwn(record.metrics, 'devReactEditVisibleMs')
              || !record.qualityFailures?.includes(error.message)
              || record.unavailable.devReactEditVisibleMs !== error.message) throw error;
          }
        }
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
          ...(record.methodBinding ? { methodVersion: record.methodVersion,
            measurementPurpose: record.measurementPurpose, pairId: record.methodBinding.pairId,
            executionId: record.methodBinding.executionId,
            ...(record.methodVersion === 'FA-V3' ? { measurementKind: record.measurementKind,
              pairPhase: record.methodBinding.pairPhase, configSha256: record.methodBinding.configSha256,
              productSha256: record.methodBinding.productSha256 } : {}) } : {}),
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
        // Authenticate containment before reading even for mode discovery.
        const raw = await verify(source, true, {
          isolatedRepresentative: record.isolatedRepresentative,
          environmentBinding: record.sourceEnvironmentBindings?.[index],
          environmentPairRelation: record.sourceEnvironmentPairRelations?.[index] ?? undefined,
          ...(record.methodBinding ? { methodVersion: record.methodVersion,
            measurementPurpose: record.methodVersion === 'FA-V3' && index === 1 ? 'timing' : record.measurementPurpose,
            ...(record.methodVersion === 'FA-V3' ? { measurementKind: index === 1 ? 'development' : 'production' } : {}),
            methodBinding: record.sourceMethodBindings?.[index],
            profile: record.profile, mode: record.mode, framework: record.framework, runId: record.runId,
            ...(index === 0 ? { serverCpuSha256: record.serverCpuSha256 } : {}),
            correctness: index === 0 ? record.correctness.production : record.correctness.development } : {}),
        }, 'combined source');
        if (isolated) {
          if (!raw.isolatedRepresentative || !isDeepStrictEqual(raw.environmentBinding, record.sourceEnvironmentBindings?.[index])
            || record.methodVersion !== 'FA-V3'
              && raw.environmentBinding?.identitySha256 !== record.environmentBinding.identitySha256) {
            throw new Error('environment binding combined source mismatch');
          }
          if (record.methodVersion === 'FA-V3' && index === 1) {
            assertProductionDevelopmentEnvironment(
              await verifyEnvironmentBinding(record.environmentBinding, root),
              await verifyEnvironmentBinding(raw.environmentBinding, root));
          }
        }
      }
    } else {
      await verify(path, true, expected);
    }
    return record;
  }
  for (const run of runs) {
    await verify(run.trace, false, run);
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
  if (Object.hasOwn(config, 'environmentPairRelation')) throw new Error('caller-supplied React edit pair descriptor forbidden');
  const output = resolve(outputPath);
  if (config.methodVersion === 'FA-V3') {
    if (config.measurementKind !== (flags.includes('--dev') ? 'development' : 'production')) {
      throw new Error('FA-V3 CLI measurement kind must match explicit configuration');
    }
  } else if (config.methodVersion !== undefined) {
    config.measurementKind = flags.includes('--dev') ? 'development' : 'production';
  }
  if (invocation) {
    const pairBeforeBinding = await importEnvironmentPairBefore(flags, dirname(output));
    config.environmentBinding = await captureIsolatedEnvironment(config, invocation, dirname(output), {
      pairBeforeBinding, reactEditPairSource: flags.includes('--react-edit-pair-source'),
    });
    config.isolatedRepresentative = true;
  } else if (config.isolatedRepresentative || config.environmentBinding) {
    throw new Error('isolated representative requires live host launcher');
  }
  Object.defineProperty(config, 'environmentPairRelation', {
    value: await bindEnvironmentPair(config.environmentBinding, flags, dirname(output)),
  });
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
    const developmentConfig = config.methodVersion === 'FA-V3'
      ? { ...config, measurementKind: 'development', measurementPurpose: 'timing',
        nativeLifetime: { enabled: false } } : config;
    if (invocation && config.methodVersion === 'FA-V3') {
      developmentConfig.environmentBinding = await captureIsolatedEnvironment(developmentConfig,
        { ...invocation, parentInvocationId: invocation.invocationId,
          invocationId: `${invocation.invocationId}-development` }, dirname(output));
    }
    const devDriver = await createBrowserDriver(developmentConfig, { devMode: true });
    try {
      const development = await collectDevMeasurements(developmentConfig, devDriver, join(dirname(output), 'dev-traces'));
      result = await mergeEvidence(result, development, join(dirname(output), 'combined-traces'));
    } finally { await devDriver.close(); }
  }
  await verifyTraceFiles([...result.runs, ...result.warmups, ...(result.developmentWarmups ?? [])], dirname(output));
  await verifyMeasurementEnvironment(result, dirname(output));
  const baselinePath = flags[flags.indexOf('--baseline') + 1];
  if (flags.includes('--gate') && !baselinePath) throw new Error('--gate requires --baseline <JSON>');
  if (flags.includes('--gate')) {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const { evaluateAcceptedEvidence, evaluateEvidence } = await import('./gate.mjs');
    const traceRoot = flags.includes('--trace-root') ? resolve(flags[flags.indexOf('--trace-root') + 1]) : dirname(output);
    if (flags.includes('--historical-replay')) {
      result = { ...result, evaluation: await evaluateEvidence(baseline, [result], traceRoot) };
    } else {
      let counterparts = [];
      if (config.methodVersion === 'FA-V3') {
        if (flags.includes('--native-counterpart')) throw new Error('FA-V3 cannot borrow native counterparts');
      } else {
        const counterpartPath = flags[flags.indexOf('--native-counterpart') + 1];
        if (!flags.includes('--native-counterpart')) throw new Error('FA-V2 gate requires --native-counterpart');
        counterparts = [JSON.parse(await readFile(counterpartPath, 'utf8'))];
      }
      result = { ...result, evaluation: await evaluateAcceptedEvidence(baseline, [result], traceRoot, counterparts) };
    }
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
