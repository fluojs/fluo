import { type ChildProcess, execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { linuxListeners } from './linux-listeners';
import { object, sha256 } from './profile-report';
import type { AppShape } from './scenarios';
import type { TargetConfig } from './targets';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const execute = promisify(execFile);

export class WorkerdFailure extends Error {
  constructor(message: string, readonly evidence: unknown = null) {
    super(message);
    this.name = 'WorkerdFailure';
  }
}

export function workerdExecutable(): string {
  const api = object(require('workerd'));
  if (api.version !== '1.20250604.0' || typeof api.default !== 'string') {
    throw new WorkerdFailure('Unexpected installed workerd API/version', api);
  }
  return api.default;
}

export function workerdConfig(target: TargetConfig, appShape: AppShape, configuration: string) {
  if (!/^[a-z-]+$/.test(appShape) || !['default', 'equivalent'].includes(configuration)) {
    throw new WorkerdFailure('Invalid workerd text bindings', { appShape, configuration });
  }
  const directory = join(root, 'dist', target.name);
  const path = join(directory, `${appShape}-${configuration}.capnp`);
  const text = `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "benchmark", worker = (
    modules = [(name = "server.js", esModule = embed "server.js")],
    compatibilityDate = "2025-06-01",
    compatibilityFlags = ["nodejs_compat"],
    bindings = [
      (name = "BENCH_APP_SHAPE", text = "${appShape}"),
      (name = "BENCH_CONFIGURATION", text = "${configuration}")
    ]
  ))],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = (name = "benchmark"))]
);
`;
  return { path, text, bundle: join(directory, 'server.js'), metafile: join(directory, 'meta.json') };
}

export function writeWorkerdConfig(config: ReturnType<typeof workerdConfig>): void {
  mkdirSync(join(config.path, '..'), { recursive: true });
  writeFileSync(config.path, config.text);
}

export function workerdArtifacts(config: ReturnType<typeof workerdConfig>): Record<string, string> {
  return Object.fromEntries([config.path, config.bundle, config.metafile, workerdExecutable()]
    .map((path) => [path, sha256(readFileSync(path))]));
}

export interface WorkerdControl {
  readonly ready: Promise<void>;
  readonly raw: string[];
  readonly messages: Record<string, unknown>[];
  readonly child: ChildProcess;
  readonly launch: { readonly command: string; readonly args: string[] };
  readonly config?: ReturnType<typeof workerdConfig>;
  readonly artifacts?: Record<string, string>;
  readonly port: number;
  readonly inspectorPort?: number;
  failure: Error | null;
}
const controls = new WeakMap<ChildProcess, WorkerdControl>();
const subjects = new Map<number, WorkerdControl>();

export function workerdSubject(pid: number): WorkerdControl {
  const subject = subjects.get(pid);
  if (!subject || subject.failure || subject.child.exitCode !== null || subject.child.signalCode !== null) {
    throw new WorkerdFailure('Missing live direct-workerd control subject', {
      pid, control: subject?.raw, failure: subject?.failure?.message,
    });
  }
  return subject;
}

export function workerdReadiness(child: ChildProcess): Promise<void> | undefined {
  return controls.get(child)?.ready;
}

export async function workerdProcessProof(pid: number, inspectorPort?: number) {
  const state = workerdSubject(pid);
  await state.ready;
  if (!state.config || !state.artifacts || state.inspectorPort !== inspectorPort) {
    throw new WorkerdFailure('workerd configuration or instrumentation identity mismatch');
  }
  const executable = workerdExecutable();
  const command = (await execute('ps', ['-p', String(pid), '-o', 'command='])).stdout.trim();
  const version = (await execute(executable, ['--version'])).stdout.trim();
  const nativePath = await realpath(executable);
  const executableEvidence = process.platform === 'linux'
    ? await realpath(`/proc/${pid}/exe`)
    : (await execute('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'])).stdout;
  if (state.launch.command !== executable || command !== [executable, ...state.launch.args].join(' ')
    || state.launch.args[1] !== state.config.path || version !== 'workerd 2025-06-04'
    || (await readFile(state.config.path, 'utf8')) !== state.config.text
    || (process.platform === 'linux' ? executableEvidence !== nativePath : !executableEvidence.split('\n').includes(`n${nativePath}`))
    || state.launch.args.filter((arg) => /inspector|profiler/.test(arg)).join('') !== (inspectorPort === undefined ? '' : `--inspector-addr=127.0.0.1:${inspectorPort}`)) {
    throw new WorkerdFailure('workerd native executable/config/argv mismatch', {
      command, executableEvidence, version, launch: state.launch,
      config: state.config, artifacts: state.artifacts, control: state.raw,
    });
  }
  for (const [path, hash] of Object.entries(state.artifacts)) {
    if (sha256(await readFile(path)) !== hash) throw new WorkerdFailure('workerd launch artifact changed', { path, hash });
  }
  let listeners: string;
  let listeningPorts: number[];
  if (process.platform === 'linux') {
    const snapshot = await linuxListeners(pid);
    listeners = JSON.stringify(snapshot);
    listeningPorts = snapshot.sockets.filter((socket) => socket.owned).map((socket) => socket.port);
  } else {
    listeners = (await execute('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fpn'])).stdout;
    listeningPorts = listeners.split('\n').filter((line) => line.startsWith('n'))
      .map((line) => Number(line.slice(line.lastIndexOf(':') + 1)));
  }
  const ports = [state.port, ...(inspectorPort === undefined ? [] : [inspectorPort])];
  if (listeningPorts.length !== ports.length || ports.some((port) => !listeningPorts.includes(port))) {
    throw new WorkerdFailure('workerd HTTP/inspector listener ownership mismatch', { listeners, ports });
  }
  return {
    command, executableEvidence, listeners, control: [...state.raw],
    artifacts: state.artifacts, config: state.config,
    runtime: { host: 'workerd', version, executable },
    inspectorState: inspectorPort === undefined ? 'absent' : 'explicit-profiling-control',
  };
}

