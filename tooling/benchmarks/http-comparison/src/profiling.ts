import { execFile } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { array, object, type ProfileCapture, ProfileFailure, type ProfileMode, type RawArtifact, type ServingSubject, sha256, type TimeAnchor } from './profile-report';
import { processTreeSample } from './resources';
import type { TargetConfig } from './targets';

const MAX_RAW_BYTES = 64 * 1024 * 1024;
const execute = promisify(execFile);
export class RawCapture {
  private readonly files = new Map<string, { kind: RawArtifact['kind']; bytes: number }>();
  failure: ProfileFailure | null = null;
  constructor(readonly root: string, readonly directory: string) {}
  append(kind: RawArtifact['kind'], name: string, bytes: string | Buffer): void {
    const file = this.files.get(name) ?? { kind, bytes: 0 };
    const size = Buffer.byteLength(bytes);
    if (file.bytes + size > MAX_RAW_BYTES) {
      this.failure = new ProfileFailure('raw', `Raw artifact exceeds ${MAX_RAW_BYTES} bytes: ${name}`);
      return;
    }
    appendFileSync(join(this.directory, name), bytes);
    file.bytes += size;
    this.files.set(name, file);
  }
  save(kind: RawArtifact['kind'], name: string, data: unknown): string {
    const bytes = JSON.stringify(data);
    if (Buffer.byteLength(bytes) > MAX_RAW_BYTES) throw new ProfileFailure('raw', `Raw artifact exceeds ${MAX_RAW_BYTES} bytes: ${name}`);
    writeFileSync(join(this.directory, name), bytes);
    this.files.set(name, { kind, bytes: Buffer.byteLength(bytes) });
    return relative(this.root, join(this.directory, name));
  }
  async artifacts(): Promise<RawArtifact[]> {
    return Promise.all([...this.files].map(async ([name, file]) => ({
      path: relative(this.root, join(this.directory, name)), kind: file.kind, bytes: file.bytes,
      sha256: sha256(await readFile(join(this.directory, name))),
    })));
  }
}

class Inspector {
  private id = 0;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Map<string, Set<(value: Record<string, unknown>) => void>>();
  private readonly socket: WebSocket;
  private readonly opened: Promise<void>;
  constructor(readonly url: string, private readonly raw: RawCapture, workerProxy = false) {
    // Node 24 WebSocketInit supports headers; DOM typings omit that native option.
    const socket: unknown = workerProxy ? Reflect.construct(WebSocket, [url, { headers: { Origin: 'http://localhost' } }]) : new WebSocket(url);
    if (!(socket instanceof WebSocket)) throw new ProfileFailure('inspector', 'Invalid native WebSocket instance');
    this.socket = socket;
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', () => reject(new ProfileFailure('inspector', 'Websocket connection failed')), { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      try {
        const bytes = String(event.data);
        this.raw.append('protocol', 'protocol.jsonl', `${JSON.stringify({ collectorMs: performance.now(), received: bytes })}\n`);
        if (this.raw.failure) throw this.raw.failure;
        const message = object(JSON.parse(bytes));
        if (typeof message.id === 'number') {
          const waiting = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error !== undefined) waiting?.reject(new ProfileFailure('protocol', String(object(message.error).message), message.error));
          else waiting?.resolve(message);
        } else if (typeof message.method === 'string') {
          for (const listener of this.listeners.get(message.method) ?? []) listener(object(message.params));
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        for (const waiting of this.pending.values()) waiting.reject(error);
        this.socket.close();
      }
    });
    this.socket.addEventListener('close', () => {
      for (const waiting of this.pending.values()) waiting.reject(new ProfileFailure('inspector', 'Websocket closed before response'));
      this.pending.clear();
    });
  }
  private async bounded<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProfileFailure('inspector', `${label} timed out`)), 15_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async call(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<Record<string, unknown>> {
    await this.bounded(this.opened, 'Websocket open');
    const id = ++this.id;
    const response = new Promise<Record<string, unknown>>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    const bytes = JSON.stringify({ id, method, params });
    this.raw.append('protocol', 'protocol.jsonl', `${JSON.stringify({ collectorMs: performance.now(), sent: bytes })}\n`);
    this.socket.send(bytes);
    try { return await this.bounded(response, method); } finally { this.pending.delete(id); }
  }
  event(method: string) {
    const callbacks = this.listeners.get(method) ?? new Set<(value: Record<string, unknown>) => void>();
    this.listeners.set(method, callbacks);
    let callback: (value: Record<string, unknown>) => void;
    const promise = new Promise<Record<string, unknown>>((resolve) => { callback = resolve; callbacks.add(resolve); });
    return { wait: () => this.bounded(promise, method), cancel: () => callbacks.delete(callback) };
  }
  on(method: string, callback: (value: Record<string, unknown>) => void): void {
    const callbacks = this.listeners.get(method) ?? new Set<(value: Record<string, unknown>) => void>();
    callbacks.add(callback);
    this.listeners.set(method, callbacks);
  }
  close(): void { this.socket.close(); }
}

