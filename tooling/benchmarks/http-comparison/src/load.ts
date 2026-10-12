import { type ChildProcess, execFile, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Measurement, shoot, type TrafficDiagnostics, TrafficFailure, type TrafficOptions } from './traffic';

const execute = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export interface GeneratorIdentity {
  readonly protocol: 'local-session-v1';
  readonly pid: number;
  readonly nonce: string;
  readonly node: string;
  readonly executable: string;
  readonly hostname: string;
}

export type LocalMeasurement = Measurement & { readonly generator: GeneratorIdentity };

function isIdentity(value: unknown): value is GeneratorIdentity {
  return typeof value === 'object' && value !== null
    && 'protocol' in value && value.protocol === 'local-session-v1'
    && 'pid' in value && typeof value.pid === 'number' && Number.isSafeInteger(value.pid)
    && 'nonce' in value && typeof value.nonce === 'string' && value.nonce.length > 0
    && 'node' in value && typeof value.node === 'string'
    && 'executable' in value && typeof value.executable === 'string'
    && 'hostname' in value && typeof value.hostname === 'string';
}

// The owned client serializes shoot's output; reject malformed envelopes before
// decoding it, and preserve the complete wire payload in failure diagnostics.
function wireMessage(value: unknown): value is { id: number; payload: string } {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'number' && Number.isSafeInteger(value.id)
    && 'payload' in value && typeof value.payload === 'string'
    && Buffer.byteLength(value.payload) <= MAX_BUFFER;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numericFields(value: unknown, fields: readonly string[]): boolean {
  return record(value) && fields.every((field) => typeof value[field] === 'number'
    && Number.isFinite(value[field]) && value[field] >= 0);
}

function measurementPayload(value: unknown): value is LocalMeasurement {
  return record(value) && isIdentity(value.generator) && record(value.result)
    && value.result.errors === 0 && value.result.timeouts === 0
    && value.result.non2xx === 0 && value.result.mismatches === 0
    && numericFields(value.result.requests, ['total', 'average'])
    && record(value.result.requests) && Number(value.result.requests.total) > 0
    && numericFields(value.result.throughput, ['average'])
    && numericFields(value.result.latency, ['average'])
    && numericFields(value.clientCpu, ['userMicros', 'systemMicros', 'wallMicros', 'coreEquivalentPercent'])
    && Array.isArray(value.latencyHistogramMicros) && value.latencyHistogramMicros.length > 0
    && value.latencyHistogramMicros.every((row: unknown) => Array.isArray(row) && row.length === 2
      && row.every((field: unknown) => typeof field === 'number' && Number.isFinite(field) && field >= 0))
    && numericFields(value.latencyPercentilesMs, ['p50', 'p95', 'p99']) && value.statusMismatches === 0;
}

function trafficDiagnostics(value: unknown): value is TrafficDiagnostics {
  return typeof value === 'object' && value !== null && 'result' in value
    && (value.result === null || typeof value.result === 'object')
    && 'statusMismatches' in value && typeof value.statusMismatches === 'number'
    && 'clientCpu' in value && typeof value.clientCpu === 'object' && value.clientCpu !== null
    && 'latencyHistogramMicros' in value && Array.isArray(value.latencyHistogramMicros);
}

export class LocalLoadSession {
  private readonly child: ChildProcess;
  private readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private stdout = '';
  private stderr = '';
  private outputBytes = 0;
  private sequence = 0;
  private busy = false;
  private closing = false;
  private failure: Error | undefined;
  private failureReported = false;
  private rejectPending: ((error: Error) => void) | undefined;
  private receive: ((value: unknown) => void) | undefined;
  private identity: GeneratorIdentity | undefined;

  private constructor(entry: string) {
    this.child = fork(entry, ['--local-session'], {
      execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.closed = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        if (!this.closing) this.fail(new Error(`Load session exited early: code=${code} signal=${signal}`));
        resolve({ code, signal });
      });
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('message', (value: unknown) => {
      if (this.closing) return;
      if (this.receive) this.receive(value);
      else {
        this.capture('stderr', Buffer.from(`\nUnexpected load session message: ${JSON.stringify(value).slice(0, 4096)}`));
        this.fail(new Error('Unexpected load session message without an active request'));
      }
    });
    for (const [stream, name] of [[this.child.stdout, 'stdout'], [this.child.stderr, 'stderr']] as const) {
      stream?.on('data', (bytes: Buffer) => this.capture(name, bytes));
    }
  }

  private capture(stream: 'stdout' | 'stderr', bytes: Buffer): void {
    this[stream] += bytes.subarray(0, Math.max(MAX_BUFFER - this.outputBytes, 0)).toString();
    this.outputBytes += bytes.length;
    if (this.outputBytes > MAX_BUFFER) this.fail(new Error('Load session diagnostic buffer exceeded 64 MiB'));
  }

  static async open(entry = fileURLToPath(new URL('../dist/load-client.mjs', import.meta.url))): Promise<LocalLoadSession> {
    const session = new LocalLoadSession(entry);
    try {
      const identity: unknown = JSON.parse(await session.exchange({ type: 'init' }, 120_000));
      if (!isIdentity(identity) || identity.pid !== session.child.pid) throw new Error('Malformed load session identity');
      session.identity = identity;
      return session;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      session.failureReported = true;
      try {
        await session.close();
      } catch (cleanup) {
        session.capture('stderr', Buffer.from(`\nLoad session cleanup failed: ${cleanup instanceof Error ? cleanup.stack : String(cleanup)}`));
      }
      throw new LoadProcessFailure(error, session.stdout, session.stderr);
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.rejectPending?.(this.failure);
    if (!this.closing) this.child.kill('SIGKILL');
  }

  private exchange(request: object, timeout: number): Promise<string> {
    if (this.busy || this.closing || this.failure) {
      return Promise.reject(this.failure ?? new Error('Load session is busy or closed'));
    }
    this.busy = true;
    const id = this.sequence++;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, payload?: string) => {
        clearTimeout(timer);
        this.receive = undefined;
        this.rejectPending = undefined;
        this.busy = false;
        if (error) reject(error);
        else resolve(payload ?? '');
      };
      const message = (value: unknown) => {
        if (!wireMessage(value) || value.id !== id) {
          this.capture('stderr', Buffer.from(`\nMalformed load session message: ${JSON.stringify(value).slice(0, 4096)}`));
          this.fail(new Error(`Malformed or unmatched load session response for request ${id}`));
          return;
        }
        this.capture('stdout', Buffer.from(`\n${value.payload}`));
        if (this.failure) return;
        finish(undefined, value.payload);
      };
      const timer = setTimeout(() => this.fail(new Error(`Load session request ${id} timed out after ${timeout} ms`)), timeout);
      this.rejectPending = (error) => finish(error);
      this.receive = message;
      this.child.send({ ...request, id }, (error) => { if (error) this.fail(error); });
    });
  }

  async load(options: TrafficOptions, label: string): Promise<LocalMeasurement> {
    try {
      const payload = await this.exchange({ type: 'load', options, label }, (options.duration + 120) * 1000);
      const decoded: unknown = JSON.parse(payload);
      if (typeof decoded === 'object' && decoded !== null && 'failure' in decoded) {
        const failure = decoded.failure;
        if (typeof failure !== 'object' || failure === null || !('message' in failure) || typeof failure.message !== 'string') {
          throw new Error('Malformed load session failure');
        }
        if ('diagnostics' in failure && trafficDiagnostics(failure.diagnostics)) {
          throw new TrafficFailure(failure.message, failure.diagnostics);
        }
        throw new Error(failure.message);
      }
      if (!measurementPayload(decoded)) throw new Error('Malformed load session measurement');
      if (JSON.stringify(decoded.generator) !== JSON.stringify(this.identity)) {
        throw new Error('Load session generator identity changed');
      }
      return decoded;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.fail(error);
      this.failureReported = true;
      try {
        await this.close();
      } catch (cleanup) {
        this.capture('stderr', Buffer.from(`\nLoad session cleanup failed: ${cleanup instanceof Error ? cleanup.stack : String(cleanup)}`));
      }
      throw new LoadProcessFailure(error, this.stdout, this.stderr);
    }
  }

  async close(): Promise<void> {
    if (!this.closing) {
      if (!this.failure && (this.child.exitCode !== null || this.child.signalCode !== null)) {
        this.failure = new Error(`Load session exited before owned shutdown: code=${this.child.exitCode} signal=${this.child.signalCode}`);
      }
      this.closing = true;
      this.rejectPending?.(new Error('Load session closed during a request'));
      // No graceful drain is needed after shoot has completed. Bound teardown
      // even for a wedged client; the close subscription predates this signal.
      this.child.kill('SIGKILL');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const terminal = await Promise.race([this.closed, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Load session teardown timed out after 5000 ms')), 5_000);
      })]);
      if (!this.failureReported && (this.failure || terminal.signal !== 'SIGKILL')) {
        this.failureReported = true;
        throw new LoadProcessFailure(this.failure
          ?? new Error(`Unexpected load session termination: code=${terminal.code} signal=${terminal.signal}`),
        this.stdout, this.stderr);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export class LoadProcessFailure extends Error {
  constructor(cause: Error, readonly stdout: string, readonly stderr: string) {
    super(cause.message, { cause });
    this.name = 'LoadProcessFailure';
  }
}

async function executeLoad(command: string, args: string[], timeout: number): Promise<Measurement> {
  try {
    const result = await execute(command, args, { maxBuffer: 64 * 1024 * 1024, timeout });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new LoadProcessFailure(error,
      'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
      'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '');
  }
}

export async function load(options: TrafficOptions, label: string): Promise<Measurement> {
  const host = process.env.BENCH_SSH_HOST;
  if (host === undefined) {
    if (process.env.BENCH_LOAD_PROCESS !== '1') return shoot(options, label);
    const payload = Buffer.from(JSON.stringify(options)).toString('base64');
    return executeLoad(process.execPath, [
      fileURLToPath(new URL('../dist/load-client.mjs', import.meta.url)), payload,
    ], (options.duration + 120) * 1000);
  }
  const directory = process.env.BENCH_REMOTE_DIR;
  if (!directory || !/^\/[A-Za-z0-9/_.-]+$/.test(directory)) {
    throw new Error('BENCH_REMOTE_DIR must be an absolute remote directory without shell metacharacters');
  }
  const payload = Buffer.from(JSON.stringify(options)).toString('base64');
  const command = `cd ${directory} && PATH=/usr/local/bin:$PATH node load-client.mjs ${payload}`;
  const control = process.env.BENCH_SSH_CONTROL;
  return executeLoad('ssh', [
    '-o', 'BatchMode=yes',
    ...(control ? ['-S', control] : []),
    host, command,
  ], (options.duration + 120) * 1000);
}