export function observeWorkerd(
  child: ChildProcess,
  launch: WorkerdControl['launch'],
  expected: {
    readonly port: number; readonly inspectorPort?: number; readonly onRaw?: (bytes: Buffer) => void; readonly timeoutMs?: number;
    readonly config?: ReturnType<typeof workerdConfig>; readonly artifacts?: Record<string, string>;
  },
): WorkerdControl {
  const control = child.stdio[3];
  if (!(control instanceof Readable)) throw new WorkerdFailure('Missing workerd control pipe');
  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Launch owns observation immediately; late waitForTarget callers reuse this settled promise.
  void ready.catch(() => {});
  const state: WorkerdControl = {
    ready, raw: [], messages: [], child, launch, failure: null,
    port: expected.port, inspectorPort: expected.inspectorPort, config: expected.config, artifacts: expected.artifacts,
  };
  controls.set(child, state);
  if (child.pid !== undefined) subjects.set(child.pid, state);
  const lines = createInterface({ input: control });
  let httpReady = false;
  let inspectorReady = expected.inspectorPort === undefined;
  const fail = (error: Error) => {
    state.failure = error;
    clearTimeout(timer);
    rejectReady(error);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  const timer = setTimeout(() => fail(new WorkerdFailure('workerd control readiness timed out', state.raw)), expected.timeoutMs ?? 10_000);
  lines.on('line', (line) => {
    state.raw.push(line);
    expected.onRaw?.(Buffer.from(`BENCH_WORKERD_CONTROL ${line}\n`));
    try {
      const message = object(JSON.parse(line));
      state.messages.push(message);
      if (!Number.isSafeInteger(message.port) || Number(message.port) < 1 || Number(message.port) > 65535) {
        throw new WorkerdFailure('Invalid workerd control port', message);
      }
      if (message.event === 'listen' && message.socket === 'http' && message.port === expected.port && !httpReady) httpReady = true;
      else if (message.event === 'listen-inspector' && message.port === expected.inspectorPort && !inspectorReady) inspectorReady = true;
      else throw new WorkerdFailure('Unexpected or duplicate workerd control event', message);
      if (httpReady && inspectorReady) { clearTimeout(timer); resolveReady(); }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      fail(error instanceof WorkerdFailure ? error : new WorkerdFailure('Malformed workerd control data', { message: error.message, raw: [...state.raw] }));
    }
  });
  control.once('error', fail);
  control.once('end', () => {
    if (!httpReady || !inspectorReady) fail(new WorkerdFailure('workerd control pipe closed before readiness', state.raw));
  });
  control.once('close', () => {
    if (!httpReady || !inspectorReady) fail(new WorkerdFailure('workerd control pipe closed before readiness', state.raw));
  });
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    if (!httpReady || !inspectorReady) fail(new WorkerdFailure('workerd exited before readiness', { code, signal, raw: state.raw }));
  });
  child.once('close', () => {
    clearTimeout(timer);
    lines.close();
    control.removeListener('error', fail);
    child.removeListener('error', fail);
    if (child.pid !== undefined) subjects.delete(child.pid);
  });
  return state;
}