const wallStart = `(()=>{const d={start:performance.now(),last:performance.now(),delays:[]};d.timer=setInterval(()=>{const now=performance.now();d.delays.push(Math.max(0,now-d.last-10));d.last=now},10);globalThis.__fluoProfileDiagnostic=d;return JSON.stringify({started:true})})()`;
const wallStop = `(()=>{const d=globalThis.__fluoProfileDiagnostic;clearInterval(d.timer);const result={wallDelayMaxMs:d.delays.length?Math.max(...d.delays):0,wallDelaySamples:d.delays.length,elapsedMs:performance.now()-d.start};delete globalThis.__fluoProfileDiagnostic;return JSON.stringify(result)})()`;
const nodeStart = `(()=>{const p=process.getBuiltinModule('node:perf_hooks');const h=p.monitorEventLoopDelay({resolution:10});h.enable();globalThis.__fluoProfileNode={p,h,elu:p.performance.eventLoopUtilization()};return JSON.stringify({started:true})})()`;
const nodeStop = `(()=>{const d=globalThis.__fluoProfileNode;const value={elu:d.p.performance.eventLoopUtilization(d.elu),delayMeanNs:Number.isFinite(d.h.mean)?d.h.mean:null,delayMaxNs:d.h.max};d.h.disable();delete globalThis.__fluoProfileNode;return JSON.stringify(value)})()`;

export class RuntimeCapture {
  readonly anchors: TimeAnchor[] = [];
  readonly gcEvents: Record<string, unknown>[] = [];
  subject: ServingSubject | null = null;
  identityPath: string | null = null;
  format: ProfileCapture['format'] = null;
  private contextId: number | undefined;
  private constructor(private readonly target: TargetConfig, private readonly inspector: Inspector, private readonly raw: RawCapture) {}
  static async connect(target: TargetConfig, launcherPid: number, port: number, raw: RawCapture): Promise<RuntimeCapture> {
    let url = `ws://127.0.0.1:${port}/3910`;
    let isolateId: string | null = null;
    let discovery: unknown = null;
    if (target.platform !== 'bun') {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10_000) });
      const bytes = await response.text();
      raw.save('identity', 'discovery.json', { status: response.status, raw: bytes });
      if (!response.ok) throw new ProfileFailure('discovery', `Inspector discovery returned ${response.status}`);
      const candidates = array(JSON.parse(bytes)).map(object).filter((entry) => target.platform !== 'workers'
        || String(entry.title).startsWith('workerd:') || (entry.title === 'Cloudflare Worker' && entry.description === 'workers'));
      if (candidates.length !== 1) throw new ProfileFailure('discovery', 'Expected exactly one serving inspector target', candidates);
      discovery = candidates[0];
      const entry = object(discovery);
      if (typeof entry.webSocketDebuggerUrl !== 'string') throw new ProfileFailure('discovery', 'Missing serving websocket URL');
      url = entry.webSocketDebuggerUrl;
      if (target.platform === 'workers') isolateId = String(entry.id);
    }
    const inspector = new Inspector(url, raw, target.platform === 'workers');
    const capture = new RuntimeCapture(target, inspector, raw);
    try {
      const contexts: Record<string, unknown>[] = [];
      inspector.on('Runtime.executionContextCreated', (event) => contexts.push(object(event.context)));
      await inspector.call('Runtime.enable');
      if (target.platform === 'workers') {
        const workerContexts = contexts.filter((context) => context.name === 'Worker');
        if (workerContexts.length !== 1 || typeof workerContexts[0].id !== 'number') throw new ProfileFailure('subject', 'Missing unique Worker execution context', contexts);
        capture.contextId = workerContexts[0].id;
        const isolate = object((await inspector.call('Runtime.getIsolateId')).result);
        if (typeof isolate.id !== 'string') throw new ProfileFailure('subject', 'Missing actual application isolate id');
        isolateId = isolate.id;
      }
      const expression = target.platform === 'workers'
        ? `JSON.stringify({pid:null,runtime:{host:"workerd"},workerRuntime:typeof WebSocketPair!=="undefined"&&typeof caches!=="undefined",servingMs:performance.now(),uptimeMs:null})`
        : `JSON.stringify({pid:typeof Deno!=="undefined"?Deno.pid:process.pid,runtime:typeof Deno!=="undefined"?Deno.version:process.versions,servingMs:performance.now(),uptimeMs:typeof process!=="undefined"&&typeof process.uptime==="function"?process.uptime()*1000:null})`;
      const runtime = await capture.evaluate(expression);
      if (target.platform === 'workers' && runtime.workerRuntime !== true) throw new ProfileFailure('subject', 'Workers inspector points to a launcher, not an application isolate');
      const tree = await processTreeSample(launcherPid);
      const process = target.platform === 'workers'
        ? tree.processes.find((p) => /(?:^|\/)workerd(?:\s|$)/.test(p.command))
        : tree.processes.find((p) => p.pid === runtime.pid);
      if (!process) throw new ProfileFailure('subject', 'Inspector does not identify the serving process', { runtime, tree });
      if (target.platform === 'workers') {
        const executable = process.command.split(' ')[0];
        const version = await execute(executable, ['--version']);
        runtime.runtime = { host: 'workerd', version: version.stdout.trim(), executable };
        raw.save('identity', 'workerd-version.json', { executable, argv: ['--version'], stdout: version.stdout, stderr: version.stderr });
      }
      capture.subject = { kind: target.platform === 'workers' ? 'application-isolate' : 'process', pid: process.pid, launcherPid, isolateId, inspectorUrl: url, runtime: object(runtime.runtime) };
      capture.identityPath = raw.save('identity', 'subject.json', { pid: process.pid, runtimePid: runtime.pid, workerRuntime: runtime.workerRuntime, contextId: capture.contextId, contexts, isolateId, inspectorUrl: url, command: process.command, runtime: runtime.runtime, discovery, tree });
      return capture;
    } catch (error) { inspector.close(); throw error; }
  }
  private async evaluate(expression: string, awaitPromise = false): Promise<Record<string, unknown>> {
    const reply = await this.inspector.call('Runtime.evaluate', { expression, returnByValue: true, ...(this.contextId === undefined ? {} : { contextId: this.contextId }), ...(awaitPromise ? { awaitPromise: true } : {}) });
    const envelope = object(reply.result);
    if (envelope.exceptionDetails || envelope.wasThrown) throw new ProfileFailure('evaluate', 'Serving Runtime.evaluate failed', envelope);
    const result = object(envelope.result);
    if (typeof result.value !== 'string') throw new ProfileFailure('evaluate', 'Serving runtime did not return a JSON string', envelope);
    const value: unknown = JSON.parse(result.value);
    return typeof value === 'string' ? { value } : object(value);
  }
  async anchor(): Promise<void> {
    const collectorBeforeMs = performance.now();
    const uptime = this.target.platform === 'workers' ? 'null' : 'typeof process!=="undefined"&&typeof process.uptime==="function"?process.uptime()*1000:null';
    const value = await this.evaluate(`JSON.stringify({servingMs:performance.now(),uptimeMs:${uptime}})`);
    if (typeof value.servingMs !== 'number') throw new ProfileFailure('anchor', 'Missing serving clock');
    this.anchors.push({ collectorBeforeMs, collectorAfterMs: performance.now(), servingMs: value.servingMs, servingUptimeMs: typeof value.uptimeMs === 'number' ? value.uptimeMs : null });
  }
  async start(mode: ProfileMode): Promise<void> {
    switch (mode) {
      case 'cpu':
        if (this.target.platform === 'bun') await this.inspector.call('ScriptProfiler.startTracking', { includeSamples: true });
        else {
          await this.inspector.call('Profiler.enable');
          await this.inspector.call('Profiler.setSamplingInterval', { interval: 1000 });
          await this.inspector.call('Profiler.start');
        }
        break;
      case 'allocation':
        if (this.target.platform === 'bun') {
          await this.inspector.call('Heap.enable');
          await this.inspector.call('Heap.startTracking');
        } else {
          await this.inspector.call('HeapProfiler.enable');
          await this.inspector.call('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
        }
        break;
      case 'gc-eventloop':
        if (this.target.platform === 'workers') {
          await this.inspector.call('Tracing.start', { categories: 'v8,gc', transferMode: 'ReportEvents' });
        } else {
          if (this.target.platform === 'bun') {
            this.inspector.on('Heap.garbageCollected', (event) => this.gcEvents.push(event));
            await this.inspector.call('Heap.enable');
          }
          await this.evaluate(wallStart);
          if (['fastify', 'express', 'nodejs', 'nextjs'].includes(this.target.platform)) await this.evaluate(nodeStart);
        }
        break;
    }
    await this.anchor();
  }
  async stop(mode: ProfileMode): Promise<string> {
    await this.anchor();
    let profile: unknown;
    switch (mode) {
      case 'cpu':
        if (this.target.platform === 'bun') {
          const event = this.inspector.event('ScriptProfiler.trackingComplete');
          try { await this.inspector.call('ScriptProfiler.stopTracking'); profile = (await event.wait()).samples; } finally { event.cancel(); }
          this.format = 'jsc-cpu';
        } else { profile = object((await this.inspector.call('Profiler.stop')).result).profile; this.format = 'v8-cpu'; }
        break;
      case 'allocation':
        if (this.target.platform === 'bun') {
          const event = this.inspector.event('Heap.trackingComplete');
          try {
            await this.inspector.call('Heap.stopTracking');
            const data = (await event.wait()).snapshotData;
            if (typeof data !== 'string') throw new ProfileFailure('heap', 'Missing JSC heap snapshot');
            profile = JSON.parse(data);
          } finally { event.cancel(); }
          this.format = 'jsc-heap';
        } else { profile = object((await this.inspector.call('HeapProfiler.stopSampling')).result).profile; this.format = 'v8-allocation'; }
        break;
      case 'gc-eventloop':
        profile = { ...await this.evaluate(wallStop), gcEvents: this.gcEvents, gcTraceSource: this.target.platform === 'bun' ? 'Heap.garbageCollected' : this.target.platform === 'deno' ? '--v8-flags=--trace-gc' : '--trace-gc' };
        if (['fastify', 'express', 'nodejs', 'nextjs'].includes(this.target.platform)) profile = { ...object(profile), node: await this.evaluate(nodeStop) };
        this.format = 'gc-eventloop';
        break;
    }
    return this.raw.save('profile', 'profile.json', profile);
  }
  close(): void { this.inspector.close(); }
}
